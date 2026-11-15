// Browser tests for every page at phone, tablet and desktop widths: no errors, no sideways
// scrolling, no text on top of other text (HTML or SVG), and the main things work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';

const PAGES = ['index.html', 'studio.html', 'wall.html', 'method.html'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
let server, browser, base;

before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, size = SIZES[0]) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver Message|WebGL/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { page, context, errors };
}

// Every piece of visible text, HTML or SVG: no two different pieces overlap.
async function textOverlaps(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const elx = n.parentElement;
      if (elx.closest('.sr, [hidden], .skip, option, title, select')) continue;
      const det = elx.closest('details');
      if (det && !det.open && !elx.closest('summary')) continue;
      const cs = getComputedStyle(elx);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (elx instanceof SVGElement) {
        const r = elx.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.node === b.node) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) * 0.35) out.push(`"${a.text}" overlaps "${b.text}"`);
      }
    }
    return out;
  });
}

// Everything drawn in a chart stays inside the chart.
async function svgOutside(page) {
  return page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('svg.chart')) {
      const f = s.getBoundingClientRect();
      for (const t of s.querySelectorAll('text, line, rect, path')) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) out.push(t.textContent || t.tagName);
      }
    }
    return out;
  });
}

// Controls must not sit on top of each other.
async function boxOverlaps(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('main .button, main button, main input:not([type=file]), main select, main .stage, main table, main .seg, main .tile, main .chart-box, main .legend')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'));
    const out = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${els[i].id || els[i].className || els[i].tagName} overlaps ${els[j].id || els[j].className || els[j].tagName}`);
      }
    }
    return out;
  });
}

for (const path of PAGES) {
  for (const size of SIZES) {
    test(`${path} at ${size.name}: no errors, no sideways scroll, nothing overlapping`, async () => {
      const { page, context, errors } = await open(path, size);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(scroll <= 0, `page scrolls sideways by ${scroll}px`);
      assert.deepEqual(await textOverlaps(page), []);
      assert.deepEqual(await svgOutside(page), []);
      assert.deepEqual(await boxOverlaps(page), []);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}

test('home: both numbers come from the engine, and the plan is safer', async () => {
  const { page, context, errors } = await open('index.html');
  await page.waitForFunction(() => /%/.test(document.getElementById('plan-chance').textContent), null, { timeout: 120000 });
  const pct = async (id) => Number((await page.textContent(id)).replace(/[^\d.]/g, ''));
  assert.ok((await pct('#usual-chance')) > (await pct('#plan-chance')));
  assert.match(await page.textContent('#usual-detail'), /at the rim as it cools through quartz/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: check a schedule, plan a better one, look inside, download it', async () => {
  const { page, context, errors } = await open('studio.html');
  assert.match(await page.textContent('#headline'), /chance of cracking, mostly at the rim/);
  assert.equal(await page.locator('#tiles .tile').count(), 2);
  assert.match(await page.textContent('#worst'), /quartz's sudden change at 573 °C/);
  await page.click('#plan');
  await page.waitForFunction(() => /^Compared \d+ firings/.test(document.getElementById('plan-status').textContent), null, { timeout: 180000 });
  assert.equal(await page.locator('#tiles .tile').count(), 4);
  assert.match(await page.textContent('#headline'), /keeps the chance to/);
  assert.ok((await page.locator('#plan-table tbody tr').count()) >= 2);
  assert.equal(await page.getAttribute('#which button[data-value="plan"]', 'aria-pressed'), 'true');
  // Look at your own firing by temperature, at another moment.
  await page.click('#which button[data-value="mine"]');
  await page.click('#mode button[data-value="heat"]');
  assert.equal(await page.getAttribute('#mode button[data-value="heat"]', 'aria-pressed'), 'true');
  await page.$eval('#time', (el) => { el.value = '30'; el.dispatchEvent(new Event('input')); });
  assert.match(await page.textContent('#clock'), /^2:30$/);
  assert.match(await page.textContent('#now'), /^2 h 30 min in: kiln \d+ °C/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  assert.match(readFileSync(await dl.path(), 'utf8'), /Seg\s+Rate \(°C\/h\)/);
  const [save] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  assert.equal(JSON.parse(readFileSync(await save.path(), 'utf8')).piece.diameter, 36);
  // A different clay changes the answer.
  const before = await page.textContent('#headline');
  await page.selectOption('#clay', 'flameware');
  await page.waitForFunction((t) => document.getElementById('headline').textContent !== t && !/Working/.test(document.getElementById('headline').textContent), before, { timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.deepEqual(await textOverlaps(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: the schedule editor adds and removes segments, and catches a schedule that never reaches the cone', async () => {
  const { page, context, errors } = await open('studio.html');
  await page.click('#add-seg');
  assert.equal(await page.locator('#segments tbody tr').count(), 4);
  await page.click('#segments tbody tr:last-child button');
  assert.equal(await page.locator('#segments tbody tr').count(), 3);
  await page.fill('#segments tbody tr:nth-child(3) input >> nth=1', '900');
  await page.press('#segments tbody tr:nth-child(3) input >> nth=1', 'Tab');
  await page.fill('#segments tbody tr:nth-child(2) input >> nth=1', '800');
  await page.press('#segments tbody tr:nth-child(2) input >> nth=1', 'Tab');
  await page.waitForFunction(() => /climb to about 1222/.test(document.getElementById('error').textContent), null, { timeout: 30000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('studio: hostile setup files are refused and nothing from them reaches the page', async () => {
  const { page, context, errors } = await open('studio.html');
  const dir = mkdtempSync(join(tmpdir(), 'quartzline-'));
  try {
    const put = (name, text) => {
      const p = join(dir, name);
      writeFileSync(p, text);
      return p;
    };
    const good = { name: 'Mine', piece: { form: 'bowl', diameter: 20, height: 9, wall: 6, base: 8, foot: true }, clay: 'porcelain', kiln: 'test', cone: '10' };
    const refused = async (file, re) => {
      await page.setInputFiles('#file', file);
      await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('error').textContent), re.source, { timeout: 30000 });
      assert.doesNotMatch(await page.textContent('#error'), /hunter2|<img|script/);
    };
    await refused(put('junk.json', 'not json <script>alert(1)</script>'), /isn't valid JSON/);
    await refused(put('html.json', JSON.stringify({ ...good, name: '<img src=x onerror=alert(1)>' })), /name uses letters/);
    await refused(put('proto.json', JSON.stringify(good).replace('{', '{"__proto__":{"isAdmin":true},')), /doesn't know/);
    await refused(put('extra.json', JSON.stringify({ ...good, secret: 'hunter2' })), /doesn't know/);
    await refused(put('big.json', `{"x":"${'a'.repeat(20000)}"}`), /too big/);
    await page.setInputFiles('#file', put('mine.json', JSON.stringify(good)));
    await page.waitForFunction(() => document.getElementById('clay').value === 'porcelain' && document.getElementById('error').hidden, null, { timeout: 30000 });
    assert.equal(await page.getAttribute('#form button[data-value="bowl"]', 'aria-pressed'), 'true');
    assert.equal(await page.inputValue('#cone'), '10');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(await page.$('img[src="x"]'), null);
  assert.equal(await page.evaluate(() => ({}).isAdmin), undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test('inside the wall: slower cooling and a smaller plate pull less', async () => {
  const { page, context, errors } = await open('wall.html');
  const pull = async () => Number((await page.textContent('#w-tiles .tile:first-child .v')).replace(/[^\d.]/g, ''));
  const set = async (id, v) => {
    const before = await page.textContent('#w-tiles');
    await page.$eval(id, (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, v);
    await page.waitForFunction((t) => document.getElementById('w-tiles').textContent !== t, before, { timeout: 30000 });
  };
  const fast = await pull();
  await set('#w-rate', 50);
  const slow = await pull();
  assert.ok(slow < fast * 0.8, `${slow} vs ${fast}`);
  await set('#w-diam', 18);
  assert.ok((await pull()) < slow);
  assert.deepEqual(await svgOutside(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('how it works: the live checks agree with the exact answers', async () => {
  const { page, context, errors } = await open('method.html');
  const rows = await page.$$eval('#checks tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => parseFloat(td.textContent))));
  assert.equal(rows.length, 4);
  for (const [got, want] of rows) assert.ok(Math.abs(got - want) <= 0.03 * Math.abs(want) + 0.5, `${got} vs ${want}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the static server refuses paths outside the site', async () => {
  for (const p of ['../package.json', '..%2fpackage.json', '%2e%2e/%2e%2e/etc/passwd', 'assets/../../tsconfig.json']) {
    const res = await fetch(base + p);
    assert.notEqual(res.status, 200, p);
  }
});

test('built pages: strict CSP, no inline code, nothing from other sites, no HTML from strings', () => {
  const dir = new URL('../../site/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(new URL(f, dir), 'utf8');
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self';/, f);
    assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'/, f);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${f} has an inline script`);
    assert.doesNotMatch(html, /\sstyle=|<style|\son[a-z]+=/i, `${f} has inline styles or handlers`);
    const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
    for (const url of external) assert.ok(/^https:\/\/github\.com\/reihooneh\//.test(url), `${f} links ${url}`);
  }
  for (const sub of ['engine', 'web']) {
    for (const f of readdirSync(new URL(`assets/js/${sub}/`, dir))) {
      const js = readFileSync(new URL(`assets/js/${sub}/${f}`, dir), 'utf8');
      assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, `${f} builds HTML or code from strings`);
      assert.doesNotMatch(js, /from 'three/, `${f} still has a bare import`);
    }
  }
});
