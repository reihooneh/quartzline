// The studio: describe a piece, a clay, a kiln and a schedule; watch the firing inside the
// piece; plan the fastest safe schedule.
import { CLAYS, KILNS, CONES, FORMS, PRESETS, FULL, UNLOAD, MAX_SEGMENTS, clayById, kilnById, coneById, defaultSchedule, parseSetup, toFile, SetupError, MAX_FILE, } from '../engine/index.js';
import { Engine, EngineError } from './client.js';
import { PotScene } from './pot3d.js';
import { firingChart } from './chart.js';
import { $, el, pressed, chance, hours, clock, degrees, mpa, css, heatColour, stressColour, reduced, download } from './ui.js';
const FORM_NAMES = { plate: 'Plate', bowl: 'Bowl', cylinder: 'Mug', bottle: 'Bottle', casserole: 'Casserole' };
const OPEN_CHOICES = [UNLOAD, 80, 100, 150, 200, 250, 300, 400];
const LIMITS = [0.005, 0.01, 0.02, 0.05];
const engine = new Engine();
const scene = new PotScene($('stage'));
const state = {
    form: 'plate',
    piece: { ...PRESETS.plate, diameter: 0.36, height: 0.04, wall: 0.008, base: 0.011 },
    clay: 'stoneware',
    kiln: 'electric',
    cone: '6',
    schedule: defaultSchedule(1222),
    openAt: UNLOAD,
    limit: 0.01,
    which: 'mine',
    mode: 'stress',
    res: null,
    frame: 0,
    playing: false,
    timer: 0,
    shapeKey: '',
};
// ---------- Controls ----------
for (const f of FORMS)
    $('form').append(el('button', { type: 'button', 'data-value': f, text: FORM_NAMES[f] }));
for (const c of CLAYS)
    $('clay').append(el('option', { value: c.id, text: c.name }));
for (const k of KILNS)
    $('kiln').append(el('option', { value: k.id, text: k.name }));
for (const c of CONES)
    $('cone').append(el('option', { value: c.id, text: `${c.name}, ${c.peak} °C` }));
for (const t of OPEN_CHOICES)
    $('open').append(el('option', { value: String(t), text: t === UNLOAD ? `${t} °C (when cool)` : `${t} °C` }));
for (const l of LIMITS)
    $('limit').append(el('option', { value: String(l), text: `${(l * 100).toFixed(1).replace('.0', '')}%` }));
