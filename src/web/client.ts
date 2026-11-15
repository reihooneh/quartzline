// Talks to the engine's worker. Only the newest request matters: older answers are dropped.

import type { Firing } from '../engine/index.js';
import type { Planned, ShapeView } from './worker.js';

export interface RunResult {
  shape: ShapeView;
  layers: number;
  mine: Firing;
  planned: Planned | null;
}

export class EngineError extends Error {}

export class Engine {
  private worker!: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (r: RunResult) => void; reject: (e: Error) => void; progress?: (n: number) => void }>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const d = e.data as { id: number; kind: string; message?: string; evaluations?: number } & RunResult;
      const p = this.pending.get(d.id);
      if (!p) return;
      if (d.kind === 'progress') { p.progress?.(d.evaluations ?? 0); return; }
      this.pending.delete(d.id);
      if (d.kind === 'done') p.resolve({ shape: d.shape, layers: d.layers, mine: d.mine, planned: d.planned });
      else p.reject(new EngineError(d.message ?? 'Something went wrong.'));
    };
    return w;
  }

  run(setupText: string, plan: boolean, progress?: (n: number) => void): Promise<RunResult> {
    const id = this.next++;
    // Anything still running is now out of date: stop it rather than wait for it.
    if (this.pending.size) {
      for (const [old, p] of this.pending) { p.reject(new EngineError('superseded')); this.pending.delete(old); }
      this.worker.terminate();
      this.worker = this.spawn();
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ id, kind: 'run', setup: setupText, plan });
    });
  }
}
