// The pot in 3D, inside a kiln: spun from its profile, cut away so you can see into the wall,
// and coloured cell by cell by temperature or stress.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heatColour, stressColour, reduced } from './ui.js';
import type { ShapeView } from './worker.js';

export type Mode = 'heat' | 'stress';

export interface FrameLike {
  temps: Float32Array | ArrayLike<number>;
  stress: Float32Array | ArrayLike<number>;
}

const SEGMENTS = 96;
const CUT = Math.PI * 0.42; // the slice taken out, so the wall's cross-section shows

export class PotScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
  readonly controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  private cellA = new Int32Array(0);
  private cellB = new Int32Array(0);
  private mix = new Float32Array(0);
  private shelf: THREE.Mesh;
  private glow: THREE.PointLight;
  private needs = true;
  private visible = true;
  spin = false;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.scene.background = new THREE.Color(0x15100d);
    this.scene.fog = new THREE.Fog(0x15100d, 2.2, 5);

    this.scene.add(new THREE.HemisphereLight(0xfff4e8, 0x3a2a20, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 2, 1.6);
    this.scene.add(key);
    this.glow = new THREE.PointLight(0xff7a2a, 0, 4, 1.5);
    this.glow.position.set(-0.6, 0.5, -0.4);
    this.scene.add(this.glow);

    // A kiln shelf on three posts, and the kiln's brick wall behind.
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xb9ab9c, roughness: 0.95 });
    this.shelf = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), shelfMat);
    this.shelf.position.y = -0.01;
    this.scene.add(this.shelf);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 2.4, 48, 1, true, Math.PI * 0.6, Math.PI * 0.8),
      new THREE.MeshStandardMaterial({ color: 0x5b4234, roughness: 1, side: THREE.BackSide }),
    );
    wall.position.y = 0.5;
    this.scene.add(wall);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('change', () => { this.needs = true; });

    new ResizeObserver(() => this.resize()).observe(host);
    new IntersectionObserver((e) => { this.visible = e[0]?.isIntersecting ?? true; }).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.visible) return;
      if (this.spin && !reduced()) {
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.6;
      } else {
        this.controls.autoRotate = false;
      }
      this.controls.update();
      if (this.needs || this.controls.autoRotate) {
        this.renderer.render(this.scene, this.camera);
        this.needs = false;
      }
    };
    loop();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.shape) this.frame(this.shape);
    this.needs = true;
  }

  private shape: ShapeView | null = null;

  // Builds the pot's surfaces from its stations. Each vertex remembers which one or two cells
  // (station × layer) colour it.
  setPot(shape: ShapeView, layers: number, cutaway = true): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const st = shape.stations;
    const n = st.length;
    const m = layers;
    const phi0 = cutaway ? CUT / 2 : 0;
    const span = cutaway ? Math.PI * 2 - CUT : Math.PI * 2;
    const pos: number[] = [];
    const ia: number[] = [];
    const ib: number[] = [];
    const w: number[] = [];
    const idx: number[] = [];
    // A point across the wall: f = 0 is the outside face, 1 the inside.
    const at = (i: number, f: number) => {
      const s = st[i];
      return [s.r + s.nr * s.h * (0.5 - f), s.z + s.nz * s.h * (0.5 - f)];
    };
    const cell = (i: number, j: number) => i * m + Math.min(m - 1, Math.max(0, j));
    const push = (r: number, z: number, phi: number, a: number, b: number, mix: number) => {
      pos.push(r * Math.cos(phi), z, r * Math.sin(phi));
      ia.push(a); ib.push(b); w.push(mix);
      return pos.length / 3 - 1;
    };
    // The outside and inside faces, swept round.
    for (const face of [0, 1]) {
      const j = face === 0 ? 0 : m - 1;
      const f = face;
      const rows: { r: number; z: number; c: number }[] = [];
      const first = at(0, f);
      rows.push({ r: 0, z: first[1], c: cell(0, j) });
      for (let i = 0; i < n; i++) {
        const [r, z] = at(i, f);
        rows.push({ r, z, c: cell(i, j) });
      }
      const base = pos.length / 3;
      for (const row of rows) {
        for (let k = 0; k <= SEGMENTS; k++) push(row.r, row.z, phi0 + (span * k) / SEGMENTS, row.c, row.c, 1);
      }
      for (let a = 0; a < rows.length - 1; a++) {
        for (let k = 0; k < SEGMENTS; k++) {
          const p = base + a * (SEGMENTS + 1) + k;
          const q = p + SEGMENTS + 1;
          idx.push(p, q, p + 1, p + 1, q, q + 1);
        }
      }
    }
    // The rim's top edge, joining the two faces.
    {
      const base = pos.length / 3;
      const [ro, zo] = at(n - 1, 0);
      const [ri, zi] = at(n - 1, 1);
      for (let k = 0; k <= SEGMENTS; k++) {
        const phi = phi0 + (span * k) / SEGMENTS;
        push(ro, zo, phi, cell(n - 1, 0), cell(n - 1, 0), 1);
        push(ri, zi, phi, cell(n - 1, m - 1), cell(n - 1, m - 1), 1);
      }
      for (let k = 0; k < SEGMENTS; k++) {
        const p = base + 2 * k;
        idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
      }
    }
    // The cut faces: the whole cross-section of the wall, layer by layer.
    if (cutaway) {
      for (const phi of [phi0, phi0 + span]) {
        const base = pos.length / 3;
        for (let i = 0; i < n; i++) {
          for (let q = 0; q <= m; q++) {
            const [r, z] = at(i, q / m);
            // A boundary between layers takes the average of the two cells either side.
            const a = cell(i, q - 1), b = cell(i, q);
            push(r, z, phi, q === 0 ? b : a, q === m ? a : b, 0.5);
          }
        }
        for (let i = 0; i < n - 1; i++) {
          for (let q = 0; q < m; q++) {
            const p = base + i * (m + 1) + q;
            const s = p + m + 1;
            idx.push(p, s, p + 1, p + 1, s, s + 1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.cellA = Int32Array.from(ia);
    this.cellB = Int32Array.from(ib);
    this.mix = Float32Array.from(w);
    this.mesh = new THREE.Mesh(g, this.material);
    this.scene.add(this.mesh);
    this.frame(shape);
  }

  // Points the camera at the pot from a little above, near enough to fill the view.
  private frame(shape: ShapeView): void {
    this.shape = shape;
    let R = 0, H = 0;
    for (const s of shape.stations) { R = Math.max(R, s.r + s.h); H = Math.max(H, s.z + s.h); }
    const size = Math.max(R * 2, H);
    this.shelf.scale.set(Math.max(R * 2.6, 0.2), 1, Math.max(R * 2.6, 0.2));
    this.controls.target.set(0, H * 0.42, 0);
    // Narrow views (phones) need the camera further back to fit a wide pot.
    const d = (size * 1.75 + 0.05) * Math.max(1, (1.4 / this.camera.aspect) ** 0.85);
    this.camera.position.set(d * 0.62, H * 0.42 + d * 0.5, d * 0.78);
    this.camera.near = d / 50;
    this.camera.far = d * 10;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = d * 0.45;
    this.controls.maxDistance = d * 2.2;
    this.scene.fog = new THREE.Fog(0x15100d, d * 1.6, d * 4);
    this.controls.update();
    this.needs = true;
  }

  // Colours the pot for one moment of the firing.
  show(f: FrameLike, mode: Mode, strength: number, air: number): void {
    if (!this.mesh) return;
    const col = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    const src = mode === 'heat' ? f.temps : f.stress;
    for (let v = 0; v < this.mix.length; v++) {
      const x = src[this.cellA[v]] * this.mix[v] + src[this.cellB[v]] * (1 - this.mix[v]);
      const c = mode === 'heat' ? heatColour(x) : stressColour(x / strength);
      // three.js expects linear colour; the scales are written in sRGB.
      arr[3 * v] = c[0] ** 2.2;
      arr[3 * v + 1] = c[1] ** 2.2;
      arr[3 * v + 2] = c[2] ** 2.2;
    }
    col.needsUpdate = true;
    // Hot ware glows: an orange light and a little self-light above ~550 °C.
    const hot = Math.max(0, Math.min(1, (air - 550) / 600));
    this.glow.intensity = hot * 1.2;
    this.material.emissive.setRGB(0.16 * hot, 0.05 * hot, 0.01 * hot);
    (this.scene.background as THREE.Color).setRGB(0.08 + 0.18 * hot, 0.06 + 0.05 * hot, 0.05);
    this.needs = true;
  }
}
