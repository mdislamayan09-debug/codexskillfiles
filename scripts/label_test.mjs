import { Human } from '../src/creatures.js';
const h = new Human('arthur', 7);
const g = h.bodyMesh.geometry, p = g.attributes.position, lab = g.attributes.aLabel, col = g.attributes.color;
const bins = {};
for (let i = 0; i < p.count; i++) {
  const y = p.getY(i); if (y < 1.0 || y > 1.5) continue;
  const k = lab.getX(i); bins[k] = (bins[k] || 0) + 1;
}
console.log('torso labels (y 1.0-1.5):', bins);
let i0 = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.3 && p.getY(i) < 1.32 && p.getZ(i) < -0.1) { i0 = i; break; }
console.log('back sample label', lab.getX(i0), 'color', col.getX(i0).toFixed(3), col.getY(i0).toFixed(3), col.getZ(i0).toFixed(3));
