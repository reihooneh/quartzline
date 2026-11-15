// Small helpers shared by the pages: building DOM and SVG safely (never from HTML strings),
// formatting numbers, and colour scales.

type Attrs = Record<string, string | number | boolean | undefined> & { text?: string };
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
};

export function pressed(group: HTMLElement, value: string): void {
  for (const b of group.querySelectorAll<HTMLButtonElement>('button[data-value]')) {
    b.setAttribute('aria-pressed', String(b.dataset.value === value));
  }
}

export function chance(p: number): string {
  if (p < 0.0005) return 'under 0.1%';
  if (p < 0.01) return `${(p * 100).toFixed(1)}%`;
  if (p > 0.995) return 'over 99%';
  return `${Math.round(p * 100)}%`;
}

export function hours(s: number): string {
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}

export function clock(s: number): string {
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export const degrees = (t: number): string => `${Math.round(t)} °C`;
export const mpa = (p: number): string => `${(p / 1e6).toFixed(1)} MPa`;

export type RGB = [number, number, number];

function lerp(stops: [number, RGB][], x: number): RGB {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i];
    if (x <= b) {
      const [a, ca] = stops[i - 1];
      const f = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

// Temperature: cool clay grey-blue through warm clay to the colours of glowing ceramic.
const HEAT: [number, RGB][] = [
  [20, [0.42, 0.47, 0.55]],
  [200, [0.55, 0.5, 0.48]],
  [450, [0.62, 0.36, 0.25]],
  [650, [0.72, 0.18, 0.08]],
  [850, [0.93, 0.36, 0.06]],
  [1050, [1.0, 0.66, 0.2]],
  [1300, [1.0, 0.93, 0.7]],
];
export function heatColour(t: number): RGB {
  return lerp(HEAT, t);
}

// Stress, as a fraction of the clay's strength: squeezed (blue) through nothing (pale clay) to
// stretched (amber, then red as it nears the strength).
const STRESS: [number, RGB][] = [
  [-0.6, [0.17, 0.35, 0.55]],
  [-0.2, [0.55, 0.66, 0.76]],
  [0, [0.9, 0.86, 0.8]],
  [0.25, [0.97, 0.78, 0.36]],
  [0.5, [0.93, 0.47, 0.14]],
  [0.8, [0.74, 0.12, 0.08]],
  [1.0, [0.45, 0.02, 0.05]],
];
export function stressColour(f: number): RGB {
  return lerp(STRESS, f);
}

export function css([r, g, b]: RGB): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Saves text as a file the visitor downloads.
export function download(name: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
