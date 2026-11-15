// Talks to the engine's worker. Only the newest request matters: older answers are dropped.
export class EngineError extends Error {
}
export class Engine {
    worker;
    next = 1;
    pending = new Map();
    constructor() {
        this.worker = this.spawn();
    }
    spawn() {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => {
            const d = e.data;
            const p = this.pending.get(d.id);
            if (!p)
                return;
            if (d.kind === 'progress') {
                p.progress?.(d.evaluations ?? 0);
                return;
            }
            this.pending.delete(d.id);
            if (d.kind === 'done')
                p.resolve({ shape: d.shape, layers: d.layers, mine: d.mine, planned: d.planned });
            else
                p.reject(new EngineError(d.message ?? 'Something went wrong.'));
        };
        return w;
    }
    run(setupText, plan, progress) {
        const id = this.next++;
        // Anything still running is now out of date: stop it rather than wait for it.
        if (this.pending.size) {
            for (const [old, p] of this.pending) {
                p.reject(new EngineError('superseded'));
                this.pending.delete(old);
            }
            this.worker.terminate();
            this.worker = this.spawn();
        }
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, progress });
            this.worker.postMessage({ id, kind: 'run', setup: setupText, plan });
        });
    }
}
