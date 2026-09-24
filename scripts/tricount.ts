import { generateTree, SPECIES } from '../src/world/vegetation/TreeGenerator';
for (const sp of Object.values(SPECIES)) {
  const out: string[] = [];
  for (const lod of [0, 1] as const) {
    const t = generateTree(sp, { seed: 42, lod });
    const bark = (t.bark.index?.count ?? 0) / 3;
    const leaves = (t.leaves?.index?.count ?? 0) / 3;
    out.push(`lod${lod}: bark ${bark} leaves ${leaves} (h=${t.height.toFixed(1)})`);
  }
  console.log(sp.id.padEnd(14), out.join(' | '));
}
