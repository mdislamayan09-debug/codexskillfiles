import { Human, Quadruped } from '../src/creatures.js';
for (const [k, f] of [['human arthur', () => new Human('arthur', 1)], ['human outlaw', () => new Human('outlaw', 2)], ['horse', () => new Quadruped('horse', 1, 'pinto')], ['deer', () => new Quadruped('deer', 2)], ['sheep', () => new Quadruped('sheep', 3)], ['horse again', () => new Quadruped('horse', 4, 'bay')]]) {
  const t = performance.now(); const o = f();
  console.log(k, (performance.now() - t).toFixed(0) + 'ms', 'verts', o.bodyMesh.geometry.attributes.position.count);
}
