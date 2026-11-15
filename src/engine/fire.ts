// A whole firing, minute by minute: the kiln air follows the schedule, the shelf lags behind it,
// heat flows into and through the pot, and at every moment the stress and the risk of a crack
// are worked out.
//
// Heat: each station's wall is cut into layers. Each time step is split in two: heat flows across
// the wall (with the faces), then along the pot. Both halves are implicit (backward Euler, one
// tridiagonal solve per station or per layer), so the step can be as long as accuracy allows,
// and both conserve heat exactly. The faces lose and gain heat by radiation and convection to
// the kiln air, the inside face only as much as it can see out of the pot, and the base by
// contact with the shelf.

import { Clay } from './clay.js';
import { Controller, Kiln, OPEN_VIEW, ROOM, Segment, UNLOAD } from './kiln.js';
import { Shape } from './piece.js';
import { StressModel, crackChance } from './stress.js';
import { QUARTZ_T, CRISTOBALITE_T } from './clay.js';

const SIGMA = 5.670374419e-8;
const CONTACT = 60;      // W/(m²·K) where the base sits on the shelf
const MAX_HOURS = 96;

export interface FireOptions {
  layers?: number;    // across the wall (default 6)
  frameEvery?: number;// s between recorded frames (default 300)
  record?: boolean;   // keep per-station frames for drawing
  dtMax?: number;     // s, the largest time step (default 10)
  openAt?: number;    // °C: open the lid when the kiln has cooled to this (default: when cool)
  stressEvery?: number; // s between stress checks (default 30)
}

export type Cause = 'quartz' | 'cristobalite' | 'gradient';

export interface Worst {
  time: number;      // s
  air: number;       // °C
  station: number;
  region: string;
  face: 'outside' | 'inside' | 'middle';
  stress: number;    // Pa
  coldest: number;   // °C, coldest part of the piece then
  hottest: number;
  coldRegion: string;
  hotRegion: string;
  cause: Cause;
  heating: boolean;
  segment: number;   // schedule segment running then (schedule.length = cooling on its own)
  opened: boolean;   // the lid was open
}

export interface Frame {
  temps: Float32Array;  // °C, station by station, layers from the outside face in (n × m)
  stress: Float32Array; // Pa, the same cells (positive = tension)
}

export interface Firing {
  duration: number;  // s until the kiln can be opened
  chance: number;    // probability of a crack, 0..1
  worst: Worst;
  times: number[];   // s, one per frame
  air: number[];
  shelf: number[];
  coldest: number[];
  hottest: number[];
  risk: number[];    // running crack chance so far
  peakStress: number[]; // Pa, the largest tension at each frame
  frames: Frame[];
  layers: number;
  heatIn: number;    // J, through the faces
  stored: number;    // J, now held in the clay above where it started
  steps: number;
  finished: boolean;
}

