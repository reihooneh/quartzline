// Stress from uneven temperature. Clay that is hotter wants to be bigger; clay next to it that
// is cooler holds it back. Two effects are added:
//
//  1. Across the wall: a free plate can bend and stretch, so only the part of the strain
//     profile that isn't a straight line causes stress (the classic free-plate result).
//  2. Along the pot: each ring of wall is held by its neighbours. In a shell, a ring's mismatch
//     is resisted over a distance of about 2.4·√(R·h), where R is the ring's radius of
//     curvature (the radius for a cylinder, infinity for a flat base). For a flat disc the exact
//     hoop stress is E·(½·mean over the whole disc + ½·mean inside this radius − own strain);
//     Quartzline uses the same form with every mean weighted to the neighbours within reach, so
//     it is exact for a disc and local for a tall wall.
import { REFERENCE_VOLUME, StrainTable } from './clay.js';
export class StressModel {
    shape;
    clay;
    layers;
    n;
    weights; // n × n, rows sum to 1
    inner; // n × n, the same but only nearer the centre of the base (k ≤ i)
    lo; // per row, the first and last columns with a weight that matters
    hi;
    volumes; // one cell's volume at each station, m³
    mean;
    sigma; // n × m, Pa (positive = tension)
    peak; // n: largest tension at each station, Pa
    peakFace; // n: the layer it's in
    ys; // m: layer positions as fractions of the thickness (−½..½)
    table;
    eps;
    constructor(shape, clay, layers) {
        this.shape = shape;
        this.clay = clay;
        this.layers = layers;
        const st = shape.stations;
        const n = st.length;
        this.n = n;
        this.table = new StrainTable(clay);
        this.weights = new Float64Array(n * n);
        this.inner = new Float64Array(n * n);
        this.lo = new Int32Array(n);
        this.hi = new Int32Array(n);
        this.volumes = new Float64Array(n);
        this.mean = new Float64Array(n);
        this.sigma = new Float64Array(n * layers);
        this.peak = new Float64Array(n);
        this.peakFace = new Uint8Array(n);
        this.eps = new Float64Array(n * layers);
        this.ys = new Float64Array(layers);
        for (let j = 0; j < layers; j++)
            this.ys[j] = (j + 0.5) / layers - 0.5;
        // How far each ring's influence reaches; a pair of rings is coupled over the shorter of
        // their two reaches (a flat base is coupled as a whole, but only to the wall near it).
        const reach = st.map((s) => {
            const curvature = Math.abs(s.nr) > 1e-6 ? s.r / Math.abs(s.nr) : Infinity;
            return 2.4 * Math.sqrt(curvature * s.h);
        });
        for (let i = 0; i < n; i++) {
            const s = st[i];
            this.volumes[i] = (2 * Math.PI * s.r * s.ds * s.h) / layers;
            let sum = 0, sumIn = 0;
            for (let k = 0; k < n; k++) {
                const t = st[k];
                const r = Math.min(reach[i], reach[k]);
                const w = t.r * t.h * t.ds * (Number.isFinite(r) ? Math.exp(-Math.abs(s.s - t.s) / r) : 1);
                this.weights[i * n + k] = w;
                sum += w;
                if (k <= i) {
                    this.inner[i * n + k] = w;
                    sumIn += w;
                }
            }
            let lo = n, hi = -1;
            for (let k = 0; k < n; k++) {
                this.weights[i * n + k] /= sum;
                this.inner[i * n + k] /= sumIn;
                if (this.weights[i * n + k] > 1e-9 || k === i) {
                    lo = Math.min(lo, k);
                    hi = Math.max(hi, k);
                }
            }
            this.lo[i] = lo;
            this.hi[i] = hi;
        }
    }
    // Works out the stress for a temperature field (n × m, °C) and returns the Weibull risk
    // integral H: the chance the piece survives this moment is exp(−H).
    evaluate(temps) {
        const { n, layers: m, clay, ys, eps, mean, sigma } = this;
        const E = clay.modulus;
        const plate = E / (1 - clay.poisson);
        let sy2 = 0;
        for (let j = 0; j < m; j++)
            sy2 += ys[j] * ys[j];
        for (let i = 0; i < n; i++) {
            let s = 0;
            for (let j = 0; j < m; j++) {
                const e = this.table.at(temps[i * m + j]);
                eps[i * m + j] = e;
                s += e;
            }
            mean[i] = s / m;
        }
        let H = 0;
        const inv = 1 / clay.strength;
        for (let i = 0; i < n; i++) {
            let all = 0, inside = 0;
            const row = i * n;
            for (let k = this.lo[i], end = this.hi[i]; k <= end; k++) {
                all += this.weights[row + k] * mean[k];
                inside += this.inner[row + k] * mean[k];
            }
            const membrane = E * (0.5 * all + 0.5 * inside - mean[i]);
            let slope = 0;
            for (let j = 0; j < m; j++)
                slope += ys[j] * (eps[i * m + j] - mean[i]);
            slope /= sy2;
            let best = -Infinity, face = 0;
            for (let j = 0; j < m; j++) {
                const through = plate * (mean[i] + slope * ys[j] - eps[i * m + j]);
                const total = membrane + through;
                sigma[i * m + j] = total;
                if (total > best) {
                    best = total;
                    face = j;
                }
                if (total > 0)
                    H += (this.volumes[i] / REFERENCE_VOLUME) * Math.pow(total * inv, clay.weibull);
            }
            this.peak[i] = best;
            this.peakFace[i] = face;
        }
        return H;
    }
}
// The chance of a crack from the largest risk integral reached.
export function crackChance(H) {
    return 1 - Math.exp(-H);
}
