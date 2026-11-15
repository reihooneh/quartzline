// The physics against exact answers: heat conduction, thermal stress in a plate and a disc,
// conservation of heat, and the kiln's limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clayById, coolWall, plateStress, StressModel, fire, shapeOf, PRESETS, kilnById, defaultSchedule,
  Controller, heatMax, coolMax, FULL, ROOM, strain, QUARTZ_T,
} from '../../build/engine/index.js';

const plain = (over = {}) => ({
  ...clayById('stoneware'), quartz: 0, cristobalite: 0, cpSlope: 0, ...over,
});

test('heat crossing a wall matches the exact series solution for a slab', () => {
  const clay = plain();
  const L = 0.01;
  const kappa = clay.conductivity / (clay.density * clay.cp0);
  const r = coolWall({ clay, thickness: L, rate: 1e9, from: 20, to: 1020, layers: 40, film: Infinity, dt: 0.25, every: 5 });
  for (const t of [30, 60, 120, 240]) {
    const i = r.times.findIndex((x) => x >= t);
    let theta = 0;
    for (let n = 0; n < 200; n++) {
      const k = 2 * n + 1;
      theta += (4 / Math.PI) * ((-1) ** n / k) * Math.exp(-(k * k * Math.PI * Math.PI * kappa * r.times[i]) / (L * L));
    }
    const exact = 1020 - 1000 * theta;
    const m = r.temps[i].length;
    const centre = (r.temps[i][m / 2 - 1] + r.temps[i][m / 2]) / 2;
    assert.ok(Math.abs(centre - exact) < 0.01 * (exact - 20) + 0.5, `t=${t}s: ${centre.toFixed(2)} vs ${exact.toFixed(2)}`);
  }
});

test('steady cooling: the classic parabola and its surface tension, (2/3)·Eα·ΔT/(1−ν)', () => {
  const clay = plain();
  const L = 0.012;
  const R = -300; // °C/h
  const kappa = clay.conductivity / (clay.density * clay.cp0);
  const r = coolWall({ clay, thickness: L, rate: R, from: 1000, to: 100, layers: 48, film: Infinity, dt: 1, every: 30 });
  const dT = (Math.abs(R) / 3600) * L * L / (8 * kappa);
  const i = r.times.findIndex((t) => t > 2 * 3600); // well after the start, well before the end
  const m = r.temps[i].length;
  // The faces are held at the air temperature; the centre is the parabola's top.
  const centre = (r.temps[i][m / 2 - 1] + r.temps[i][m / 2]) / 2;
  const got = centre - r.air[i];
  assert.ok(Math.abs(got - dT) < 0.02 * dT, `ΔT ${got.toFixed(3)} vs ${dT.toFixed(3)}`);
  // Stress in the outermost layer, whose middle is 1/(2m) of the thickness in from the face:
  // Eα·ΔT/(1−ν)·((2y/L)² − 1/3), which is (2/3)·Eα·ΔT/(1−ν) right at the face.
  const y2 = (1 - 1 / m) ** 2;
  const sigma = clay.modulus * clay.alpha * dT * (y2 - 1 / 3) / (1 - clay.poisson);
  const face = (r.stress[i][0] + r.stress[i][m - 1]) / 2;
  assert.ok(Math.abs(face - sigma) < 0.03 * sigma, `surface stress ${(face / 1e6).toFixed(3)} vs ${(sigma / 1e6).toFixed(3)} MPa`);
});

test('a free plate with a straight-line strain profile has no stress at all', () => {
  const eps = Array.from({ length: 10 }, (_, j) => 1e-3 + 2e-4 * j);
  for (const s of plateStress(eps, 50e9, 0.2)) assert.ok(Math.abs(s) < 1e-3);
});

// A flat disc of radius b, built station by station.
function disc(b, n, h = 0.008) {
  const ds = b / n;
  const stations = Array.from({ length: n }, (_, i) => ({
    s: (i + 0.5) * ds, ds, r: (i + 0.5) * ds, z: h / 2, h, nr: 0, nz: -1, region: 'base', shelf: 'none', openness: 1, rim: i === n - 1,
  }));
  return { piece: PRESETS.plate, stations, length: b, mass: 0 };
}

test('a flat disc with a hotter middle: the hoop stress matches the exact disc formula', () => {
  const clay = plain();
  const b = 0.15, n = 120, m = 4, dT = 40;
  const sm = new StressModel(disc(b, n), clay, m);
  const temps = new Float64Array(n * m);
  sm.shape.stations.forEach((s, i) => { for (let j = 0; j < m; j++) temps[i * m + j] = 500 + dT * (s.r / b) ** 2; });
  sm.evaluate(temps);
  const E = clay.modulus, a = clay.alpha;
  for (const i of [0, n / 4, n / 2, (3 * n) / 4, n - 1]) {
    const r = sm.shape.stations[i].r;
    const exact = a * E * dT * (0.25 - (3 * r * r) / (4 * b * b));
    const got = sm.sigma[i * m];
    assert.ok(Math.abs(got - exact) < 0.03 * a * E * dT, `r=${r.toFixed(3)}: ${(got / 1e6).toFixed(3)} vs ${(exact / 1e6).toFixed(3)} MPa`);
  }
});