const sliders = [['diameter', 100, 'cm'], ['height', 100, 'cm'], ['wall', 1000, 'mm'], ['base', 1000, 'mm']];
function showControls() {
    pressed($('form'), state.form);
    for (const [k, scale, unit] of sliders) {
        const input = $(k);
        input.value = String(Math.round(state.piece[k] * scale * 2) / 2);
        $(`${k}-out`).textContent = `${input.value} ${unit}`;
    }
    $('foot').checked = state.piece.foot;
    $('clay').value = state.clay;
    $('clay-about').textContent = clayById(state.clay)?.about ?? '';
    $('kiln').value = state.kiln;
    $('cone').value = state.cone;
    $('open').value = String(OPEN_CHOICES.includes(state.openAt) ? state.openAt : UNLOAD);
    $('limit').value = String(state.limit);
    segmentsTable();
}
function segmentsTable() {
    const rows = state.schedule.map((s, i) => {
        const input = (key, min, max, label) => {
            const value = key === 'rate' && s.rate >= FULL ? 999 : s[key];
            const inp = el('input', { type: 'number', inputmode: 'numeric', min, max, step: 1, value: Math.round(value), 'aria-label': `Segment ${i + 1} ${label}` });
            inp.addEventListener('change', () => {
                const v = Number(inp.value);
                if (!Number.isFinite(v))
                    return;
                const x = Math.min(max, Math.max(min, Math.round(v)));
                inp.value = String(x);
                state.schedule[i] = { ...state.schedule[i], [key]: key === 'rate' && x >= 999 ? FULL : x };
                changed();
            });
            return el('td', {}, inp);
        };
        const remove = el('button', { type: 'button', class: 'icon', 'aria-label': `Remove segment ${i + 1}`, text: '×', disabled: state.schedule.length <= 1 });
        remove.addEventListener('click', () => {
            state.schedule.splice(i, 1);
            segmentsTable();
            changed();
        });
        return el('tr', {}, input('rate', 10, 999, 'rate, °C per hour'), input('target', 20, 1320, 'target, °C'), input('hold', 0, 600, 'hold, minutes'), el('td', {}, remove));
    });
    $('segments').tBodies[0].replaceChildren(...rows);
    $('add-seg').disabled = state.schedule.length >= MAX_SEGMENTS;
}
$('form').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b)
        return;
    state.form = b.dataset.value;
    state.piece = { ...PRESETS[state.form] };
    showControls();
    changed();
});
for (const [k, scale, unit] of sliders) {
    $(k).addEventListener('input', () => {
        const v = Number($(k).value);
        state.piece[k] = v / scale;
        $(`${k}-out`).textContent = `${v} ${unit}`;
        changed();
    });
}
$('foot').addEventListener('change', () => { state.piece.foot = $('foot').checked; changed(); });
$('clay').addEventListener('change', () => { state.clay = $('clay').value; $('clay-about').textContent = clayById(state.clay)?.about ?? ''; changed(); });
$('kiln').addEventListener('change', () => { state.kiln = $('kiln').value; changed(); });
$('cone').addEventListener('change', () => {
    state.cone = $('cone').value;
    state.schedule = defaultSchedule(coneById(state.cone)?.peak ?? 1222);
    segmentsTable();
    changed();
});
$('open').addEventListener('change', () => { state.openAt = Number($('open').value); changed(); });
$('limit').addEventListener('change', () => { state.limit = Number($('limit').value); });
$('add-seg').addEventListener('click', () => {
    if (state.schedule.length >= MAX_SEGMENTS)
        return;
    const last = state.schedule[state.schedule.length - 1];
    state.schedule.push({ rate: 100, target: Math.max(20, (last?.target ?? 600) - 200), hold: 0 });
    segmentsTable();
    changed();
});
$('plan').addEventListener('click', () => run(true));
$('save').addEventListener('click', () => download('quartzline-setup.json', toFile(currentSetup()), 'application/json'));
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
    const input = $('file');
    const file = input.files?.[0];
    input.value = '';
    if (!file)
        return;
    try {
        if (file.size > MAX_FILE)
            throw new SetupError('That file is too big to be a Quartzline setup (16 KB at most).');
        apply(parseSetup(await file.text()));
        showControls();
        changed(0);
    }
    catch (err) {
        showError(err instanceof SetupError ? err.message : "That file couldn't be read.");
    }
});
function apply(s) {
    state.form = s.piece.form;
    state.piece = { ...s.piece };
    state.clay = s.clay.id;
    state.kiln = s.kiln.id;
    state.cone = s.cone.id;
    state.schedule = s.schedule.map((x) => ({ ...x }));
    state.openAt = OPEN_CHOICES.reduce((a, b) => (Math.abs(b - s.openAt) < Math.abs(a - s.openAt) ? b : a));
    state.limit = LIMITS.reduce((a, b) => (Math.abs(b - s.limit) < Math.abs(a - s.limit) ? b : a));
}
function currentSetup() {
    return {
        name: 'My firing',
        piece: { ...state.piece },
        clay: clayById(state.clay),
        kiln: kilnById(state.kiln),
        cone: coneById(state.cone),
        schedule: state.schedule.map((s) => ({ ...s })),
        openAt: state.openAt,
        limit: state.limit,
    };
}
function showError(msg) {
    const e = $('error');
    e.hidden = !msg;
    e.textContent = msg ?? '';
}
let debounce = 0;
function changed(delay = 300) {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => run(false), delay);
}
// ---------- Running ----------
async function run(plan) {
    showError(null);
    const planBtn = $('plan');
    if (plan) {
        planBtn.disabled = true;
        $('plan-status').textContent = 'Planning: trying schedules…';
    }
    else {
        $('headline').textContent = 'Working out the firing…';
    }
    try {
        const res = await engine.run(toFile(currentSetup()), plan, (n) => {
            $('plan-status').textContent = `Planning: ${n} ${n === 1 ? 'firing' : 'firings'} simulated so far…`;
        });
        state.res = res;
        if (!plan)
            state.which = 'mine';
        else
            state.which = res.planned ? 'plan' : 'mine';
        if (plan && res.planned) {
            $('plan-status').textContent = `Compared ${res.planned.evaluations} firings${res.planned.stopped ? ' (a slow piece to simulate: the search stopped at its time limit, so this is the best found)' : ''}.`;
        }
        else if (!plan) {
            $('plan-status').textContent = '';
        }
        render();
        document.body.dataset.ready = '1';
    }
    catch (err) {
        if (err instanceof EngineError && err.message === 'superseded')
            return;
        showError(err instanceof Error ? err.message : 'Something went wrong.');
        if (plan)
            $('plan-status').textContent = '';
    }
    finally {
        if (plan)
            planBtn.disabled = false;
    }
}
function firing() {
    const r = state.res;
    return state.which === 'plan' && r.planned ? r.planned.firing : r.mine;
}
function render() {
    const r = state.res;
    if (!r)
        return;
    const key = JSON.stringify(state.piece);
    if (key !== state.shapeKey) {
        scene.setPot(r.shape, r.layers);
        state.shapeKey = key;
    }
    verdict(r);
    planPanel(r);
    const plan = $('which').querySelector('[data-value="plan"]');
    plan.disabled = !r.planned;
    showFiring(true);
}
function verdict(r) {
    const mine = r.mine;
    const p = r.planned;
    const limit = state.limit;
    const tiles = [];
    const tile = (k, v, d, tone = '') => el('div', { class: `tile ${tone}` }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }), el('div', { class: 'd', text: d }));
    tiles.push(tile('Your schedule: chance of a crack', chance(mine.chance), mine.chance <= limit ? 'Within your limit' : 'Above your limit', mine.chance <= limit ? 'good' : 'bad'));
    tiles.push(tile('Your schedule: firing time', hours(mine.duration), 'Until the piece can be handled'));
    if (p) {
        const saved = mine.duration - p.firing.duration;
        tiles.push(tile("Quartzline's plan: chance of a crack", chance(p.firing.chance), p.safe ? 'Within your limit' : 'The safest it could find', p.safe ? 'good' : 'bad'));
        tiles.push(tile("Quartzline's plan: firing time", hours(p.firing.duration), saved >= 60 ? `${hours(saved)} quicker than yours` : saved <= -60 ? `${hours(-saved)} longer than yours` : 'About the same as yours'));
    }
    $('tiles').replaceChildren(...tiles);
    let line;
    if (!p) {
        line = mine.chance <= limit
            ? `Your schedule keeps the chance of a crack to ${chance(mine.chance)}. Plan a schedule to see if it can be faster.`
            : `Your schedule gives this piece a ${chance(mine.chance)} chance of cracking, mostly at the ${mine.worst.region}. Plan a schedule to fix it.`;
    }
    else if (!p.safe) {
        line = `Even the most cautious schedule leaves a ${chance(p.firing.chance)} chance: this piece, in this clay, is hard to fire whole.`;
    }
    else {
        const saved = mine.duration - p.firing.duration;
        line = `Quartzline's schedule keeps the chance to ${chance(p.firing.chance)}${saved >= 60 ? ` and is ${hours(saved)} quicker` : saved <= -60 ? `, taking ${hours(-saved)} longer to do it` : ''}.`;
    }
    $('headline').textContent = line;
}
function planPanel(r) {
    const p = r.planned;
    $('plan-panel').hidden = !p;
    if (!p)
        return;
    $('plan-summary').textContent = p.safe
        ? `The fastest schedule found that keeps the chance of a crack under ${chance(state.limit)}.`
        : `No schedule kept the chance under ${chance(state.limit)}; this is the safest found.`;
    $('plan-table').tBodies[0].replaceChildren(...p.schedule.map((s, i) => el('tr', {}, el('td', { text: String(i + 1) }), el('td', { text: s.rate < FULL ? `${Math.round(s.rate)} °C/h` : s.target < (p.schedule[i - 1]?.target ?? 20) ? 'As fast as it cools' : 'As fast as it can' }), el('td', { text: degrees(s.target) }), el('td', { text: s.hold ? `${Math.round(s.hold)} min` : '–' }))));
    $('plan-open').textContent = p.openAt <= UNLOAD
        ? 'Then switch off, and leave the lid shut until the kiln is cool.'
        : `Then switch off, and open the lid once the kiln has cooled to ${p.openAt} °C.`;
    $('plan-steps').replaceChildren(...(p.steps.length ? p.steps : ['Everything at full speed was already within the limit.']).map((s) => el('li', { text: s.replace(/^slower: /, 'Slowed down: ').replace(/^faster: /, 'Sped back up: ') })));
}
$('download').addEventListener('click', () => {
    const p = state.res?.planned;
    if (!p)
        return;
    const open = p.openAt <= UNLOAD ? 'Keep the lid shut until the kiln is cool.' : `Open the lid at ${p.openAt} °C.`;
    download('quartzline-schedule.txt', `Quartzline schedule\n\n${p.text}\n${open}\n`);
});
// ---------- The firing view ----------
let chartCursor = null;
function showFiring(rebuildChart) {
    const f = firing();
    pressed($('which'), state.which);
    pressed($('mode'), state.mode);
    const time = $('time');
    time.max = String(f.frames.length - 1);
    if (rebuildChart) {
        // Start at the riskiest moment: that's the one worth seeing.
        let k = 0;
        for (let i = 0; i < f.times.length; i++)
            if (Math.abs(f.times[i] - f.worst.time) < Math.abs(f.times[k] - f.worst.time))
                k = i;
        state.frame = k;
        const c = firingChart(f, state.which === 'plan' ? "The planned firing: kiln air, the piece's temperature range and the crack chance" : "Your firing: kiln air, the piece's temperature range and the crack chance");
        $('chart').replaceChildren(c.root);
        chartCursor = c.cursor;
        worstText(f);
    }
    legend();
    showFrame();
}
function showFrame() {
    const f = firing();
    const i = Math.min(state.frame, f.frames.length - 1);
    const strength = clayById(state.clay)?.strength ?? 24e6;
    scene.show(f.frames[i], state.mode, strength, f.air[i]);
    $('time').value = String(i);
    $('clock').textContent = clock(f.times[i]);
    chartCursor?.(f.times[i]);
    const fr = f.frames[i];
    let peak = 0;
    for (const s of fr.stress)
        peak = Math.max(peak, s);
    $('now').textContent = `${hours(f.times[i])} in: kiln ${degrees(f.air[i])}, piece ${degrees(f.coldest[i])} to ${degrees(f.hottest[i])}, largest pull ${mpa(peak)} (${Math.round((100 * peak) / strength)}% of the clay's strength).`;
}
function legend() {
    const strength = clayById(state.clay)?.strength ?? 24e6;
    const stops = state.mode === 'heat'
        ? [20, 300, 600, 900, 1200].map((t) => [css(heatColour(t)), degrees(t)])
        : [-0.5, 0, 0.5, 1].map((x) => [css(stressColour(x)), x < 0 ? 'Squeezed' : x === 0 ? 'No stress' : x === 1 ? `Breaking (${mpa(strength)})` : 'Pulled']);
    const bar = el('div', { class: 'legend-bar' });
    const colours = stops.map(([c]) => c);
    bar.dataset.colours = colours.join('|');
    // Inline styles are blocked by the CSP for attributes, so the gradient is set from script.
    bar.style.background = `linear-gradient(90deg, ${colours.join(', ')})`;
    const labels = el('div', { class: 'legend-labels' }, ...stops.map(([, l]) => el('span', { text: l })));
    $('legend').replaceChildren(bar, labels);
}
function worstText(f) {
    const w = f.worst;
    const where = `the ${w.region} (${w.face === 'middle' ? 'inside the wall' : `${w.face} face`})`;
    const why = w.cause === 'quartz'
        ? `The piece was passing through quartz's sudden change at 573 °C unevenly: part of it at ${degrees(w.coldest)} (the ${w.coldRegion}) while another part was still ${degrees(w.hottest)} (the ${w.hotRegion}).`
        : w.cause === 'cristobalite'
            ? `Cristobalite in the clay changes size suddenly around 226 °C, and the piece was going through it unevenly (${degrees(w.coldest)} to ${degrees(w.hottest)}).`
            : `The piece was ${Math.round(w.hottest - w.coldest)} °C hotter in one place (the ${w.hotRegion}) than another (the ${w.coldRegion}).`;
    const when = `${hours(w.time)} in, while the kiln was ${w.opened ? 'open and cooling' : w.heating ? 'heating' : 'cooling'} at ${degrees(w.air)}`;
    $('worst').textContent = `${when}, the largest pull was ${mpa(w.stress)} at ${where}. ${why} Over the whole firing that gives a ${chance(f.chance)} chance of a crack.`;
}
$('which').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.disabled)
        return;
    state.which = b.dataset.value;
    showFiring(true);
});
$('mode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b)
        return;
    state.mode = b.dataset.value;
    pressed($('mode'), state.mode);
    legend();
    showFrame();
});
$('time').addEventListener('input', () => {
    stop();
    state.frame = Number($('time').value);
    showFrame();
});
$('play').addEventListener('click', () => (state.playing ? stop() : play()));
function play() {
    const f = firing();
    if (reduced()) {
        state.frame = f.frames.length - 1;
        showFrame();
        return;
    }
    state.playing = true;
    $('play').textContent = 'Pause';
    if (state.frame >= f.frames.length - 1)
        state.frame = 0;
    let last = performance.now();
    const per = 16000 / f.frames.length; // the whole firing in about 16 seconds
    const tick = (now) => {
        if (!state.playing)
            return;
        if (now - last >= per) {
            state.frame = Math.min(state.frame + Math.max(1, Math.floor((now - last) / per)), f.frames.length - 1);
            last = now;
            showFrame();
        }
        if (state.frame >= f.frames.length - 1)
            stop();
        else
            requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
function stop() {
    state.playing = false;
    $('play').textContent = 'Play the firing';
}
showControls();
run(false);
