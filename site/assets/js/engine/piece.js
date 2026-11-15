// A pot is turned on a wheel, so it is the same all the way round: one profile, spun about the
// axis, describes it. Quartzline follows the middle of the wall from the centre of the base out
// and up to the rim, and cuts it into stations a few millimetres apart.
export const FORMS = ['plate', 'bowl', 'cylinder', 'bottle', 'casserole'];
export const PIECE_LIMITS = {
    diameter: [0.04, 0.6],
    height: [0.01, 0.6],
    wall: [0.003, 0.03],
    base: [0.003, 0.04],
};
export const PRESETS = {
    plate: { form: 'plate', diameter: 0.27, height: 0.03, wall: 0.007, base: 0.009, foot: true },
    bowl: { form: 'bowl', diameter: 0.18, height: 0.085, wall: 0.006, base: 0.008, foot: true },
    cylinder: { form: 'cylinder', diameter: 0.09, height: 0.11, wall: 0.006, base: 0.008, foot: false },
    bottle: { form: 'bottle', diameter: 0.16, height: 0.28, wall: 0.007, base: 0.009, foot: false },
    casserole: { form: 'casserole', diameter: 0.26, height: 0.12, wall: 0.011, base: 0.014, foot: false },
};
// The profile as a dense polyline of (r, z) on the middle of the wall, with the thickness there.
function polyline(p) {
    const R = p.diameter / 2;
    const H = p.height;
    const w = p.wall;
    const b = p.base;
    const pts = [];
    const add = (r, z, h) => pts.push({ r, z, h });
    const line = (r0, z0, r1, z1, h0, h1, n) => {
        for (let i = 0; i < n; i++) {
            const f = i / n;
            add(r0 + (r1 - r0) * f, z0 + (z1 - z0) * f, h0 + (h1 - h0) * f);
        }
    };
    const arc = (cr, cz, ar, az, a0, a1, h0, h1, n) => {
        for (let i = 0; i < n; i++) {
            const f = i / n;
            const a = a0 + (a1 - a0) * f;
            add(cr + ar * Math.cos(a), cz + az * Math.sin(a), h0 + (h1 - h0) * f);
        }
    };
    const zb = b / 2; // middle of the base
    switch (p.form) {
        case 'plate': {
            // A flat well, then a shallow curved rim rising to the full height.
            const well = R * 0.62;
            line(0, zb, well, zb, b, b, 120);
            const rise = Math.max(H - zb - w / 2, 0.002);
            arc(well, zb + rise, R - w / 2 - well, rise, -Math.PI / 2, 0, b, w, 120);
            add(R - w / 2, H - w / 2 + 0.0001, w);
            break;
        }
        case 'bowl': {
            // A small flat centre, then a quarter-ellipse up to the rim.
            const flat = R * 0.22;
            line(0, zb, flat, zb, b, b, 40);
            const rise = Math.max(H - zb, 0.004);
            arc(flat, zb + rise, R - w / 2 - flat, rise, -Math.PI / 2, 0, b, w, 200);
            add(R - w / 2, H, w);
            break;
        }
        case 'cylinder':
        case 'casserole': {
            // A flat base, a rounded corner and a straight wall.
            const rc = Math.min(0.012, H * 0.25, R * 0.25);
            const wallR = R - w / 2;
            line(0, zb, wallR - rc, zb, b, b, 120);
            arc(wallR - rc, zb + rc, rc, rc, -Math.PI / 2, 0, b, w, 40);
            line(wallR, zb + rc, wallR, H, w, w, 160);
            add(wallR, H, w);
            break;
        }
        case 'bottle': {
            // Base, round belly, shoulder curving in to a narrow neck.
            const neckR = Math.max(R * 0.32, w * 2);
            const bellyZ = H * 0.38;
            const flat = R * 0.55;
            const wallR = R - w / 2;
            line(0, zb, flat, zb, b, b, 80);
            arc(flat, bellyZ, wallR - flat, bellyZ - zb, -Math.PI / 2, 0, b, w, 80);
            const shoulderTop = H * 0.82;
            arc(neckR, bellyZ, wallR - neckR, shoulderTop - bellyZ, 0, Math.PI / 2, w, w, 120);
            // The arc ends at r = neckR, heading inwards; the neck rises straight from there.
            line(neckR, shoulderTop, neckR, H, w, w, 60);
            add(neckR, H, w);
            break;
        }
    }
    return pts;
}
function regionOf(p, r, z, nz, frac) {
    if (frac > 0.92)
        return 'rim';
    if (nz < -0.7 && z < p.base * 1.5)
        return r < p.diameter * 0.12 ? 'centre of the base' : 'base';
    if (p.form === 'bottle' && z > p.height * 0.8)
        return 'neck';
    if (p.form === 'bottle' && z > p.height * 0.5)
        return 'shoulder';
    if (z < p.height * 0.25)
        return p.form === 'plate' ? 'base' : 'lower wall';
    if (z < p.height * 0.6)
        return p.form === 'plate' ? 'rim slope' : 'middle of the wall';
    return p.form === 'plate' ? 'rim slope' : 'upper wall';
}
// Resample the profile into stations of roughly equal length (at most 60).
export function shapeOf(p, density = 2200) {
    const pts = polyline(p);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i].r - pts[i - 1].r, pts[i].z - pts[i - 1].z));
    }
    const length = cum[cum.length - 1];
    const n = Math.max(12, Math.min(60, Math.round(length / 0.005)));
    const ds = length / n;
    const at = (s) => {
        let k = 1;
        while (k < cum.length - 1 && cum[k] < s)
            k++;
        const span = cum[k] - cum[k - 1] || 1e-12;
        const f = Math.min(1, Math.max(0, (s - cum[k - 1]) / span));
        const a = pts[k - 1], b = pts[k];
        const tr = (b.r - a.r) / span, tz = (b.z - a.z) / span;
        const len = Math.hypot(tr, tz) || 1;
        return { r: a.r + (b.r - a.r) * f, z: a.z + (b.z - a.z) * f, h: a.h + (b.h - a.h) * f, tr: tr / len, tz: tz / len };
    };
    const rimR = p.form === 'bottle' ? Math.max(p.diameter / 2 * 0.32, p.wall * 2) : p.diameter / 2 - p.wall / 2;
    const stations = [];
    let mass = 0;
    for (let i = 0; i < n; i++) {
        const s = (i + 0.5) * ds;
        const q = at(s);
        // Walking outwards along the profile with the inside of the pot on the left, the outward
        // normal is the tangent turned clockwise.
        let nr = q.tz, nz = -q.tr;
        if (i === 0 || (Math.abs(q.tz) < 1e-9 && q.tr > 0)) {
            nr = 0;
            nz = -1;
        }
        const frac = s / length;
        const z = q.z;
        const onBase = nz < -0.7 && z < p.base * 1.5;
        let shelf = 'none';
        if (onBase) {
            if (!p.foot)
                shelf = 'contact';
            else
                shelf = Math.abs(q.r - p.diameter * 0.32) < p.diameter * 0.05 + 0.004 ? 'contact' : 'gap';
        }
        const depth = Math.max(0, p.height - z);
        const openness = Math.min(1, rimR / (rimR + depth));
        stations.push({
            s, ds, r: Math.max(q.r, ds / 4), z, h: q.h, nr, nz,
            region: regionOf(p, q.r, z, nz, frac), shelf, openness, rim: i === n - 1,
        });
        mass += 2 * Math.PI * Math.max(q.r, ds / 4) * ds * q.h * density;
    }
    return { piece: p, stations, length, mass };
}
// The outline of the pot's cross-section, for drawing: outer face from the base centre up to the
// rim, then the inner face back down. Each point says which station and face it belongs to.
export function outline(shape) {
    const out = [];
    const st = shape.stations;
    out.push({ r: 0, z: 0, station: 0, face: 'outer' });
    for (let i = 0; i < st.length; i++) {
        const s = st[i];
        out.push({ r: Math.max(0, s.r + s.nr * s.h / 2), z: Math.max(0, s.z + s.nz * s.h / 2), station: i, face: 'outer' });
    }
    for (let i = st.length - 1; i >= 0; i--) {
        const s = st[i];
        out.push({ r: Math.max(0, s.r - s.nr * s.h / 2), z: s.z - s.nz * s.h / 2, station: i, face: 'inner' });
    }
    const s0 = st[0];
    out.push({ r: 0, z: s0.z + s0.h / 2, station: 0, face: 'inner' });
    return out;
}
