# How Quartzline works

## 1. Architecture

```
setup (JSON) ─parseSetup─▶ Setup {piece, clay, kiln, cone, schedule, openAt, limit}
                                 │
                       shapeOf(piece) ─▶ Shape: up to 60 stations (rings) along the profile
                                 │
            ┌────────────────────┴─────────────────────┐
            ▼                                          ▼
  fire(shape, clay, kiln, schedule)            plan(shape, clay, kiln, peak, limit)
   ├ Controller: kiln air, power and            ├ start with every choice at its fastest
   │ natural-cooling limits, lid                ├ while too risky: blame(worst) → one notch slower
   ├ shelf lag                                  ├ then: each choice one notch faster if still safe
   ├ heat: implicit across the wall,            └ every candidate is a full fire(...)
   │ then implicit along the pot
   └ StressModel.evaluate every 30 s ─▶ Weibull H(t), worst moment
                                 │
          Web Worker (worker.ts) ─▶ studio.ts / home.ts: pot3d.ts (three.js), chart.ts (SVG)
          main thread: wallpage.ts, method.ts (small runs of the same engine)
```

## 2. File tour

- **`src/engine/clay.ts`:**
  - the five clay bodies;
  - `strain(T)`, with logistic steps for quartz and cristobalite;
  - a 0.5 °C lookup table for the inner loops;
  - heat capacity.
- **`src/engine/piece.ts`:**
  - forms as dense polylines;
  - resampled into stations, each with a radius, height, thickness, outward normal, region name, shelf contact and how much of the kiln its inside face sees;
  - `outline` for drawing.
- **`src/engine/kiln.ts`:** kilns, cones, segments, and the `Controller`, which follows a schedule within the kiln's limits and opens the lid.
- **`src/engine/fire.ts`:**
  - the simulation: geometry, conductances, film coefficients (radiation plus convection);
  - the two implicit sweeps;
  - risk tracking, frames for drawing, and `describe` for the worst moment.
- **`src/engine/stress.ts`:**
  - `StressModel`: the free-plate stress across the wall plus the shell-reach stress along the pot;
  - Weibull H;
  - `crackChance`.
- **`src/engine/plan.ts`:** the eight choices, `build` (choices to segments), `blame`, `plan`, `compact` (for the controller).
- **`src/engine/setup.ts`:** the file format, its strict parser and limits.
- **`src/engine/wall.ts`:** a one-dimensional wall slice and `plateStress`, used for exact checks.
- **`src/web/`:**
  - `worker.ts` and `client.ts`: messaging and cancellation;
  - `pot3d.ts`: the lathe-swept, cut-away mesh with per-vertex colours;
  - `chart.ts`: the firing chart;
  - one script per page.
- **`scripts/`:** `build.mjs` (pages, CSP, vendoring), `serve.mjs` (path-checked preview), `shoot.mjs` (screenshots).
- **`tests/`:** `engine/*.test.mjs` (physics and planner) and `web/site.test.mjs` (Playwright).

## 3. Key concepts, simply

**One profile, spun round.** A thrown pot looks the same from every side, so the temperature only depends on where you are along the profile and how deep into the wall. That turns a 3D problem into a 2D one: up to 60 rings × 6 layers, instead of tens of thousands of 3D cells.

**Heat moves in two directions, solved in two steps.** Heat crosses a 7 mm wall in about a minute, but takes hours to travel along a 20 cm profile. An explicit method would need tiny time steps for the fast direction. Quartzline splits each 10-second step: first heat flows across the wall, then along it. Each half is *implicit*: it solves for the new temperatures, which takes one tridiagonal (Thomas algorithm) solve per ring or per layer. Implicit steps are stable at any size, and both halves conserve heat exactly. A test checks that heat in through the faces equals heat stored.

**Faces, shelf and lid.**
- Radiation dominates in a kiln. Its heat-transfer coefficient εσ(T_s² + T_e²)(T_s + T_e) grows with the cube of temperature.
- The inside face of a narrow bottle sees mostly its own walls, so its exchange is scaled by how much of the opening it can see.
- The base touches a shelf, a heavy slab that follows the kiln with a lag of about 25 minutes. That's why a plate's middle stays warm while the rim cools.
- With the lid open, the air drops quickly to room temperature, but the kiln's walls still radiate heat.

**Stress, two ways.** Clay wants to be bigger when hot.
1. *Across the wall.* A free plate can stretch and bend, so a temperature profile that's a straight line through the wall causes no stress at all. Quartzline fits a straight line to each ring's strain profile; whatever doesn't fit is stress: σ = E/(1−ν)·(fitted − actual).
2. *Along the pot.* Each ring is held at a size by its neighbours. For a flat disc, the exact hoop stress is E·(½·mean over the whole disc + ½·mean inside this radius − own strain). In a shell, a ring is only held by neighbours within about 2.4·√(R·h), where R is the ring's radius of curvature (its radius on a cylinder, infinite on a flat base). Quartzline weights each mean to that reach. A pair of rings uses the shorter of their two reaches, so a base is coupled as a whole but only to the wall near it.

