// The planner, the behaviour a potter would expect, and hostile setup files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clayById, kilnById, shapeOf, PRESETS, fire, defaultSchedule, plan, build, fastest, ladder, CHOICES,
  parseSetup, toFile, defaultSetup, SetupError, MAX_FILE, compact, scheduleText, FULL, outline,
} from '../../build/engine/index.js';

const platter = { form: 'plate', diameter: 0.4, height: 0.04, wall: 0.009, base: 0.012, foot: true };

test('the plan meets the limit, and is faster than the usual slow-and-steady schedule', () => {
  const clay = clayById('stoneware');
  const shape = shapeOf(platter, clay.density);
  const kiln = kilnById('electric');
  const r = plan(shape, clay, kiln, 1222, { limit: 0.01, hold: 10 });
  assert.ok(r.safe && r.firing.chance <= 0.01);
  const usual = fire(shape, clay, kiln, defaultSchedule(1222));
  assert.ok(usual.chance > 0.05, 'the usual schedule is risky for a big platter');
  // Re-running the planned schedule gives the same answer.
  const again = fire(shape, clay, kiln, r.built.schedule, { openAt: r.built.openAt });
  assert.equal(again.chance, r.firing.chance);
});

test('on two choices at a time the planner finds the same firing time as trying every combination', () => {
  const cases = [
    ['plate', 'stoneware', 'test', ['coolQuartz', 'open']],
    ['casserole', 'stoneware', 'test', ['coolQuartz', 'heatQuartz']],
    ['plate', 'stoneware', 'electric', ['open', 'coolQuartz']],
    ['bottle', 'stoneware', 'electric', ['heatQuartz', 'heatLow']],
  ];
  for (const [form, cid, kid, choices] of cases) {
    const clay = clayById(cid);
    const shape = shapeOf(PRESETS[form], clay.density);
    const kiln = kilnById(kid);
    const fixed = fastest();
    const r = plan(shape, clay, kiln, 1222, { limit: 0.01, hold: 10, choices, start: fixed });
    let best = Infinity;
    const [a, b] = choices;
    for (let i = 0; i < ladder(a).length; i++) {
      for (let j = 0; j < ladder(b).length; j++) {
        const p = { ...fixed, [a]: i, [b]: j };
        const bl = build(p, 1222, 10);
        const f = fire(shape, clay, kiln, bl.schedule, { openAt: bl.openAt });
        if (f.chance <= 0.01) best = Math.min(best, f.duration);
      }
    }
    assert.ok(Number.isFinite(best), `${form}/${cid}: some combination is safe`);
    assert.ok(r.safe, `${form}/${cid}`);
    assert.ok(r.firing.duration <= best * 1.03, `${form}/${cid}/${kid}: plan ${(r.firing.duration / 3600).toFixed(2)} h, best ${(best / 3600).toFixed(2)} h`);
  }
});

test('what potters know: bigger, thicker, siliceous and faster-cooling all crack more; flameware less', () => {
  const run = (piece, cid = 'stoneware', kid = 'electric') => fire(shapeOf(piece), clayById(cid), kilnById(kid), defaultSchedule(1222)).chance;
  const plate = PRESETS.plate;
  assert.ok(run({ ...plate, diameter: 0.4 }) > run(plate));
  const pot = PRESETS.casserole;
  assert.ok(run({ ...pot, wall: 0.016, base: 0.019 }) > run({ ...pot, wall: 0.008, base: 0.01 }));
  assert.ok(run(plate, 'silica-rich') > run(plate, 'stoneware'));
  assert.ok(run(plate, 'stoneware', 'test') > run(plate, 'stoneware', 'gas'));
  assert.ok(run(plate, 'flameware') < run(plate, 'stoneware'));
  // Opening the lid hot crashes silica-rich clay through cristobalite.
  const shape = shapeOf(plate);
  const hot = fire(shape, clayById('silica-rich'), kilnById('electric'), defaultSchedule(1222), { openAt: 250 });
  const cool = fire(shape, clayById('silica-rich'), kilnById('electric'), defaultSchedule(1222), { openAt: 60 });
  assert.ok(hot.chance > cool.chance);
  assert.equal(hot.worst.cause, 'cristobalite');
});

test('the worst moment is explained: where, when and why', () => {
  const f = fire(shapeOf(platter), clayById('stoneware'), kilnById('electric'), defaultSchedule(1222));
  assert.equal(f.worst.region, 'rim');
  assert.equal(f.worst.cause, 'quartz');
  assert.equal(f.worst.heating, false);
  assert.ok(f.worst.hottest - f.worst.coldest > 10);
});

