// Builds the site from its sources (run `tsc` first; `npm run build` does both):
//   src/pages/*.html + the shared layout   ->  site/*.html (strict CSP, no inline code)
//   build/engine/*.js, build/web/*.js       ->  site/assets/js/ (bare 'three' imports pointed at the self-hosted copy)
//   src/css/site.css, src/icon.svg          ->  site/assets/
//   three.js and the fonts                  ->  site/assets/vendor, site/assets/fonts
// CI rebuilds the site and checks the committed copy matches.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

function copy(from, to, transform) {
  mkdirSync(dirname(at(to)), { recursive: true });
  if (transform) writeFileSync(at(to), transform(readFileSync(at(from), 'utf8')));
  else copyFileSync(at(from), at(to));
}

rmSync(at('site/assets/js'), { recursive: true, force: true });

const vendor = [
  ['node_modules/three/build/three.module.js', 'site/assets/vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'site/assets/vendor/three.core.js'],
  ['node_modules/three/LICENSE', 'site/assets/vendor/three.LICENSE.txt'],
  ['node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2', 'site/assets/fonts/fraunces.woff2'],
  ['node_modules/@fontsource-variable/fraunces/LICENSE', 'site/assets/fonts/fraunces.LICENSE.txt'],
  ['node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'site/assets/fonts/instrument-sans.woff2'],
  ['node_modules/@fontsource-variable/instrument-sans/LICENSE', 'site/assets/fonts/instrument-sans.LICENSE.txt'],
  ['src/css/site.css', 'site/assets/css/site.css'],
  ['src/icon.svg', 'site/assets/icon.svg'],
];
for (const [from, to] of vendor) copy(from, to);
copy('node_modules/three/examples/jsm/controls/OrbitControls.js', 'site/assets/vendor/OrbitControls.js', (js) => js.replace(/from 'three';/g, "from './three.module.js';"));

for (const dir of ['engine', 'web']) {
  for (const f of readdirSync(at(`build/${dir}`)).filter((x) => x.endsWith('.js')).sort()) {
    copy(`build/${dir}/${f}`, `site/assets/js/${dir}/${f}`, (js) =>
      js.replace(/from 'three';/g, "from '../../vendor/three.module.js';")
        .replace(/from 'three\/addons\/controls\/OrbitControls\.js';/g, "from '../../vendor/OrbitControls.js';"));
  }
}

// ---------- Pages ----------
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const NAV = [
  ['index', 'index.html', 'Home'],
  ['studio', 'studio.html', 'Plan a firing'],
  ['wall', 'wall.html', 'Inside the wall'],
  ['method', 'method.html', 'How it works'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const built = [];
for (const file of readdirSync(at('src/pages')).filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(at(`src/pages/${file}`), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\n/);
  if (!m) throw new Error(`${file}: missing the JSON header comment`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const nav = NAV.map(([id, href, label]) => `<a href="${href}"${id === meta.nav ? ' aria-current="page"' : ''}>${label}</a>`).join('\n        ');
  const html = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="no-referrer">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="preload" href="assets/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="assets/css/site.css">
  <script type="module" src="assets/js/web/${meta.script}"></script>
</head>
<body class="page-${meta.nav}">
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <div class="top-inner">
      <a class="mark" href="index.html" aria-label="Quartzline home">
        <svg class="mark-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 6h14l-1 3c4 3 5 8 4 12-1 5-5 8-10 8s-9-3-10-8c-1-4 0-9 4-12z"/><path d="M5 19c4 1.5 8 1.5 11 0s7-1.5 11 0"/></svg>
        <span>Quartzline</span>
      </a>
      <nav class="nav" aria-label="Pages">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main">
${body.trimEnd()}
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <p>Quartzline is open source (MIT). It runs entirely in your browser: no sign-in, no tracking, and setups you load never leave your device. Its clay and kiln figures are typical values for comparing schedules, not measurements of your clay or your kiln: test a new schedule on pieces you can spare, and follow your kiln maker's safety instructions.</p>
      <p><a href="https://github.com/reihooneh/quartzline">Source code and tests on GitHub</a></p>
    </div>
  </footer>
</body>
</html>
`;
  writeFileSync(at(`site/${file}`), html);
  built.push(file);
}
console.log(`Built ${built.length} pages: ${built.join(', ')}.`);
