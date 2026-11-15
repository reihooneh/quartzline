# Security

Quartzline is a static website: HTML, CSS and JavaScript served by GitHub Pages. Everything runs in the visitor's browser. There's no server code, no accounts, no cookies, no analytics and no data storage. No software is perfectly secure, so this file sets out what an attacker could try and how the project defends against it.

## Threat model

| What someone could try | How Quartzline defends |
|---|---|
| **Inject script into the page** (XSS) through a setup file, a name or a URL | The pages are built with DOM calls (`textContent`, `createElement`) only: no `innerHTML` and no HTML from strings, and a test scans the built JavaScript to enforce it. A strict Content-Security-Policy (`default-src 'none'; script-src 'self'`) blocks inline script, inline handlers and code from any other site even if something slipped through. |
| **A hostile setup file**: odd fields, prototype pollution (`__proto__`), huge numbers, wrong types, markup in names | `parseSetup` reads at most 16 KB. It accepts only plain JSON objects with known fields, and refuses `__proto__`, `constructor` and `prototype` outright. It checks every number is finite and in range, and allows only a short list of plain characters in names. Error messages never repeat what was in the file. The same checks run again in the worker before anything is simulated. |
| **Denial of service**: a setup that makes the simulation or planner run for ever | Everything is bounded: pieces up to 60 cm, at most 60 rings, at most 12 schedule segments, firings capped at 96 hours, and the planner capped at 160 simulations and 12 seconds. The engine runs in a Web Worker, so the page stays responsive, and a new request cancels a running one by ending the worker. A test plans the largest piece in the slowest kiln. |
| **A malicious message to the worker** | The worker checks every message's shape and size before using it, and treats the setup inside as untrusted text. |
| **Path traversal** against the local preview server (`scripts/serve.mjs`) | It serves only files inside `site/` with a fixed list of content types, rejects any path that resolves outside, and a test tries `../`, encoded variants and `assets/../../`. GitHub Pages serves the real site. |
| **A compromised dependency** | The site loads nothing from other sites: three.js and the fonts are copied in at build time, from exact pinned versions with a lockfile. CI runs `npm audit`, rebuilds the site and requires it to match the committed copy byte for byte, so the deployed files are the reviewed ones. The only runtime library is three.js. |
| **Tracking or data leaks** | There are no third-party requests, no analytics and no cookies. `Referrer-Policy: no-referrer` is set. Setup files are read in the browser and never uploaded. |
| **CI abused to change the repository** | The workflow has read-only permissions by default; only the deploy job may write to Pages. |

## Known limits

- **A strict CSP, but enforced from a meta tag:** GitHub Pages can't set custom HTTP headers, so the policy comes from the page itself. That covers scripts, styles, fonts, images and connections, but not `frame-ancestors` (clickjacking). The site has no actions worth hijacking.
- **Not engineering certification:** Quartzline's numbers are estimates for comparing schedules. It is not safety-rated, and it can't know your kiln's wiring or ventilation.

## Reporting a problem

Please open an issue at https://github.com/reihooneh/quartzline/issues with steps to reproduce. For anything sensitive, use GitHub's private vulnerability reporting on the repository's Security tab. I'll aim to reply within a week.
