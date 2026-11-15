// A single flat piece of wall, cooled (or heated) evenly on both faces: the explainer's model.
// It shows the temperature across the wall and the stress it causes, layer by layer.
import { StrainTable } from './clay.js';
const SIGMA = 5.670374419e-8;
// Stress across a free plate from its strain profile (layers equally thick): only the part of
// the strain that isn't a straight line causes stress.
export function plateStress(eps, modulus, poisson, out) {
    const m = eps.length;
    const res = out ?? new Float64Array(m);
    let mean = 0;
    for (let j = 0; j < m; j++)
        mean += eps[j];
    mean /= m;
    let sy2 = 0, slope = 0;
    for (let j = 0; j < m; j++) {
        const y = (j + 0.5) / m - 0.5;
        sy2 += y * y;
        slope += y * (eps[j] - mean);
    }
    slope /= sy2;
    const k = modulus / (1 - poisson);
    for (let j = 0; j < m; j++) {
        const y = (j + 0.5) / m - 0.5;
        res[j] = k * (mean + slope * y - eps[j]);
    }
    return res;
}
export function coolWall(o) {
    const m = o.layers ?? 24;
    const dt = o.dt ?? 2;
    const every = o.every ?? 60;
    const c = o.clay;
    const dy = o.thickness / m;
    const k = c.conductivity;
    const table = new StrainTable(c);
    const T = new Float64Array(m).fill(o.from);
    const a = new Float64Array(m), b = new Float64Array(m), cc = new Float64Array(m), d = new Float64Array(m);
    const cp = new Float64Array(m), dp = new Float64Array(m);
    const eps = new Float64Array(m);
    const sig = new Float64Array(m);
    const film = o.film ?? 8;
    const rate = o.rate / 3600;
    const total = Math.abs((o.to - o.from) / rate) + 4 * 3600 * (o.thickness / 0.01) ** 2;
    const res = { times: [], air: [], temps: [], stress: [], peakFace: 0, peakMiddle: 0, worst: 0 };
    let best = -Infinity;
    let next = 0;
    const g = k / dy; // per m² between layers
    for (let t = 0; t <= total + 1e-9; t += dt) {
        const air = rate < 0 ? Math.max(o.to, o.from + rate * t) : Math.min(o.to, o.from + rate * t);
        if (t > 0) {
            for (let j = 0; j < m; j++) {
                const C = (c.density * (c.cp0 + c.cpSlope * Math.min(Math.max(T[j], 0), 1300)) * dy) / dt;
                a[j] = j > 0 ? -g : 0;
                cc[j] = j < m - 1 ? -g : 0;
                b[j] = C + (j > 0 ? g : 0) + (j < m - 1 ? g : 0);
                d[j] = C * T[j];
            }
            for (const j of [0, m - 1]) {
                let h;
                if (!Number.isFinite(film))
                    h = 1e9;
                else {
                    const A = T[j] + 273.15, B = air + 273.15;
                    h = c.emissivity * SIGMA * (A * A + B * B) * (A + B) + film;
                }
                const gf = 1 / (1 / h + dy / 2 / k);
                b[j] += gf;
                d[j] += gf * air;
            }
            cp[0] = cc[0] / b[0];
            dp[0] = d[0] / b[0];
            for (let j = 1; j < m; j++) {
                const den = b[j] - a[j] * cp[j - 1];
                cp[j] = cc[j] / den;
                dp[j] = (d[j] - a[j] * dp[j - 1]) / den;
            }
            T[m - 1] = dp[m - 1];
            for (let j = m - 2; j >= 0; j--)
                T[j] = dp[j] - cp[j] * T[j + 1];
        }
        for (let j = 0; j < m; j++)
            eps[j] = table.at(T[j]);
        plateStress(eps, c.modulus, c.poisson, sig);
        const face = Math.max(sig[0], sig[m - 1]);
        const middle = sig[m >> 1];
        res.peakFace = Math.max(res.peakFace, face);
        res.peakMiddle = Math.max(res.peakMiddle, middle);
        if (t >= next) {
            res.times.push(t);
            res.air.push(air);
            res.temps.push(T.slice());
            res.stress.push(sig.slice());
            const top = Math.max(face, middle);
            if (top > best) {
                best = top;
                res.worst = res.times.length - 1;
            }
            next += every;
        }
    }
    return res;
}
