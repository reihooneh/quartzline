// Clay bodies: how they hold and conduct heat, how they grow and shrink with temperature
// (including the sudden jumps of quartz and cristobalite), how stiff and how strong they are.
// Free quartz grows by about 0.33 % (linear) as it passes 573 °C on heating and shrinks back on
// cooling; cristobalite changes by about 1 % around 220–270 °C. In a body the grains are held in
// a glassy matrix that takes up part of the change, so about half reaches the piece as a whole.
export const QUARTZ_T = 573;
export const QUARTZ_STEP = 0.0033;
export const QUARTZ_WIDTH = 3;
export const CRISTOBALITE_T = 226;
export const CRISTOBALITE_STEP = 0.010;
export const CRISTOBALITE_WIDTH = 6;
export const MATRIX_SHARE = 0.5;
export const REFERENCE_VOLUME = 1e-5; // m³, the 10 cm³ the strengths refer to
export const CLAYS = [
    {
        id: 'stoneware', name: 'Mid-fire stoneware', about: 'A typical cone 6 stoneware with some free quartz and a little cristobalite.',
        density: 2200, conductivity: 1.6, cp0: 760, cpSlope: 0.42, alpha: 5.8e-6, quartz: 0.18, cristobalite: 0.04,
        modulus: 45e9, poisson: 0.2, strength: 24e6, weibull: 8, emissivity: 0.9,
    },
    {
        id: 'porcelain', name: 'Porcelain', about: 'Dense and strong, but stiff: small temperature differences cause large stresses.',
        density: 2380, conductivity: 1.9, cp0: 750, cpSlope: 0.40, alpha: 4.6e-6, quartz: 0.14, cristobalite: 0.02,
        modulus: 65e9, poisson: 0.2, strength: 34e6, weibull: 10, emissivity: 0.88,
    },
    {
        id: 'earthenware', name: 'Red earthenware', about: 'Low-fired, porous and weaker, with plenty of free quartz.',
        density: 1850, conductivity: 0.9, cp0: 780, cpSlope: 0.40, alpha: 6.8e-6, quartz: 0.28, cristobalite: 0,
        modulus: 18e9, poisson: 0.18, strength: 11e6, weibull: 7, emissivity: 0.92,
    },
    {
        id: 'silica-rich', name: 'High-silica stoneware', about: 'Stoneware that has grown a lot of cristobalite: notorious for cracking on cooling.',
        density: 2200, conductivity: 1.6, cp0: 760, cpSlope: 0.42, alpha: 6.2e-6, quartz: 0.24, cristobalite: 0.10,
        modulus: 45e9, poisson: 0.2, strength: 24e6, weibull: 8, emissivity: 0.9,
    },
    {
        id: 'flameware', name: 'Flameware', about: 'A low-expansion body made for direct heat: little quartz, and soft enough to bend a little.',
        density: 1950, conductivity: 1.2, cp0: 780, cpSlope: 0.40, alpha: 2.8e-6, quartz: 0.05, cristobalite: 0,
        modulus: 14e9, poisson: 0.2, strength: 12e6, weibull: 6, emissivity: 0.9,
    },
];
export function clayById(id) {
    return CLAYS.find((c) => c.id === id);
}
function step(x) {
    return 1 / (1 + Math.exp(-x));
}
function rawStrain(c, t) {
    return (c.alpha * t +
        MATRIX_SHARE * (c.quartz * QUARTZ_STEP * step((t - QUARTZ_T) / QUARTZ_WIDTH) +
            c.cristobalite * CRISTOBALITE_STEP * step((t - CRISTOBALITE_T) / CRISTOBALITE_WIDTH)));
}
// Thermal strain relative to room temperature (20 °C).
export function strain(c, t) {
    return rawStrain(c, t) - rawStrain(c, 20);
}
// A fast version for the inner loops: a table from 0 to 1400 °C in 0.5 °C steps.
export class StrainTable {
    clay;
    values;
    constructor(clay) {
        this.clay = clay;
        this.values = new Float64Array(2801);
        for (let i = 0; i <= 2800; i++)
            this.values[i] = strain(clay, i * 0.5);
    }
    at(t) {
        const x = Math.min(2799.999, Math.max(0, t * 2));
        const i = Math.floor(x);
        const f = x - i;
        return this.values[i] * (1 - f) + this.values[i + 1] * f;
    }
}
export function heatCapacity(c, t) {
    return c.cp0 + c.cpSlope * Math.min(Math.max(t, 0), 1300);
}