test('pots are turned shapes: sensible stations, normals and outlines', () => {
  for (const form of Object.keys(PRESETS)) {
    const sh = shapeOf(PRESETS[form]);
    assert.ok(sh.stations.length >= 12 && sh.stations.length <= 60);
    for (const s of sh.stations) {
      assert.ok(s.r > 0 && s.h > 0 && s.ds > 0);
      assert.ok(Math.abs(Math.hypot(s.nr, s.nz) - 1) < 1e-6);
    }
    assert.equal(sh.stations.at(-1).region, 'rim');
    assert.ok(sh.stations.some((s) => s.shelf === 'contact'));
    const o = outline(sh);
    assert.ok(o.every((p) => Number.isFinite(p.r) && Number.isFinite(p.z) && p.r >= 0));
  }
  // A mug's clay volume is close to the hand calculation.
  const p = PRESETS.cylinder;
  const sh = shapeOf(p, 1000);
  const R = p.diameter / 2;
  const hand = Math.PI * (R - p.wall / 2) ** 2 * p.base + 2 * Math.PI * (R - p.wall / 2) * p.wall * (p.height - p.base);
  assert.ok(Math.abs(sh.mass / 1000 - hand) < 0.08 * hand);
});

test('controller text: merged where a climb continues at one rate', () => {
  const b = build(fastest(), 1222, 10);
  const c = compact(b.schedule);
  assert.equal(c.length, 2);
  assert.equal(c[0].rate, FULL);
  assert.match(scheduleText(c), /FULL\s+1122/);
  assert.ok(CHOICES.every((x) => ladder(x).length > 3));
});

test('setup files round-trip', () => {
  const s = defaultSetup('bowl');
  const back = parseSetup(toFile(s));
  assert.equal(back.piece.form, 'bowl');
  assert.ok(Math.abs(back.piece.diameter - s.piece.diameter) < 1e-9);
  assert.equal(back.clay.id, s.clay.id);
  assert.deepEqual(back.schedule, s.schedule);
});

test('hostile setup files are refused with plain messages that never repeat the input', () => {
  const good = JSON.parse(toFile(defaultSetup()));
  const bad = [
    ['not json <script>', /isn't valid JSON/],
    ['[1,2,3]', /isn't a Quartzline setup/],
    [JSON.stringify({ ...good, secret: 'hunter2' }), /doesn't know/],
    [JSON.stringify(good).replace('{', '{"__proto__":{"isAdmin":true},'), /doesn't know/],
    [JSON.stringify({ ...good, name: '<img src=x onerror=alert(1)>' }), /name uses letters/],
    [JSON.stringify({ ...good, clay: 'unobtainium' }), /clay should be one of/],
    [JSON.stringify({ ...good, piece: { ...good.piece, diameter: 1e9 } }), /diameter \(cm\) should be between/],
    [JSON.stringify({ ...good, piece: { ...good.piece, wall: 'thick' } }), /should be a number/],
    [JSON.stringify({ ...good, piece: { ...good.piece, form: 'teapot' } }), /form should be one of/],
    [JSON.stringify({ ...good, schedule: Array(13).fill({ rate: 100, target: 1222, hold: 0 }) }), /1 to 12 segments/],
    [JSON.stringify({ ...good, schedule: [{ rate: 100, target: 900, hold: 0 }] }), /climb to about 1222/],
    [JSON.stringify({ ...good, schedule: [{ rate: -5, target: 1222 }] }), /rate \(°C\/h\) should be between/],
    [JSON.stringify({ ...good, limit: 90 }), /risk limit/],
    [`{"x":"${'a'.repeat(MAX_FILE)}"}`, /too big/],
    ['{"piece": 1e999}', /doesn't know|needs a piece/],
  ];
  for (const [text, re] of bad) {
    assert.throws(() => parseSetup(text), (e) => e instanceof SetupError && re.test(e.message) && !/hunter2|<img|script|unobtainium|teapot/.test(e.message), text.slice(0, 60));
  }
  assert.equal(({}).isAdmin, undefined);
});

test('the largest piece in the slowest kiln still plans in bounded time', () => {
  const huge = { form: 'bottle', diameter: 0.6, height: 0.6, wall: 0.03, base: 0.04, foot: false };
  const clay = clayById('silica-rich');
  const t0 = Date.now();
  const r = plan(shapeOf(huge, clay.density), clay, kilnById('gas'), 1285, { limit: 0.001, hold: 600, maxEvaluations: 40 });
  assert.ok(r.evaluations <= 40);
  assert.ok(r.firing.duration < 96 * 3600 + 60);
  assert.ok(Date.now() - t0 < 120000);
});
