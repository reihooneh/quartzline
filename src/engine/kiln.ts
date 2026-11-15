// Kilns and firing schedules. A controller follows a list of segments (a rate, a target and a
// hold), but a kiln can only heat as fast as its elements or burners allow, and can only cool as
// fast as it loses heat on its own.

export interface Kiln {
  id: string;
  name: string;
  about: string;
  heatMax0: number;    // °C/h, fastest heating near room temperature
  heatMaxSlope: number;// °C/h lost per °C of kiln temperature
  coolTau: number;     // h, natural cooling time constant (T − room falls by e each τ)
  shelfTau: number;    // s, how long the shelf takes to follow the air
  convection: number;  // W/(m²·K)
}

export const ROOM = 20;
export const UNLOAD = 60; // °C: the firing is over when the pot is cool enough to handle
export const OPEN_TAU = 900;   // s: with the lid open, the air in the kiln drops towards room this fast
export const OPEN_VIEW = 0.3;  // share of the pot's view that is the open lid (cold room) once open
export const OPEN_WALLS = 2;   // the kiln's walls cool this many times faster with the lid open

export const KILNS: Kiln[] = [
  { id: 'test', name: 'Small test kiln', about: 'A little electric kiln: heats and cools quickly.', heatMax0: 650, heatMaxSlope: 0.3, coolTau: 2.6, shelfTau: 900, convection: 8 },
  { id: 'electric', name: 'Studio electric kiln', about: 'A typical 200-litre electric top-loader.', heatMax0: 450, heatMaxSlope: 0.2, coolTau: 5.2, shelfTau: 1500, convection: 8 },
  { id: 'gas', name: 'Large gas kiln', about: 'A heavy, well-insulated car kiln: slow to heat and slower to cool.', heatMax0: 260, heatMaxSlope: 0.09, coolTau: 11, shelfTau: 2700, convection: 15 },
];

export function kilnById(id: string): Kiln | undefined {
  return KILNS.find((k) => k.id === id);
}

export interface Cone { id: string; name: string; peak: number }
// Orton large-cone temperatures at the end of a 60 °C/h final climb.
export const CONES: Cone[] = [
  { id: '04', name: 'Cone 04 (earthenware)', peak: 1060 },
  { id: '6', name: 'Cone 6 (mid-fire)', peak: 1222 },
  { id: '10', name: 'Cone 10 (high-fire)', peak: 1285 },
];

export function coneById(id: string): Cone | undefined {
  return CONES.find((c) => c.id === id);
}

// One controller segment. A rate of `FULL` means as fast as the kiln can.
export const FULL = 9999;
export interface Segment {
  rate: number;   // °C/h
  target: number; // °C
  hold: number;   // minutes
}

export function heatMax(k: Kiln, t: number): number {
  return Math.max(40, k.heatMax0 - k.heatMaxSlope * t);
}

export function coolMax(k: Kiln, t: number): number {
  return Math.max(0, (t - ROOM) / k.coolTau);
}

// Follows the schedule second by second: the kiln air temperature as a function of time.
export class Controller {
  private seg = 0;
  private holdLeft = -1; // s, −1 while still ramping
  air = ROOM;   // the air around the pot
  walls = ROOM; // the kiln's inside surfaces, which the pot radiates to (the same until opened)
  done = false;
  opened = false;
  // openAt: the lid is opened once the kiln has cooled on its own to this temperature.
  constructor(readonly kiln: Kiln, readonly schedule: Segment[], readonly openAt = UNLOAD) {}

  // Index of the segment being run (schedule.length once into the final natural cool).
  get segment(): number {
    return this.seg;
  }

  advance(dt: number): void {
    this.step(dt);
    if (!this.opened) this.walls = this.air;
  }

  private step(dt: number): void {
    let left = dt;
    while (left > 1e-9) {
      if (this.seg >= this.schedule.length) {
        if (!this.opened && this.air <= this.openAt) this.opened = true;
        if (this.opened) {
          // Lid open: room air pours in, and the walls lose heat faster through the opening.
          this.air = ROOM + (this.air - ROOM) * Math.exp(-left / OPEN_TAU);
          this.walls = ROOM + (this.walls - ROOM) * Math.exp(-(left * OPEN_WALLS) / (this.kiln.coolTau * 3600));
          if (this.air <= UNLOAD && this.walls <= UNLOAD + 40) this.done = true;
          return;
        } else {
          // Switched off: cool on its own (but stop at the opening temperature).
          const rate = coolMax(this.kiln, this.air) / 3600;
          const need = rate > 0 ? (this.air - this.openAt) / rate : Infinity;
          if (need < left && this.openAt > ROOM) {
            this.air = this.openAt;
            this.opened = true;
            left -= need;
            continue;
          }
          this.air = Math.max(ROOM, this.air - rate * left);
          this.walls = this.air;
        }
        if (this.air <= UNLOAD) this.done = true;
        return;
      }
      const s = this.schedule[this.seg];
      if (this.holdLeft >= 0) {
        const used = Math.min(left, this.holdLeft);
        this.holdLeft -= used;
        left -= used;
        if (this.holdLeft <= 1e-9) { this.seg++; this.holdLeft = -1; }
        continue;
      }
      const up = s.target > this.air;
      const limit = up ? heatMax(this.kiln, this.air) : coolMax(this.kiln, this.air);
      const rate = Math.min(s.rate, limit) / 3600; // °C/s
      if (rate <= 1e-12) {
        // Can't move (asked to cool below what the room allows): end the segment.
        this.holdLeft = s.hold * 60;
        continue;
      }
      const gap = Math.abs(s.target - this.air);
      const tNeed = gap / rate;
      if (tNeed <= left) {
        this.air = s.target;
        left -= tNeed;
        this.holdLeft = s.hold * 60;
        if (this.holdLeft <= 1e-9) { this.seg++; this.holdLeft = -1; }
      } else {
        this.air += (up ? 1 : -1) * rate * left;
        left = 0;
      }
    }
  }
}

// The schedule many potters start from: a "fast glaze" firing, switched off at the top.
export function defaultSchedule(peak: number): Segment[] {
  return [
    { rate: 150, target: 600, hold: 0 },
    { rate: 300, target: peak - 100, hold: 0 },
    { rate: 60, target: peak, hold: 10 },
  ];
}

// Describes a schedule for a kiln controller.
export function scheduleText(schedule: Segment[]): string {
  const lines = ['Seg  Rate (°C/h)  Target (°C)  Hold (min)'];
  schedule.forEach((s, i) => {
    const rate = s.rate >= FULL ? 'FULL' : String(Math.round(s.rate));
    lines.push(`${String(i + 1).padStart(3)}  ${rate.padStart(11)}  ${String(Math.round(s.target)).padStart(11)}  ${String(Math.round(s.hold)).padStart(10)}`);
  });
  lines.push('Then switch off and let the kiln cool on its own.');
  return lines.join('\n');
}
