// A firing setup: the piece, the clay, the kiln, the cone, the schedule you use now and when you
// open the lid. Setups can be saved and loaded as small JSON files, so everything read from a file
// is checked strictly: only known fields, only finite numbers in range, and nothing echoed back.
import { CLAYS, clayById } from './clay.js';
import { CONES, FULL, KILNS, UNLOAD, coneById, defaultSchedule, kilnById } from './kiln.js';
import { FORMS, PIECE_LIMITS, PRESETS } from './piece.js';
export const MAX_FILE = 16 * 1024;
export const MAX_SEGMENTS = 12;
export class SetupError extends Error {
}
export function defaultSetup(form = 'plate') {
    const cone = coneById('6');
    return {
        name: 'My firing',
        piece: { ...PRESETS[form] },
        clay: clayById('stoneware'),
        kiln: kilnById('electric'),
        cone,
        schedule: defaultSchedule(cone.peak),
        openAt: UNLOAD,
        limit: 0.01,
    };
}
// The file form uses the units potters measure in: cm for size, mm for thickness, % for risk.
export function toFile(s) {
    return JSON.stringify({
        name: s.name,
        piece: {
            form: s.piece.form,
            diameter: round(s.piece.diameter * 100, 1),
            height: round(s.piece.height * 100, 1),
            wall: round(s.piece.wall * 1000, 1),
            base: round(s.piece.base * 1000, 1),
            foot: s.piece.foot,
        },
        clay: s.clay.id,
        kiln: s.kiln.id,
        cone: s.cone.id,
        schedule: s.schedule.map((g) => ({ rate: g.rate >= FULL ? 'full' : g.rate, target: g.target, hold: g.hold })),
        openAt: s.openAt,
        limit: round(s.limit * 100, 2),
    }, null, 2) + '\n';
}
function round(x, d) {
    const f = 10 ** d;
    return Math.round(x * f) / f;
}
function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function only(o, where, keys) {
    for (const k of Object.keys(o)) {
        if (!keys.includes(k))
            throw new SetupError(`${where} has a field Quartzline doesn't know.`);
    }
}
function num(v, what, lo, hi) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new SetupError(`${what} should be a number.`);
    if (v < lo || v > hi)
        throw new SetupError(`${what} should be between ${lo} and ${hi}.`);
    return v;
}
function pick(v, list, what) {
    const hit = typeof v === 'string' ? list.find((x) => x.id === v) : undefined;
    if (!hit)
        throw new SetupError(`${what} should be one of: ${list.map((x) => x.id).join(', ')}.`);
    return hit;
}
// Parses and checks a setup file's text.
export function parseSetup(text) {
    if (typeof text !== 'string')
        throw new SetupError("That file couldn't be read.");
    if (text.length > MAX_FILE)
        throw new SetupError('That file is too big to be a Quartzline setup (16 KB at most).');
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        throw new SetupError("That file isn't valid JSON.");
    }
    if (!isObj(raw))
        throw new SetupError("That file isn't a Quartzline setup.");
    if (/"__proto__"|"constructor"|"prototype"/.test(text))
        throw new SetupError('That file has a field Quartzline doesn\'t know.');
    only(raw, 'The setup', ['name', 'piece', 'clay', 'kiln', 'cone', 'schedule', 'openAt', 'limit']);
    const name = raw.name === undefined ? 'My firing' : raw.name;
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .,'()&-]{1,48}$/u.test(name)) {
        throw new SetupError('The name uses letters, numbers, spaces and simple punctuation (48 characters at most).');
    }
    const p = raw.piece;
    if (!isObj(p))
        throw new SetupError('The setup needs a piece.');
    only(p, 'The piece', ['form', 'diameter', 'height', 'wall', 'base', 'foot']);
    if (typeof p.form !== 'string' || !FORMS.includes(p.form))
        throw new SetupError(`The form should be one of: ${FORMS.join(', ')}.`);
    const L = PIECE_LIMITS;
    const piece = {
        form: p.form,
        diameter: num(p.diameter, 'The diameter (cm)', L.diameter[0] * 100, L.diameter[1] * 100) / 100,
        height: num(p.height, 'The height (cm)', L.height[0] * 100, L.height[1] * 100) / 100,
        wall: num(p.wall, 'The wall (mm)', L.wall[0] * 1000, L.wall[1] * 1000) / 1000,
        base: num(p.base, 'The base (mm)', L.base[0] * 1000, L.base[1] * 1000) / 1000,
        foot: p.foot === undefined ? false : (() => {
            if (typeof p.foot !== 'boolean')
                throw new SetupError('foot should be true or false.');
            return p.foot;
        })(),
    };
    checkPiece(piece);
    const clay = pick(raw.clay, CLAYS, 'The clay');
    const kiln = pick(raw.kiln, KILNS, 'The kiln');
    const cone = pick(raw.cone, CONES, 'The cone');
    let schedule = defaultSchedule(cone.peak);
    if (raw.schedule !== undefined) {
        if (!Array.isArray(raw.schedule) || raw.schedule.length < 1 || raw.schedule.length > MAX_SEGMENTS) {
            throw new SetupError(`The schedule should be a list of 1 to ${MAX_SEGMENTS} segments.`);
        }
        schedule = raw.schedule.map((g, i) => {
            if (!isObj(g))
                throw new SetupError(`Segment ${i + 1} should have a rate, a target and a hold.`);
            only(g, `Segment ${i + 1}`, ['rate', 'target', 'hold']);
            const rate = g.rate === 'full' ? FULL : num(g.rate, `Segment ${i + 1}'s rate (°C/h)`, 10, 999);
            return {
                rate,
                target: num(g.target, `Segment ${i + 1}'s target (°C)`, 20, 1320),
                hold: g.hold === undefined ? 0 : num(g.hold, `Segment ${i + 1}'s hold (minutes)`, 0, 600),
            };
        });
        checkSchedule(schedule, cone);
    }
    const openAt = raw.openAt === undefined ? UNLOAD : num(raw.openAt, 'The lid-opening temperature (°C)', UNLOAD, 600);
    const limit = raw.limit === undefined ? 0.01 : num(raw.limit, 'The risk limit (%)', 0.1, 20) / 100;
    return { name, piece, clay, kiln, cone, schedule, openAt, limit };
}
export function checkPiece(p) {
    if (p.wall > p.diameter / 4 || p.base > p.height * 0.9 + 0.002 && p.form !== 'plate') {
        throw new SetupError('The walls are too thick for a piece that size.');
    }
    if (p.form === 'plate' && p.base > p.height)
        throw new SetupError('The base is thicker than the plate is tall.');
}
// A schedule must reach the cone's temperature (within 30 °C) and may then cool.
export function checkSchedule(schedule, cone) {
    const top = Math.max(...schedule.map((s) => s.target));
    if (Math.abs(top - cone.peak) > 30) {
        throw new SetupError(`The schedule should climb to about ${cone.peak} °C for ${cone.name.toLowerCase()}.`);
    }
}
