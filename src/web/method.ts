// The method page: a few checks against exact answers, run live.

import { clayById, coolWall, StressModel, PRESETS, fire, shapeOf, kilnById, defaultSchedule } from '../engine/index.js';
import { $, el } from './ui.js';

type Row = [string, string, string];

function checks(): Row[] {
  const rows: Row[] = [];
  const clay = { ...clayById('stoneware')!, quartz: 0, cristobalite: 0, cpSlope: 0 };

  // 1. A 1 cm slab whose faces jump to 1020 °C: its centre after two minutes.
  {
    const L = 0.01;
    const kappa = clay.conductivity / (clay.density * clay.cp0);
    const r = coolWall({ clay, thickness: L, rate: 1e9, from: 20, to: 1020, layers: 40, film: Infinity, dt: 0.25, every: 5 });
    const i = r.times.findIndex((t) => t >= 120);
    let theta = 0;
    for (let n = 0; n < 200; n++) {
      const k = 2 * n + 1;
      theta += (4 / Math.PI) * ((-1) ** n / k) * Math.exp(-(k * k * Math.PI * Math.PI * kappa * r.times[i]) / (L * L));
    }
    const centre = (r.temps[i][19] + r.temps[i][20]) / 2;
    rows.push(['Centre of a 1 cm slab, 2 min after its faces reach 1020 °C', `${centre.toFixed(1)} °C`, `${(1020 - 1000 * theta).toFixed(1)} °C`]);
  }
  // 2. Steady cooling at 300 °C/h: the pull at the faces.
  {
    const L = 0.012, R = 300;
    const kappa = clay.conductivity / (clay.density * clay.cp0);
    const m = 48;
    const r = coolWall({ clay, thickness: L, rate: -R, from: 1000, to: 100, layers: m, film: Infinity, dt: 1, every: 30 });
    const i = r.times.findIndex((t) => t > 2 * 3600);
    const dT = (R / 3600) * L * L / (8 * kappa);
    const want = clay.modulus * clay.alpha * dT * ((1 - 1 / m) ** 2 - 1 / 3) / (1 - clay.poisson);
    const got = (r.stress[i][0] + r.stress[i][m - 1]) / 2;
    rows.push(['Pull at the faces of a 12 mm wall cooling at 300 °C/h', `${(got / 1e6).toFixed(3)} MPa`, `${(want / 1e6).toFixed(3)} MPa`]);
  }
  // 3. A flat disc 40 °C hotter in the middle: hoop stress at the rim.
  {
    const b = 0.15, n = 120, m = 4, dT = 40, ds = b / n;
    const stations = Array.from({ length: n }, (_, i) => ({ s: (i + 0.5) * ds, ds, r: (i + 0.5) * ds, z: 0.004, h: 0.008, nr: 0, nz: -1, region: 'base', shelf: 'none' as const, openness: 1, rim: i === n - 1 }));
    const sm = new StressModel({ piece: PRESETS.plate, stations, length: b, mass: 0 }, clay, m);
    const temps = new Float64Array(n * m);
    stations.forEach((s, i) => { for (let j = 0; j < m; j++) temps[i * m + j] = 500 - dT * (s.r / b) ** 2; });
    sm.evaluate(temps);
    const got = sm.sigma[(n - 1) * m];
    const r = stations[n - 1].r;
    const want = clay.alpha * clay.modulus * -dT * (0.25 - (3 * r * r) / (4 * b * b));
    rows.push(['Rim of a 30 cm disc whose middle is 40 °C hotter', `${(got / 1e6).toFixed(3)} MPa`, `${(want / 1e6).toFixed(3)} MPa`]);
  }
  // 4. A whole firing of a mug: heat in through the faces against heat stored.
  {
    const f = fire(shapeOf(PRESETS.cylinder), clayById('stoneware')!, kilnById('electric')!, defaultSchedule(1222), { openAt: 200 });
    rows.push(['A whole mug firing: heat in through the faces, against heat stored', `${(f.heatIn / 1e3).toFixed(3)} kJ`, `${(f.stored / 1e3).toFixed(3)} kJ`]);
  }
  return rows;
}

setTimeout(() => {
  const rows = checks();
  $<HTMLTableElement>('checks').tBodies[0].replaceChildren(...rows.map(([a, b, c]) => el('tr', {}, el('th', { scope: 'row', text: a }), el('td', { class: 'num', text: b }), el('td', { class: 'num', text: c }))));
  document.body.dataset.ready = '1';
}, 30);
