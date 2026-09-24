import { MASK } from '../world/gen/generateWorld';
import { BIOME_COUNT, BIOMES, WORLD_HALF, WORLD_SIZE } from '../world/WorldConfig';
import type { WorldData } from '../world/WorldData';
import { LANDMARKS, TRAILS } from '../world/WorldLayout';
import { icon } from './icons';

// A cartographer's map painted from the real world data: parchment,
// hillshade, 20 m contours, biome inks, water, trails. Fog of war lifts where
// you have walked; landmarks appear once seen (as a question) and are named
// once discovered. Scroll to zoom, drag to pan, right-click to drop a pin.

const MAP_RES = 1024;
const FOG_RES = 128;
const FOG_CELL = WORLD_SIZE / FOG_RES;

const INK: [number, number, number][] = [
  [118, 132, 84], // Greensward
  [74, 98, 72], // Hollowpine
  [96, 140, 138], // Glasswood
  [196, 178, 130], // Coast
  [150, 92, 70], // Cinderreach
  [210, 212, 214], // Frostveil
  [104, 110, 78], // Drownfen
  [176, 150, 102], // Rim
];

export interface MapPin {
  x: number;
  z: number;
  label: string;
}

export class MapScreen {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  readonly fog = new Uint8Array(FOG_RES * FOG_RES);
  readonly pins: MapPin[] = [];
  private open = false;
  private zoom = 1.6;
  private centerX = 0;
  private centerZ = 0;
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private player = { x: 0, z: 0, yaw: 0 };
  private discovered = new Set<string>();
  private seen = new Set<string>();
  /** Places spotted through the spyglass: named before they are reached. */
  private named = new Set<string>();
  private readonly legend: HTMLElement;

  constructor(parent: HTMLElement, private readonly world: WorldData, private readonly onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'map';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Map');
    parent.appendChild(this.root);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const head = document.createElement('div');
    head.className = 'map-head';
    head.innerHTML = `<span class="map-title">The Island of Stillwild</span><span class="map-help">Scroll to zoom · drag to pan · right-click to pin · <kbd>M</kbd> close</span>`;
    const close = document.createElement('button');
    close.className = 'inv-close';
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', 'Close map');
    close.addEventListener('click', () => this.onClose());
    head.appendChild(close);
    this.root.appendChild(head);
    this.legend = document.createElement('div');
    this.legend.className = 'map-legend';
    this.root.appendChild(this.legend);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.screenToWorld(e.offsetX, e.offsetY);
      this.zoom = Math.min(8, Math.max(0.8, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const after = this.screenToWorld(e.offsetX, e.offsetY);
      this.centerX += before.x - after.x;
      this.centerZ += before.z - after.z;
      this.draw();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, cx: this.centerX, cz: this.centerZ };
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const scale = this.pixelsPerMeter();
      this.centerX = this.drag.cx - (e.clientX - this.drag.x) / scale;
      this.centerZ = this.drag.cz - (e.clientY - this.drag.y) / scale;
      this.draw();
    });
    window.addEventListener('mouseup', () => {
      this.drag = null;
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const w = this.screenToWorld(e.offsetX, e.offsetY);
      const near = this.pins.findIndex((p) => Math.hypot(p.x - w.x, p.z - w.z) < 30 / this.zoom);
      if (near >= 0) this.pins.splice(near, 1);
      else this.pins.push({ x: w.x, z: w.z, label: `Pin ${this.pins.length + 1}` });
      this.draw();
    });
    window.addEventListener('resize', () => {
      if (this.open) this.draw();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Reveal the fog of war around a point. */
  reveal(x: number, z: number, radius = 110): void {
    const ci = Math.floor((x + WORLD_HALF) / FOG_CELL);
    const cj = Math.floor((z + WORLD_HALF) / FOG_CELL);
    const r = Math.ceil(radius / FOG_CELL);
    for (let j = cj - r; j <= cj + r; j += 1) {
      for (let i = ci - r; i <= ci + r; i += 1) {
        if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) continue;
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d > 1) continue;
        const v = Math.round(255 * Math.min(1, (1 - d) * 2.5));
        const k = j * FOG_RES + i;
        if (v > this.fog[k]) this.fog[k] = v;
      }
    }
  }

