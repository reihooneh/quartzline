// Planning the fastest firing that keeps a piece whole.
//
// A schedule is described by a handful of choices: how fast to heat below, through and above the
// quartz inversion, how fast (if at all) to hold back the cooling through each range, and when to
// open the lid. Each choice has a ladder of settings from cautious to fast. The planner starts
// with everything at its fastest and, while the crack chance is above the limit, finds the
// moment of greatest risk, works out which choice was in charge then, and makes that one a notch
// more cautious. Once the piece is safe it tries to speed each choice back up, keeping any change
// that stays safe and saves time, until nothing more can be gained.

import { Clay } from './clay.js';
import { Firing, FireOptions, fire } from './fire.js';
import { FULL, Kiln, Segment, UNLOAD } from './kiln.js';
import { Shape } from './piece.js';

export type Choice = 'heatLow' | 'heatQuartz' | 'heatHigh' | 'coolHigh' | 'coolQuartz' | 'coolMid' | 'coolLow' | 'open';
export const CHOICES: Choice[] = ['heatLow', 'heatQuartz', 'heatHigh', 'coolHigh', 'coolQuartz', 'coolMid', 'coolLow', 'open'];

export const LABELS: Record<Choice, string> = {
  heatLow: 'Heating to 500 °C',
  heatQuartz: 'Heating through quartz (500–650 °C)',
  heatHigh: 'Heating from 650 °C to the final climb',
  coolHigh: 'Cooling from the top to 700 °C',
  coolQuartz: 'Cooling through quartz (700–500 °C)',
  coolMid: 'Cooling from 500 to 300 °C',
  coolLow: 'Cooling through cristobalite (300–150 °C)',
  open: 'Opening the lid',
};

// Ladders from most cautious to fastest. FULL means as fast as the kiln can manage.
export const HEAT_RATES = [40, 60, 80, 100, 125, 150, 200, 250, 300, FULL];
export const COOL_RATES = [25, 40, 60, 80, 100, 125, 150, 200, FULL];
// Quartzline never suggests opening above 250 °C: one-sided draughts, glazes and handling aren't
// modelled, and potters' experience says hotter is asking for trouble.
export const OPEN_AT = [UNLOAD, 80, 100, 125, 150, 175, 200, 250];

export function ladder(c: Choice): number[] {
  if (c === 'open') return OPEN_AT;
  return c.startsWith('heat') ? HEAT_RATES : COOL_RATES;
}

export type Plan = Record<Choice, number>; // an index into each ladder

export const FINAL_RATE = 60; // °C/h for the last 100 °C, so the cones see the heat-work they expect

export interface Built {
  schedule: Segment[];
  openAt: number;
  owner: Choice[]; // which choice each segment belongs to
}

// Turns a plan into controller segments (plus the lid-opening temperature).
export function build(plan: Plan, peak: number, hold: number): Built {
  const r = (c: Choice) => ladder(c)[plan[c]];
  const seg: Segment[] = [];
  const owner: Choice[] = [];
  const push = (c: Choice, rate: number, target: number, h = 0) => {
    seg.push({ rate, target, hold: h });
    owner.push(c);
  };
  push('heatLow', r('heatLow'), 500);
  push('heatQuartz', r('heatQuartz'), 650);
  push('heatHigh', r('heatHigh'), Math.max(peak - 100, 660));
  seg.push({ rate: FINAL_RATE, target: peak, hold });
  owner.push('heatHigh');
  const cool: [Choice, number][] = [['coolHigh', 700], ['coolQuartz', 500], ['coolMid', 300], ['coolLow', 150]];
  // Cooling segments only matter up to the last one that holds the kiln back.
  let last = -1;
  cool.forEach(([c], i) => { if (r(c) < FULL) last = i; });
  for (let i = 0; i <= last; i++) {
    const [c, target] = cool[i];
    seg.push({ rate: r(c), target, hold: 0 });
    owner.push(c);
  }
  return { schedule: seg, openAt: r('open'), owner };
}

// The same schedule with neighbouring segments merged when they climb at the same rate, for a
// controller (the planner keeps them apart so it can tell which range is to blame).
export function compact(schedule: Segment[]): Segment[] {
  const out: Segment[] = [];
  let prev = 20;
  for (const s of schedule) {
    const last = out[out.length - 1];
    const lastFrom = out.length > 1 ? out[out.length - 2].target : 20;
    const sameWay = last && Math.sign(s.target - prev) === Math.sign(last.target - lastFrom);
    if (last && sameWay && last.rate === s.rate && last.hold === 0) {
      last.target = s.target;
      last.hold = s.hold;
    } else {
      out.push({ ...s });
    }
    prev = s.target;
  }
  return out;
}

