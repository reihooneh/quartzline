// The engine runs here, off the page's thread, so the page never freezes while a firing is
// simulated or a schedule planned. Every message is checked before anything is done with it.

import { parseSetup, shapeOf, fire, plan, compact, scheduleText, SetupError, Firing, Shape, outline, Segment, LABELS } from '../engine/index.js';

interface Request { id: number; kind: 'run'; setup: string; plan: boolean }

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t?: Transferable[]) => void };

export interface ShapeView {
  stations: { r: number; z: number; h: number; nr: number; nz: number; region: string }[];
  outline: ReturnType<typeof outline>;
  length: number;
  mass: number;
}

export interface Planned {
  schedule: Segment[];
  openAt: number;
  text: string;
  firing: Firing;
  steps: string[];
  safe: boolean;
  evaluations: number;
}

function view(sh: Shape): ShapeView {
  return {
    stations: sh.stations.map((s) => ({ r: s.r, z: s.z, h: s.h, nr: s.nr, nz: s.nz, region: s.region })),
    outline: outline(sh),
    length: sh.length,
    mass: sh.mass,
  };
}

function valid(d: unknown): d is Request {
  if (typeof d !== 'object' || d === null) return false;
  const r = d as Record<string, unknown>;
  return r.kind === 'run' && Number.isInteger(r.id) && typeof r.setup === 'string' && r.setup.length <= 20000 && typeof r.plan === 'boolean';
}

scope.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (!valid(d)) return;
  try {
    const setup = parseSetup(d.setup);
    const shape = shapeOf(setup.piece, setup.clay.density);
    const mine = fire(shape, setup.clay, setup.kiln, setup.schedule, { openAt: setup.openAt, record: true });
    let planned: Planned | null = null;
    if (d.plan) {
      let last = 0;
      const r = plan(shape, setup.clay, setup.kiln, setup.cone.peak, {
        limit: setup.limit,
        hold: Math.max(0, ...setup.schedule.filter((s) => Math.abs(s.target - setup.cone.peak) < 31).map((s) => s.hold)),
        onProgress: (n) => {
          const now = Date.now();
          if (now - last > 150) { last = now; scope.postMessage({ id: d.id, kind: 'progress', evaluations: n }); }
        },
      });
      const again = fire(shape, setup.clay, setup.kiln, r.built.schedule, { openAt: r.built.openAt, record: true });
      const segments = compact(r.built.schedule);
      planned = {
        schedule: segments, openAt: r.built.openAt, text: scheduleText(segments), firing: again,
        steps: r.steps, safe: r.safe, evaluations: r.evaluations,
      };
    }
    scope.postMessage({ id: d.id, kind: 'done', shape: view(shape), layers: mine.layers, mine, planned, labels: LABELS });
  } catch (err) {
    const message = err instanceof SetupError ? err.message : 'Something went wrong simulating this firing.';
    scope.postMessage({ id: d.id, kind: 'error', message });
  }
};