  show(player: { x: number; z: number; yaw: number }, discovered: Set<string>, seen: Set<string>, named: Set<string> = new Set()): void {
    this.open = true;
    this.player = player;
    this.discovered = discovered;
    this.seen = seen;
    this.named = named;
    this.centerX = player.x;
    this.centerZ = player.z;
    if (!this.base) this.base = this.paintBase();
    this.root.classList.add('open');
    this.draw();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  private pixelsPerMeter(): number {
    const size = Math.min(this.canvas.width, this.canvas.height);
    return (size / WORLD_SIZE) * this.zoom;
  }

  private screenToWorld(sx: number, sy: number): { x: number; z: number } {
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const s = this.pixelsPerMeter();
    return { x: this.centerX + (sx * dpr - this.canvas.width / 2) / s, z: this.centerZ + (sy * dpr - this.canvas.height / 2) / s };
  }

  /** Paint the full-island base map once (parchment, relief, inks, water). */
  private paintBase(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = MAP_RES;
    c.height = MAP_RES;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(MAP_RES, MAP_RES);
    const world = this.world;
    const weights = new Float32Array(BIOME_COUNT);
    const step = WORLD_SIZE / MAP_RES;
    const hash = (x: number, y: number) => {
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return h - Math.floor(h);
    };
    for (let j = 0; j < MAP_RES; j += 1) {
      const z = -WORLD_HALF + (j + 0.5) * step;
      for (let i = 0; i < MAP_RES; i += 1) {
        const x = -WORLD_HALF + (i + 0.5) * step;
        const h = world.heightAt(x, z);
        const level = world.waterLevelAt(x, z);
        // Parchment.
        const grain = hash(i, j) * 0.06 + hash(i >> 3, j >> 3) * 0.05;
        let r = 222 - grain * 120;
        let gg = 206 - grain * 120;
        let b = 170 - grain * 110;
        if (h < level) {
          // Water: blue-grey wash, deeper = darker, hatched near shores.
          const depth = Math.min(1, (level - h) / 25);
          const shore = level - h < 2.5 && (i + j) % 6 < 2 ? 0.1 : 0;
          r = r * (0.62 - depth * 0.15) - shore * 60;
          gg = gg * (0.72 - depth * 0.12) - shore * 40;
          b = b * (0.85 - depth * 0.05) + 10;
        } else {
          world.biomeWeights(x, z, weights);
          let ir = 0;
          let ig = 0;
          let ib = 0;
          let wsum = 0;
          for (let k = 0; k < BIOME_COUNT; k += 1) {
            ir += INK[k][0] * weights[k];
            ig += INK[k][1] * weights[k];
            ib += INK[k][2] * weights[k];
            wsum += weights[k];
          }
          ir /= wsum;
          ig /= wsum;
          ib /= wsum;
          const mix = 0.42;
          r = r * (1 - mix) + ir * mix;
          gg = gg * (1 - mix) + ig * mix;
          b = b * (1 - mix) + ib * mix;
          // Hillshade from the NW.
          const hx = world.heightAt(x + step, z) - world.heightAt(x - step, z);
          const hz = world.heightAt(x, z + step) - world.heightAt(x, z - step);
          const shade = Math.max(-0.5, Math.min(0.5, (-hx - hz) * 0.12));
          r *= 1 + shade;
          gg *= 1 + shade;
          b *= 1 + shade;
          // Contours every 20 m (index every 100 m).
          const band = Math.floor(h / 20);
          if (Math.floor(world.heightAt(x + step, z) / 20) !== band || Math.floor(world.heightAt(x, z + step) / 20) !== band) {
            const major = band % 5 === 0;
            r *= major ? 0.62 : 0.8;
            gg *= major ? 0.58 : 0.78;
            b *= major ? 0.52 : 0.74;
          }
          if (world.maskAt(x, z, MASK.snow) > 0.5) {
            r = r * 0.6 + 235 * 0.4;
            gg = gg * 0.6 + 238 * 0.4;
            b = b * 0.6 + 240 * 0.4;
          }
        }
        const o = (j * MAP_RES + i) * 4;
        img.data[o] = Math.max(0, Math.min(255, r));
        img.data[o + 1] = Math.max(0, Math.min(255, gg));
        img.data[o + 2] = Math.max(0, Math.min(255, b));
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Trails as dashed ink.
    g.save();
    g.strokeStyle = 'rgba(96, 62, 34, 0.75)';
    g.lineWidth = 1.4;
    g.setLineDash([5, 4]);
    const toPx = (v: number) => ((v + WORLD_HALF) / WORLD_SIZE) * MAP_RES;
    for (const [a, b] of TRAILS) {
      const la = LANDMARKS.find((l) => l.id === a);
      const lb = LANDMARKS.find((l) => l.id === b);
      if (!la || !lb) continue;
      g.beginPath();
      g.moveTo(toPx(la.x), toPx(la.z));
      g.lineTo(toPx(lb.x), toPx(lb.z));
      g.stroke();
    }
    g.restore();
    // Rivers.
    g.strokeStyle = 'rgba(70, 104, 128, 0.85)';
    g.setLineDash([]);
    for (const river of this.world.rivers) {
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k < river.count; k += 1) {
        const px = toPx(river.points[k * 6]);
        const pz = toPx(river.points[k * 6 + 1]);
        if (k === 0) g.moveTo(px, pz);
        else g.lineTo(px, pz);
      }
      g.stroke();
    }
    return c;
  }

  private draw(): void {
    if (!this.base) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1c1812';
    g.fillRect(0, 0, w, h);
    const s = this.pixelsPerMeter();
    const ox = w / 2 - (this.centerX + WORLD_HALF) * s;
    const oy = h / 2 - (this.centerZ + WORLD_HALF) * s;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, ox, oy, WORLD_SIZE * s, WORLD_SIZE * s);
    // Fog of war.
    const cell = FOG_CELL * s;
    g.fillStyle = 'rgb(214, 198, 160)';
    for (let j = 0; j < FOG_RES; j += 1) {
      for (let i = 0; i < FOG_RES; i += 1) {
        const f = this.fog[j * FOG_RES + i];
        if (f >= 250) continue;
        const px = ox + i * cell;
        const py = oy + j * cell;
        if (px > w || py > h || px + cell < 0 || py + cell < 0) continue;
        g.globalAlpha = 1 - f / 255;
        g.fillRect(px - 0.5, py - 0.5, cell + 1, cell + 1);
      }
    }
    g.globalAlpha = 1;
    const toScreen = (x: number, z: number) => [ox + (x + WORLD_HALF) * s, oy + (z + WORLD_HALF) * s] as const;
    // Biome names where revealed.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const centers = this.biomeCenters();
    for (let b = 0; b < BIOME_COUNT; b += 1) {
      const c = centers[b];
      if (!c || !this.revealedAt(c.x, c.z)) continue;
      const [sx, sy] = toScreen(c.x, c.z);
      g.font = `italic 600 ${Math.round(16 * dpr * Math.min(1.6, 0.7 + this.zoom * 0.25))}px 'Cormorant Garamond', Georgia, serif`;
      g.fillStyle = 'rgba(60, 40, 20, 0.7)';
      g.fillText(BIOMES[b].name, sx, sy);
    }
    // Landmarks.
    for (const lm of LANDMARKS) {
      const known = this.discovered.has(lm.id);
      const spotted = this.seen.has(lm.id) || this.named.has(lm.id);
      if (!known && !spotted) continue;
      const [sx, sy] = toScreen(lm.x, lm.z);
      g.fillStyle = known ? 'rgba(90, 40, 24, 0.95)' : 'rgba(90, 60, 40, 0.6)';
      g.beginPath();
      g.arc(sx, sy, (known ? 4 : 3) * dpr, 0, Math.PI * 2);
      g.fill();
      g.font = `${known ? 600 : 400} ${Math.round(12 * dpr)}px 'Cormorant Garamond', Georgia, serif`;
      g.fillStyle = 'rgba(50, 30, 16, 0.9)';
      g.fillText(known || this.named.has(lm.id) ? lm.name : '?', sx, sy - 11 * dpr);
    }
    // Pins.
    for (const p of this.pins) {
      const [sx, sy] = toScreen(p.x, p.z);
      g.fillStyle = '#b8453b';
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx - 5 * dpr, sy - 12 * dpr);
      g.lineTo(sx + 5 * dpr, sy - 12 * dpr);
      g.closePath();
      g.fill();
    }
    // Player arrow.
    const [px, py] = toScreen(this.player.x, this.player.z);
    g.save();
    g.translate(px, py);
    g.rotate(-this.player.yaw);
    g.fillStyle = '#0f6f64';
    g.strokeStyle = '#f3ead6';
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.moveTo(0, -11 * dpr);
    g.lineTo(7 * dpr, 8 * dpr);
    g.lineTo(0, 4 * dpr);
    g.lineTo(-7 * dpr, 8 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // Compass rose.
    g.font = `600 ${Math.round(14 * dpr)}px 'Cormorant Garamond', Georgia, serif`;
    g.fillStyle = 'rgba(243, 234, 214, 0.85)';
    g.fillText('N', w - 40 * dpr, 40 * dpr);
    g.strokeStyle = 'rgba(243, 234, 214, 0.6)';
    g.beginPath();
    g.moveTo(w - 40 * dpr, 50 * dpr);
    g.lineTo(w - 40 * dpr, 80 * dpr);
    g.stroke();
    const found = LANDMARKS.filter((l) => this.discovered.has(l.id)).length;
    this.legend.textContent = `${found} of ${LANDMARKS.length} places discovered · ${Math.round((this.revealedFraction() * 100))}% explored`;
  }

  private centersCache: ({ x: number; z: number } | null)[] | null = null;

  private biomeCenters(): ({ x: number; z: number } | null)[] {
    if (this.centersCache) return this.centersCache;
    const sums = Array.from({ length: BIOME_COUNT }, () => ({ x: 0, z: 0, n: 0 }));
    for (let z = -WORLD_HALF + 32; z < WORLD_HALF; z += 64) {
      for (let x = -WORLD_HALF + 32; x < WORLD_HALF; x += 64) {
        if (this.world.heightAt(x, z) < this.world.waterLevelAt(x, z)) continue;
        const b = this.world.dominantBiome(x, z);
        sums[b].x += x;
        sums[b].z += z;
        sums[b].n += 1;
      }
    }
    this.centersCache = sums.map((s) => (s.n > 3 ? { x: s.x / s.n, z: s.z / s.n } : null));
    return this.centersCache;
  }

  private revealedAt(x: number, z: number): boolean {
    const i = Math.floor((x + WORLD_HALF) / FOG_CELL);
    const j = Math.floor((z + WORLD_HALF) / FOG_CELL);
    if (i < 0 || j < 0 || i >= FOG_RES || j >= FOG_RES) return false;
    return this.fog[j * FOG_RES + i] > 128;
  }

  revealedFraction(): number {
    let n = 0;
    for (const v of this.fog) if (v > 128) n += 1;
    return n / this.fog.length;
  }

  serialize(): { fog: string; pins: MapPin[] } {
    let bin = '';
    for (let i = 0; i < this.fog.length; i += 1) bin += String.fromCharCode(this.fog[i]);
    return { fog: btoa(bin), pins: this.pins.slice() };
  }

  load(data: { fog: string; pins: MapPin[] }): void {
    try {
      const bin = atob(data.fog);
      for (let i = 0; i < Math.min(bin.length, this.fog.length); i += 1) this.fog[i] = bin.charCodeAt(i);
    } catch {
      // Corrupt fog data: keep what we have.
    }
    this.pins.length = 0;
    for (const p of data.pins ?? []) this.pins.push(p);
  }
}
