// The explainer: a plate cooling from 700 °C through quartz, ring by ring from the middle to
// the rim. It runs the same engine as the studio, starting mid-firing.
import { CLAYS, clayById, kilnById, fire, shapeOf, strain } from '../engine/index.js';
import { $, el, svg, css, stressColour, mpa, degrees, hours, chance, reduced } from './ui.js';
const state = { clay: 'stoneware', diam: 36, thick: 9, rate: 250, res: null, shape: null, frame: 0, playing: false };
for (const c of CLAYS)
    $('w-clay').append(el('option', { value: c.id, text: c.name }));
function controls() {
    $('w-clay').value = state.clay;
    $('w-diam-out').textContent = `${state.diam} cm`;
    $('w-thick-out').textContent = `${state.thick} mm`;
    $('w-rate-out').textContent = state.rate >= 250 ? 'as fast as the kiln' : `${state.rate} °C/h`;
}
function run() {
    const clay = clayById(state.clay);
    const shape = shapeOf({ form: 'plate', diameter: state.diam / 100, height: 0.035, wall: state.thick / 1000 * 0.85, base: state.thick / 1000, foot: true }, clay.density);
    state.shape = shape;
    state.res = fire(shape, clay, kilnById('electric'), [{ rate: state.rate >= 250 ? 9999 : state.rate, target: 380, hold: 0 }], { startAt: 700, stopAt: 400, record: true, frameEvery: 60 });
    let k = 0;
    const f = state.res;
    for (let i = 0; i < f.times.length; i++)
        if (Math.abs(f.times[i] - f.worst.time) < Math.abs(f.times[k] - f.worst.time))
            k = i;
    state.frame = k;
    $('w-time').max = String(f.frames.length - 1);
    tiles();
    draw();
    document.body.dataset.ready = '1';
}
function tiles() {
    const f = state.res;
    const clay = clayById(state.clay);
    const tile = (k, v, d) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }), el('div', { class: 'd', text: d }));
    $('w-tiles').replaceChildren(tile('Largest pull', mpa(f.worst.stress), `${Math.round((100 * f.worst.stress) / clay.strength)}% of the clay's strength, at the ${f.worst.region}`), tile('Rim against middle', `${Math.round(f.worst.hottest - f.worst.coldest)} °C`, 'the gap at that moment'), tile('Chance of a crack', chance(f.chance), `cooling from 700 to 400 °C in ${hours(f.duration)}`));
}
const W = 720, H = 330;
function draw() {
    const f = state.res;
    const st = state.shape.stations;
    const clay = clayById(state.clay);
    const m = f.layers;
    const i = Math.min(state.frame, f.frames.length - 1);
    const fr = f.frames[i];
    const n = st.length;
    const L = 80, R = 90;
    const total = st[n - 1].s + st[n - 1].ds / 2;
    const x = (s) => L + ((W - L - R) * s) / total;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Temperature and stress from the middle of the plate to its rim', class: 'chart' });
    root.append(svg('text', { x: L, y: 18, class: 'mark' }, 'Temperature (blue is the coolest ring, orange the hottest)'));
    // The plate spans only tens of degrees, so the colours stretch from its coolest ring (blue)
    // to its hottest (orange).
    const mean = (a) => { let t = 0; for (let j = 0; j < m; j++)
        t += fr.temps[a * m + j]; return t / m; };
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < n; a++) {
        lo = Math.min(lo, mean(a));
        hi = Math.max(hi, mean(a));
    }
    const span = Math.max(hi - lo, 1);
    const ramp = (t) => {
        const q = (t - lo) / span;
        return [0.33 + 0.62 * q, 0.47 + 0.0 * q, 0.62 - 0.52 * q];
    };
    for (let a = 0; a < n; a++) {
        let peak = -Infinity;
        for (let j = 0; j < m; j++)
            peak = Math.max(peak, fr.stress[a * m + j]);
        const t = mean(a);
        const x0 = x(st[a].s - st[a].ds / 2), x1 = x(st[a].s + st[a].ds / 2);
        root.append(svg('rect', { x: x0.toFixed(2), y: 28, width: (x1 - x0 + 0.6).toFixed(2), height: 50, fill: css(ramp(t)) }));
        const zero = 228, scale = 80 / clay.strength;
        const h = Math.max(-80, Math.min(80, peak * scale));
        root.append(svg('rect', { x: (x0 + 0.5).toFixed(2), y: (h > 0 ? zero - h : zero).toFixed(2), width: Math.max(1, x1 - x0 - 1).toFixed(2), height: Math.abs(h).toFixed(2), fill: css(stressColour(peak / clay.strength)) }));
    }
    root.append(svg('text', { x: L, y: 96, class: 'tick' }, `middle ${degrees(mean(0))}`));
    root.append(svg('text', { x: W - R, y: 96, class: 'tick', 'text-anchor': 'end' }, `rim ${degrees(mean(n - 1))}`));
    root.append(svg('text', { x: L, y: 132, class: 'mark' }, 'Largest pull in each ring'));
    const zero = 228;
    root.append(svg('line', { x1: L, x2: W - R, y1: zero, y2: zero, class: 'axis' }));
    root.append(svg('line', { x1: L, x2: W - R, y1: zero - 80, y2: zero - 80, class: 'inversion' }));
    root.append(svg('text', { x: W - R + 8, y: zero - 76, class: 'tick' }, 'strength'));
    root.append(svg('text', { x: W - R + 8, y: zero + 4, class: 'tick' }, 'none'));
    root.append(svg('text', { x: L - 8, y: zero - 56, class: 'tick', 'text-anchor': 'end' }, 'pulled'));
    root.append(svg('text', { x: L - 8, y: zero + 60, class: 'tick', 'text-anchor': 'end' }, 'squeezed'));
    root.append(svg('text', { x: L, y: H - 8, class: 'tick' }, 'middle of the plate'));
    root.append(svg('text', { x: W - R, y: H - 8, class: 'tick', 'text-anchor': 'end' }, 'rim'));
    $('slice').replaceChildren(root);
    $('w-time').value = String(i);
    $('w-clock').textContent = hours(f.times[i]);
    let peak = 0;
    for (const s of fr.stress)
        peak = Math.max(peak, s);
    $('w-now').textContent = `${hours(f.times[i])} in: the kiln air is at ${degrees(f.air[i])}, the plate spans ${degrees(f.coldest[i])} to ${degrees(f.hottest[i])}, and the largest pull is ${mpa(peak)}.`;
}
function curve() {
    const clay = clayById(state.clay);
    const w = 720, h = 260, L = 64, R = 24, T = 16, B = 40;
    const top = strain(clay, 1000) * 1.08;
    const x = (t) => L + ((w - L - R) * t) / 1000;
    const y = (e) => T + (h - T - B) * (1 - e / top);
    const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `How ${clay.name.toLowerCase()} grows as it heats`, class: 'chart' });
    for (let t = 0; t <= 1000; t += 200) {
        root.append(svg('line', { x1: x(t), x2: x(t), y1: T, y2: h - B, class: 'grid' }));
        root.append(svg('text', { x: x(t), y: h - B + 18, class: 'tick', 'text-anchor': 'middle' }, `${t} °C`));
    }
    for (const f of [0, 0.5, 1]) {
        root.append(svg('text', { x: L - 8, y: y(top * f * 0.9) + 4, class: 'tick', 'text-anchor': 'end' }, `${((top * f * 0.9) * 100).toFixed(2)}%`));
    }
    let d = '';
    for (let t = 20; t <= 1000; t += 2)
        d += `${t === 20 ? 'M' : 'L'}${x(t).toFixed(1)},${y(strain(clay, t)).toFixed(1)}`;
    root.append(svg('path', { d, class: 'air' }));
    root.append(svg('line', { x1: x(573), x2: x(573), y1: T, y2: h - B, class: 'inversion' }));
    root.append(svg('line', { x1: x(226), x2: x(226), y1: T, y2: h - B, class: 'inversion' }));
    root.append(svg('text', { x: x(573) + 6, y: T + 12, class: 'mark' }, 'quartz'));
    root.append(svg('text', { x: x(226) + 6, y: T + 12, class: 'mark' }, 'cristobalite'));
    $('curve').replaceChildren(root);
}
let timer = 0;
function later() {
    clearTimeout(timer);
    timer = window.setTimeout(run, 120);
}
$('w-clay').addEventListener('change', () => { state.clay = $('w-clay').value; controls(); run(); curve(); });
for (const [id, key] of [['w-diam', 'diam'], ['w-thick', 'thick'], ['w-rate', 'rate']]) {
    $(id).addEventListener('input', () => { state[key] = Number($(id).value); controls(); later(); });
}
$('w-time').addEventListener('input', () => { stop(); state.frame = Number($('w-time').value); draw(); });
$('w-play').addEventListener('click', () => (state.playing ? stop() : play()));
function play() {
    const f = state.res;
    if (reduced()) {
        state.frame = f.frames.length - 1;
        draw();
        return;
    }
    state.playing = true;
    $('w-play').textContent = 'Pause';
    if (state.frame >= f.frames.length - 1)
        state.frame = 0;
    const step = () => {
        if (!state.playing)
            return;
        state.frame++;
        draw();
        if (state.frame >= f.frames.length - 1)
            stop();
        else
            setTimeout(step, 80);
    };
    step();
}
function stop() {
    state.playing = false;
    $('w-play').textContent = 'Play';
}
controls();
run();
curve();