export function fire(shape: Shape, clay: Clay, kiln: Kiln, schedule: Segment[], opts: FireOptions = {}): Firing {
  const m = opts.layers ?? 6;
  const frameEvery = opts.frameEvery ?? 300;
  const stressEvery = opts.stressEvery ?? 30;
  const st = shape.stations;
  const n = st.length;
  const k = clay.conductivity;
  const rho = clay.density;

  // Geometry and fixed conductances.
  const area = new Float64Array(n);   // face area of one cell, m²
  const vol = new Float64Array(n);    // one cell's volume, m³
  const gy = new Float64Array(n);     // between layers, W/K
  const gs = new Float64Array(n);     // between station i and i+1 in one layer, W/K
  const outerArea = new Float64Array(n);
  const innerArea = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = st[i];
    const dy = s.h / m;
    area[i] = 2 * Math.PI * s.r * s.ds;
    vol[i] = area[i] * dy;
    gy[i] = (k * area[i]) / dy;
    const end = s.rim ? Math.PI * s.r * s.h : 0; // the rim's top edge, shared by both faces
    outerArea[i] = area[i] + end;
    innerArea[i] = area[i] + end;
    if (i + 1 < n) {
      const t = st[i + 1];
      const rMid = (s.r + t.r) / 2;
      const dyMid = (s.h + t.h) / 2 / m;
      gs[i] = (k * 2 * Math.PI * rMid * dyMid) / ((s.ds + t.ds) / 2);
    }
  }
  // Both directions are implicit (split: across the wall, then along the pot), so any step is
  // stable; 10 s keeps the crack chance within a few per cent of a much finer step.
  const dt = Math.max(1, Math.min(opts.dtMax ?? 10, 120));

  const T = new Float64Array(n * m).fill(ROOM);
  const Tn = new Float64Array(n * m);
  const L = Math.max(n, m);
  const a = new Float64Array(L), b = new Float64Array(L), c = new Float64Array(L), d = new Float64Array(L);
  const cp = new Float64Array(L), dp = new Float64Array(L), x = new Float64Array(L);
  const caps = new Float64Array(n * m);
  // Solves the tridiagonal system a·x[k−1] + b·x[k] + c·x[k+1] = d for k < len (Thomas).
  const solve = (len: number) => {
    cp[0] = c[0] / b[0];
    dp[0] = d[0] / b[0];
    for (let q = 1; q < len; q++) {
      const den = b[q] - a[q] * cp[q - 1];
      cp[q] = c[q] / den;
      dp[q] = (d[q] - a[q] * dp[q - 1]) / den;
    }
    x[len - 1] = dp[len - 1];
    for (let q = len - 2; q >= 0; q--) x[q] = dp[q] - cp[q] * x[q + 1];
  };
  const stress = new StressModel(shape, clay, m);
  const control = new Controller(kiln, schedule, opts.openAt ?? UNLOAD);
  let shelf = ROOM;
  let time = 0;
  let heatIn = 0, stored = 0, steps = 0;
  let Hmax = 0;
  let worst: Worst | null = null;
  let worstH = -1;
  const out: Firing = {
    duration: 0, chance: 0, worst: null as unknown as Worst, times: [], air: [], shelf: [], coldest: [], hottest: [],
    risk: [], peakStress: [], frames: [], layers: m, heatIn: 0, stored: 0, steps: 0, finished: false,
  };
  const eps = clay.emissivity;
  const hRad = (ts: number, te: number) => {
    const A = ts + 273.15, B = te + 273.15;
    return eps * SIGMA * (A * A + B * B) * (A + B);
  };
  // With the lid open, cool room air moves over the pot.
  const convection = () => (control.opened ? Math.max(kiln.convection, 15) : kiln.convection);
  // The film coefficient (W/(m²·K)) and surrounding temperature (°C) for a face; written to
  // envH/envT to avoid allocating in the inner loop.
  let envH = 0, envT = 0;
  // A face that sees the kiln: radiation to the walls (and, with the lid open, partly to the
  // cold room), convection to the air; combined into one coefficient and temperature.
  const exposed = (surf: number, air: number, view: number) => {
    const walls = control.walls;
    const parts: [number, number][] = control.opened
      ? [[(1 - OPEN_VIEW) * hRad(surf, walls), walls], [OPEN_VIEW * hRad(surf, ROOM), ROOM], [convection(), air]]
      : [[hRad(surf, air) + convection(), air]];
    let h = 0, ht = 0;
    for (const [hh, tt] of parts) { h += hh; ht += hh * tt; }
    envH = view * h;
    envT = h > 0 ? ht / h : air;
  };
  const envelope = (i: number, surf: number, outer: boolean, air: number) => {
    const s = st[i];
    if (outer) {
      if (s.shelf === 'contact') { envH = CONTACT + hRad(surf, shelf); envT = shelf; return; }
      if (s.shelf === 'gap') { envH = 0.8 * hRad(surf, shelf) + 2; envT = shelf; return; }
      exposed(surf, air, 1); return;
    }
    exposed(surf, air, s.openness);
  };

  const shelfStep = 1 - Math.exp(-dt / kiln.shelfTau);
  let nextFrame = 0;
  let nextStress = 0;
  let prevAir = ROOM;
  let H = 0;
  const record = (air: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let q = 0; q < n * m; q++) { if (T[q] < lo) lo = T[q]; if (T[q] > hi) hi = T[q]; }
    let peak = -Infinity;
    for (let i = 0; i < n; i++) peak = Math.max(peak, stress.peak[i]);
    out.times.push(time);
    out.air.push(air);
    out.shelf.push(shelf);
    out.coldest.push(lo);
    out.hottest.push(hi);
    out.risk.push(crackChance(Hmax));
    out.peakStress.push(peak);
    if (opts.record) {
      stress.evaluate(T); // the stress for exactly this moment
      out.frames.push({ temps: Float32Array.from(T), stress: Float32Array.from(stress.sigma) });
    }
  };

  while (time < MAX_HOURS * 3600) {
    if (time >= nextStress) {
      H = stress.evaluate(T);
      if (H > Hmax) Hmax = H;
      if (H > worstH) {
        worstH = H;
        worst = describe(shape, stress, T, m, time, control.air, control.air >= prevAir, control.segment, control.opened);
      }
      nextStress += stressEvery;
    }
    if (time >= nextFrame) {
      record(control.air);
      nextFrame += frameEvery;
    }
    if (control.done) {
      let hot = -Infinity;
      for (let q = 0; q < n * m; q++) if (T[q] > hot) hot = T[q];
      if (hot <= UNLOAD + 10) break;
    }
    prevAir = control.air;
    control.advance(dt);
    const air = control.air;
    shelf += (air - shelf) * shelfStep;
    // 1. Across the wall, with the faces.
    for (let i = 0; i < n; i++) {
      const base = i * m;
      for (let j = 0; j < m; j++) {
        const told = T[base + j];
        const cap = rho * (clay.cp0 + clay.cpSlope * Math.min(Math.max(told, 0), 1300)) * vol[i];
        caps[base + j] = cap;
        a[j] = j > 0 ? -gy[i] : 0;
        c[j] = j < m - 1 ? -gy[i] : 0;
        b[j] = cap / dt + (j > 0 ? gy[i] : 0) + (j < m - 1 ? gy[i] : 0);
        d[j] = (cap / dt) * told;
      }
      // Faces: a film conductance in series with half a layer of clay.
      const half = (st[i].h / m) / 2;
      envelope(i, T[base], true, air);
      const go = 1 / (1 / Math.max(envH * outerArea[i], 1e-12) + half / (k * outerArea[i]));
      const to = envT;
      b[0] += go; d[0] += go * to;
      envelope(i, T[base + m - 1], false, air);
      const gi = envH > 0 ? 1 / (1 / (envH * innerArea[i]) + half / (k * innerArea[i])) : 0;
      const ti = envT;
      b[m - 1] += gi; d[m - 1] += gi * ti;
      solve(m);
      for (let j = 0; j < m; j++) Tn[base + j] = x[j];
      heatIn += (go * (to - Tn[base]) + gi * (ti - Tn[base + m - 1])) * dt;
    }
    // 2. Along the pot, layer by layer.
    if (n > 1) {
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          const q = i * m + j;
          const C = caps[q] / dt;
          a[i] = i > 0 ? -gs[i - 1] : 0;
          c[i] = i + 1 < n ? -gs[i] : 0;
          b[i] = C + (i > 0 ? gs[i - 1] : 0) + (i + 1 < n ? gs[i] : 0);
          d[i] = C * Tn[q];
        }
        solve(n);
        for (let i = 0; i < n; i++) Tn[i * m + j] = x[i];
      }
    }
    for (let q = 0; q < n * m; q++) stored += caps[q] * (Tn[q] - T[q]);
    T.set(Tn);
    time += dt;
    steps++;
  }
  if (time > out.times[out.times.length - 1]) record(control.air);
  out.duration = time;
  out.finished = control.done;
  out.chance = crackChance(Hmax);
  out.worst = worst as Worst;
  out.heatIn = heatIn;
  out.stored = stored;
  out.steps = steps;
  return out;
}

function describe(shape: Shape, stress: StressModel, T: Float64Array, m: number, time: number, air: number, heating: boolean, segment: number, opened: boolean): Worst {
  const st = shape.stations;
  let best = 0;
  for (let i = 1; i < st.length; i++) if (stress.peak[i] > stress.peak[best]) best = i;
  let lo = 0, hi = 0;
  for (let q = 1; q < T.length; q++) { if (T[q] < T[lo]) lo = q; if (T[q] > T[hi]) hi = q; }
  const coldest = T[lo], hottest = T[hi];
  const spans = (x: number, margin: number) => coldest <= x + margin && hottest >= x - margin;
  const cause: Cause = spans(QUARTZ_T, 12) ? 'quartz' : spans(CRISTOBALITE_T, 15) ? 'cristobalite' : 'gradient';
  const layer = stress.peakFace[best];
  const face = layer === 0 ? 'outside' : layer === m - 1 ? 'inside' : 'middle';
  return {
    time, air, station: best, region: st[best].region, face, stress: stress.peak[best],
    coldest, hottest, coldRegion: st[Math.floor(lo / m)].region, hotRegion: st[Math.floor(hi / m)].region,
    cause, heating, segment, opened,
  };
}
