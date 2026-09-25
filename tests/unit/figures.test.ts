import { describe, expect, it } from 'vitest';
import { NPCS } from '../../src/story/StoryData';
import { buildEyelids, buildHead, EYE_R, EYE_X, faceDepth, faceMasks, MOUTH_Y } from '../../src/story/figures/head';

const varga = NPCS.find((n) => n.id === 'varga')!.look.person;

describe('sculpted heads', () => {
  it('put a nose on the face and hollow the eyes', () => {
    const tip = faceDepth(0, -0.029, varga);
    expect(tip).toBeGreaterThan(0.015);
    expect(faceDepth(EYE_X, 0.006, varga)).toBeLessThan(-0.01);
    // The cheek stands proud of the socket, the lips of the mouth line.
    expect(faceDepth(0.046, -0.013, varga)).toBeGreaterThan(faceDepth(EYE_X, 0.004, varga));
    expect(faceDepth(0, MOUTH_Y - 0.006, varga)).toBeGreaterThan(faceDepth(0, MOUTH_Y, varga));
  });

  it('paint lips on the lips and brows above the eyes', () => {
    expect(faceMasks(0.01, MOUTH_Y - 0.005, varga).lips).toBeGreaterThan(0.8);
    expect(faceMasks(0.01, MOUTH_Y + 0.03, varga).lips).toBeLessThan(0.05);
    expect(faceMasks(EYE_X, 0.022, varga).brow).toBeGreaterThan(0.3);
    expect(faceMasks(EYE_X, 0.006, varga).brow).toBeLessThan(0.05);
  });

  it('build a whole head for every survivor', () => {
    for (const npc of NPCS) {
      const head = buildHead(npc.look.person);
      const pos = head.skin.getAttribute('position');
      for (let i = 0; i < pos.count; i += 97) expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
      // Two eyes, mirrored, set in the face.
      expect(head.eyes).toHaveLength(2);
      expect(head.eyes[0].x).toBeCloseTo(-head.eyes[1].x, 5);
      expect(head.eyes[0].z).toBeGreaterThan(0.05);
      expect(head.eyes[0].z + EYE_R).toBeLessThan(0.11);
      if (npc.look.person.beard > 0.05) expect(head.beard).not.toBeNull();
    }
  });

  it('close the lids on a blink without changing the mesh', () => {
    const head = buildHead(varga);
    const open = buildEyelids(head.eyes, 0).getAttribute('position');
    const shut = buildEyelids(head.eyes, 1).getAttribute('position');
    expect(shut.count).toBe(open.count);
    // Some upper-lid vertex comes a long way down.
    let most = 0;
    for (let i = 0; i < open.count; i += 1) most = Math.max(most, open.getY(i) - shut.getY(i));
    // A real upper lid travels about five millimetres.
    expect(most).toBeGreaterThan(0.0045);
  });
});
