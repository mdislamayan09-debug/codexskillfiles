/// <reference lib="webworker" />
import { generateWorld, type WorldFields } from './generateWorld';

export interface WorldGenProgress {
  type: 'progress';
  stage: string;
  fraction: number;
}

export interface WorldGenDone {
  type: 'done';
  fields: WorldFields;
}

export interface WorldGenError {
  type: 'error';
  message: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = () => {
  try {
    let lastPost = 0;
    const fields = generateWorld((stage, fraction) => {
      const now = performance.now();
      if (now - lastPost < 60 && fraction > 0 && fraction < 1) return;
      lastPost = now;
      scope.postMessage({ type: 'progress', stage, fraction } satisfies WorldGenProgress);
    });
    const transfer: Transferable[] = [
      fields.heights.buffer,
      fields.normals.buffer,
      fields.biome.buffer,
      fields.masks.buffer,
      fields.water.buffer,
      ...fields.rivers.map((r) => r.points.buffer),
      ...fields.lakes.map((l) => l.shape.buffer),
    ];
    scope.postMessage({ type: 'done', fields } satisfies WorldGenDone, transfer);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies WorldGenError);
  }
};
