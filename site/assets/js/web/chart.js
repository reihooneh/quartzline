// The firing chart: the kiln's temperature, the hottest and coldest parts of the pot, the two
// inversions, and below it the chance of a crack building up. Labels sit in the margins so
// nothing is drawn over anything else.
import { svg } from './ui.js';
const W = 720, H = 330;
const L = 48, R = 140, T = 14;
const PLOT = 200; // height of the temperature panel
const GAP = 34;
const STRIP = 54; // height of the risk panel
export function firingChart(s, title, top = 1300) {
    const end = s.times[s.times.length - 1] || 1;
    const x = (t) => L + ((W - L - R) * t) / end;
    const y = (c) => T + PLOT - (PLOT * Math.min(c, top)) / top;
    const riskTop = Math.max(0.02, ...s.risk) * 1.1;
    const yr = (p) => T + PLOT + GAP + STRIP - (STRIP * p) / riskTop;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, class: 'chart' });
    // Grid and axes.
    for (let c = 0; c <= top; c += 300) {
        root.append(svg('line', { x1: L, x2: W - R, y1: y(c), y2: y(c), class: 'grid' }));
        root.append(svg('text', { x: L - 8, y: y(c) + 4, class: 'tick', 'text-anchor': 'end' }, `${c}`));
    }
    root.append(svg('text', { x: L - 8, y: T - 2 + 0, class: 'tick unit', 'text-anchor': 'end' }, '°C'));
    const hours = end / 3600;
    const step = hours > 30 ? 6 : hours > 14 ? 4 : hours > 6 ? 2 : 1;
    for (let h = 0; h <= hours + 1e-9; h += step) {
        root.append(svg('line', { x1: x(h * 3600), x2: x(h * 3600), y1: T + PLOT, y2: T + PLOT + 5, class: 'axis' }));
        root.append(svg('text', { x: x(h * 3600), y: T + PLOT + 18, class: 'tick', 'text-anchor': 'middle' }, `${h} h`));
    }
    root.append(svg('line', { x1: L, x2: W - R, y1: T + PLOT, y2: T + PLOT, class: 'axis' }));
    // The inversions, labelled in the right margin.
    const marks = [[573, 'quartz 573 °C'], [226, 'cristobalite 226 °C']];
    for (const [c, label] of marks) {
        root.append(svg('line', { x1: L, x2: W - R, y1: y(c), y2: y(c), class: 'inversion' }));
        root.append(svg('text', { x: W - R + 8, y: y(c) + 4, class: 'mark' }, label));
    }
    // The pot's spread (coldest to hottest) as a band, and the kiln air as a line.
    let band = '';
    for (let i = 0; i < s.times.length; i++)
        band += `${i ? 'L' : 'M'}${x(s.times[i]).toFixed(1)},${y(s.hottest[i]).toFixed(1)}`;
    for (let i = s.times.length - 1; i >= 0; i--)
        band += `L${x(s.times[i]).toFixed(1)},${y(s.coldest[i]).toFixed(1)}`;
    root.append(svg('path', { d: band + 'Z', class: 'spread' }));
    let air = '';
    for (let i = 0; i < s.times.length; i++)
        air += `${i ? 'L' : 'M'}${x(s.times[i]).toFixed(1)},${y(s.air[i]).toFixed(1)}`;
    root.append(svg('path', { d: air, class: 'air' }));
    // Risk panel.
    const r0 = T + PLOT + GAP;
    root.append(svg('line', { x1: L, x2: W - R, y1: r0 + STRIP, y2: r0 + STRIP, class: 'axis' }));
    let risk = `M${L},${r0 + STRIP}`;
    for (let i = 0; i < s.times.length; i++)
        risk += `L${x(s.times[i]).toFixed(1)},${yr(s.risk[i]).toFixed(1)}`;
    risk += `L${x(end)},${r0 + STRIP}Z`;
    root.append(svg('path', { d: risk, class: 'risk' }));
    root.append(svg('text', { x: W - R + 8, y: r0 + STRIP / 2 + 4, class: 'mark' }, 'crack chance'));
    root.append(svg('text', { x: L - 8, y: r0 + 10, class: 'tick', 'text-anchor': 'end' }, `${Math.round(riskTop * 100)}%`));
    root.append(svg('text', { x: L - 8, y: r0 + STRIP, class: 'tick', 'text-anchor': 'end' }, '0'));
    const line = svg('line', { x1: L, x2: L, y1: T, y2: r0 + STRIP, class: 'cursor' });
    root.append(line);
    return {
        root,
        cursor: (t) => {
            const px = x(Math.min(Math.max(t, 0), end)).toFixed(1);
            line.setAttribute('x1', px);
            line.setAttribute('x2', px);
        },
    };
}