test('an evenly heated pot has no stress and no risk', () => {
  for (const form of Object.keys(PRESETS)) {
    const shape = shapeOf(PRESETS[form]);
    const sm = new StressModel(shape, clayById('stoneware'), 6);
    const H = sm.evaluate(new Float64Array(shape.stations.length * 6).fill(800));
    assert.ok(H < 1e-30);
    for (const s of sm.sigma) assert.ok(Math.abs(s) < 1e-3, form);
  }
});

test('every joule is accounted for: heat in through the faces equals heat stored', () => {
  for (const form of ['plate', 'bottle', 'casserole']) {
    const f = fire(shapeOf(PRESETS[form]), clayById('porcelain'), kilnById('electric'), defaultSchedule(1222), { openAt: 200 });
    assert.ok(f.finished);
    assert.ok(Math.abs(f.heatIn - f.stored) <= 1e-9 * Math.max(1, Math.abs(f.stored)) + 1e-6, `${form}: ${f.heatIn} vs ${f.stored}`);
  }
});

test('a finer time step gives nearly the same answer', () => {
  const shape = shapeOf(PRESETS.casserole);
  const clay = clayById('silica-rich');
  const run = (dtMax, stressEvery) => fire(shape, clay, kilnById('electric'), defaultSchedule(1222), { dtMax, stressEvery, openAt: 250 });
  const fine = run(2, 10), normal = run(10, 30);
  assert.ok(Math.abs(normal.worst.stress - fine.worst.stress) < 0.02 * fine.worst.stress);
  const H = (p) => -Math.log(1 - p);
  assert.ok(Math.abs(H(normal.chance) - H(fine.chance)) < 0.15 * H(fine.chance));
});

test('quartz: a sudden step at 573 °C in the expansion curve', () => {
  const c = clayById('stoneware');
  const jump = strain(c, QUARTZ_T + 15) - strain(c, QUARTZ_T - 15) - 30 * c.alpha;
  assert.ok(jump > 0.5 * c.quartz * 0.0033 * 0.9 && jump < 0.5 * c.quartz * 0.0033 * 1.1);
  assert.equal(strain(c, 20), 0);
});

test('the kiln never heats faster than it can, nor cools faster than it does on its own', () => {
  const k = kilnById('test');
  const ctl = new Controller(k, [{ rate: FULL, target: 1222, hold: 0 }, { rate: FULL, target: 100, hold: 0 }]);
  let prev = ctl.air;
  for (let t = 0; t < 30 * 3600 && !ctl.opened; t += 10) {
    ctl.advance(10);
    if (ctl.opened) break; // opening the lid at the end is meant to be fast
    const rate = ((ctl.air - prev) / 10) * 3600;
    if (rate > 0) assert.ok(rate <= heatMax(k, prev) + 1e-6);
    if (rate < 0) assert.ok(-rate <= coolMax(k, prev) * 1.001 + 1e-6);
    prev = ctl.air;
  }
  assert.ok(ctl.air <= 61);
});

test('a schedule is followed: 100 °C/h to 520 °C takes five hours', () => {
  const ctl = new Controller(kilnById('electric'), [{ rate: 100, target: 520, hold: 30 }, { rate: 100, target: 1222, hold: 0 }]);
  ctl.advance(5 * 3600);
  assert.ok(Math.abs(ctl.air - 520) < 1e-6);
  ctl.advance(29 * 60);
  assert.ok(Math.abs(ctl.air - 520) < 1e-6, 'still holding');
  ctl.advance(2 * 60);
  assert.ok(ctl.air > 520 && ctl.air < 525);
});

test('opening the lid: the air drops fast, the walls stay warmer, and the pot cools sooner', () => {
  const shape = shapeOf(PRESETS.cylinder);
  const clay = clayById('stoneware');
  const shut = fire(shape, clay, kilnById('electric'), defaultSchedule(1222));
  const open = fire(shape, clay, kilnById('electric'), defaultSchedule(1222), { openAt: 200 });
  assert.ok(open.duration < shut.duration - 3 * 3600);
  const ctl = new Controller(kilnById('electric'), [], 300);
  ctl.air = 300;
  ctl.walls = 300;
  ctl.advance(600);
  assert.ok(ctl.opened && ctl.air < ctl.walls);
  assert.ok(ROOM < ctl.air);
});