export function fastest(): Plan {
  const p = {} as Plan;
  for (const c of CHOICES) p[c] = ladder(c).length - 1;
  return p;
}

export function slowest(): Plan {
  const p = {} as Plan;
  for (const c of CHOICES) p[c] = 0;
  return p;
}

export interface PlanResult {
  plan: Plan;
  built: Built;
  firing: Firing;
  evaluations: number;
  safe: boolean;      // met the limit
  steps: string[];    // what the planner did, in words
}

export interface PlanOptions {
  limit: number;               // largest acceptable crack chance (0..1)
  hold: number;                // minutes at the top
  choices?: Choice[];          // which choices may change (others stay as in `start`)
  start?: Plan;
  maxEvaluations?: number;
  fire?: FireOptions;
}

// Which choice was in charge when the worst moment happened. The pot lags behind the kiln, so
// what matters is the range the pot itself was passing through (the middle of its spread).
export function blame(f: Firing, built: Built): Choice {
  const w = f.worst;
  if (w.opened) return 'open';
  const mid = (w.coldest + w.hottest) / 2;
  const heating = w.segment < built.owner.length && built.owner[w.segment].startsWith('heat');
  if (heating) return mid < 500 ? 'heatLow' : mid < 650 ? 'heatQuartz' : 'heatHigh';
  if (mid > 700) return 'coolHigh';
  if (mid > 500) return 'coolQuartz';
  if (mid > 300) return 'coolMid';
  return 'coolLow';
}

const NEIGHBOURS: Record<Choice, Choice[]> = {
  heatLow: ['heatQuartz'],
  heatQuartz: ['heatLow', 'heatHigh'],
  heatHigh: ['heatQuartz'],
  coolHigh: ['coolQuartz'],
  coolQuartz: ['coolHigh', 'coolMid'],
  coolMid: ['coolQuartz', 'coolLow'],
  coolLow: ['coolMid', 'open'],
  open: ['coolLow', 'coolMid'],
};

export function plan(shape: Shape, clay: Clay, kiln: Kiln, peak: number, opts: PlanOptions): PlanResult {
  const free = new Set(opts.choices ?? CHOICES);
  const maxEval = opts.maxEvaluations ?? 160;
  const cache = new Map<string, Firing>();
  let evaluations = 0;
  const run = (p: Plan): Firing => {
    const key = CHOICES.map((c) => p[c]).join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    const b = build(p, peak, opts.hold);
    const f = fire(shape, clay, kiln, b.schedule, { ...opts.fire, openAt: b.openAt });
    evaluations++;
    cache.set(key, f);
    return f;
  };
  const ok = (f: Firing) => f.chance <= opts.limit;
  const steps: string[] = [];
  let cur: Plan = { ...(opts.start ?? fastest()) };
  let f = run(cur);

  // 1. Slow down whatever is to blame until safe.
  while (!ok(f) && evaluations < maxEval) {
    const b = build(cur, peak, opts.hold);
    const culprit = blame(f, b);
    const order = [culprit, ...NEIGHBOURS[culprit], ...CHOICES];
    const pick = order.find((c) => free.has(c) && cur[c] > 0);
    if (!pick) break; // everything is as cautious as it goes
    cur = { ...cur, [pick]: cur[pick] - 1 };
    steps.push(`slower: ${LABELS[pick]}`);
    f = run(cur);
  }
  const safe = ok(f);

  // 2. Speed back up wherever it stays safe.
  if (safe) {
    let improved = true;
    while (improved && evaluations < maxEval) {
      improved = false;
      for (const c of CHOICES) {
        if (!free.has(c) || cur[c] >= ladder(c).length - 1) continue;
        const next = { ...cur, [c]: cur[c] + 1 };
        const g = run(next);
        if (ok(g) && g.duration < f.duration - 1) {
          cur = next;
          f = g;
          improved = true;
          steps.push(`faster: ${LABELS[c]}`);
        }
        if (evaluations >= maxEval) break;
      }
    }
  }
  return { plan: cur, built: build(cur, peak, opts.hold), firing: f, evaluations, safe, steps };
}