**Quartz and cristobalite.** Free quartz grows about 0.33% as it passes 573 °C, and cristobalite about 1% around 226 °C. In a body, the glassy matrix takes up part of that, so about half of it reaches the pot. Passing through either unevenly gives a sudden mismatch: that is the dunt.

**From stress to a crack chance.** Ceramics fail at their worst flaw, and bigger pieces have more flaws. The Weibull model says a piece survives a moment with probability exp(−Σ (V/V₀)·(σ/σ₀)ᵐ), summed over every cell in tension. With m around 8 to 10, the chance is dominated by the few most-stressed cells. The firing's chance uses the worst moment.

**Planning by blame.**
- A schedule is eight choices: three heating ranges, four cooling ranges and the lid temperature, each with a ladder of settings.
- Starting from all-fastest, the planner finds the moment of greatest risk. It looks at the temperature range the *pot* was passing through (not the kiln air, because the pot lags behind), and makes the choice in charge of that range one notch more cautious.
- Once safe, it tries one notch faster on every choice, keeping any change that saves time and stays safe.
- Results are cached by plan, so nothing is simulated twice.

## 4. Trade-offs

- **2D axisymmetric, not 3D finite elements:** a full 3D thermoelastic model would be more general, but take minutes per firing. The planner needs dozens of firings in seconds. The approach is exact for discs and plates, which is where dunting is worst, and approximate for tall shapes. The method page says so.
- **Implicit and split, not explicit:** splitting introduces a small time-step error. A test bounds it: a 5× finer step changes the peak stress by under 2%. In return, steps are 10–30× longer than explicit stability would allow.
- **Greedy blame, not global search:** eight choices with about ten settings each is 10⁸ schedules, far too many to try. Blame-and-relax uses about 10–60 simulations, and the tests compare it with exhaustive search on pairs of choices.
- **Typical properties:** real clays vary a lot. The tool is built to compare schedules for a given piece, which is its real job. Calibrating to your own clay is the first item on the roadmap.
- **TypeScript, not WebAssembly:** after removing allocations from the inner loops (film coefficients are written to variables, strain is a lookup table), a firing takes 50–250 ms in JavaScript. That was fast enough, and kept one language end to end, from the engine to the tests.

## 5. Interview questions

**Q: Why does an implicit scheme let you take bigger time steps, and what does it cost?**
A: An explicit step computes new temperatures from old ones. If the step is longer than about the time heat takes to cross a cell (Δx²/2κ), errors grow and the solution blows up. An implicit step solves for the new temperatures using the new values on both sides, which damps every error, so it's stable at any step. The cost is a linear solve each step. Here the system is tridiagonal, so the Thomas algorithm solves it in O(n). The step is then limited only by accuracy, which a convergence test checks.

**Q: Why does a linear temperature profile through a wall cause no stress?**
A: A free plate can expand uniformly and also bend. A linear strain profile is exactly a uniform stretch plus a bend, so the plate takes that shape and nothing resists it. Only the non-linear part (in steady cooling, the parabola) is resisted, so stress = E/(1−ν) × (best-fit line − actual strain). For a parabola, that gives surface tension of (2/3)·Eα·ΔT/(1−ν), which a test checks.

**Q: Why use a Weibull model rather than "crack if stress exceeds strength"?**
A: Ceramics are brittle, and their strength is set by the largest flaw in the stressed region. That varies from piece to piece, and more stressed volume means a likelier large flaw. Weibull captures both: the probability depends on stress to a high power (m around 8 to 10), summed over volume. That's why a big platter cracks at stresses a mug survives. It also gives a probability you can set a limit on, rather than a yes/no on a single number.

**Q: How do you know the planner isn't just finding a local optimum?**
A: It might, so the tests check it. For pairs of choices on several pieces, they enumerate every combination (about 80 firings each), find the fastest that meets the limit, and require the planner's answer to be within 3% of it. They also check the planned schedule really meets the limit when re-simulated. The blame rule (judging by the pot's own temperature, not the air's) matters: the first version blamed the air's range and wasted dozens of simulations slowing the wrong segment, because the pot lags behind the kiln.

**Q: What stops a malicious setup file from freezing someone's browser?**
A: Several layers:
- the file is size-capped and strictly parsed, with every number range-checked;
- the geometry is capped at 60 rings;
- firings stop at 96 hours, and the planner at 160 simulations and 12 seconds;
- everything runs in a Web Worker, so the page stays responsive;
- a newer request ends the worker rather than queueing behind it.

A test plans the largest allowed piece in the slowest kiln and checks it stops on time.

## 6. Extension ideas

- **Calibrate from test tiles:** fire tiles of your clay at a few cooling rates, record which cracked, and fit the Weibull strength and cristobalite content by maximum likelihood. Every plan after that is for *your* clay.
- **A full kiln load:** several pieces and shelves exchanging radiation, elements on the walls, and the hottest and coldest spots. The planner would then plan for the most at-risk piece in the load.
- **Glaze fit:** add a thin glaze layer with its own expansion curve. The same free-plate maths predicts crazing (glaze in tension) and shivering (glaze in compression) as the piece cools.
