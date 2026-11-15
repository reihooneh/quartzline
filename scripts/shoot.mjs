// Takes the README's screenshots from the built site (run `npm run serve` first).
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const ready = () => page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });

await page.goto(base + 'index.html');
await ready();
await page.waitForFunction(() => /%/.test(document.getElementById('plan-chance').textContent), null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/home.png' });

await page.goto(base + 'studio.html');
await ready();
await page.click('#plan');
await page.waitForFunction(() => /^Compared/.test(document.getElementById('plan-status').textContent), null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('.results').scrollIntoView());
await page.waitForTimeout(800);
await page.locator('.verdict').screenshot({ path: 'docs/verdict.png' });
await page.locator('.viewer').screenshot({ path: 'docs/studio.png' });

await page.goto(base + 'wall.html');
await ready();
await page.locator('#slice').screenshot({ path: 'docs/wall.png' });
await browser.close();
