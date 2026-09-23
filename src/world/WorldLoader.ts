import { GEN_VERSION } from './WorldConfig';
import type { WorldFields } from './gen/generateWorld';
import type { WorldGenDone, WorldGenError, WorldGenProgress } from './gen/worldGen.worker';

const DB_NAME = 'stillwild-world';
const STORE = 'fields';
const KEY = `world-v${GEN_VERSION}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function readCache(): Promise<WorldFields | null> {
  try {
    const db = await openDb();
    const result = await new Promise<WorldFields | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as WorldFields | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (result && result.version === GEN_VERSION && result.heights?.length) return result;
    return null;
  } catch {
    return null;
  }
}

async function writeCache(fields: WorldFields): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      // Drop worlds from older generator versions.
      store.clear();
      store.put(fields, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Caching is an optimization; a failure only costs regeneration next launch.
  }
}

function generateInWorker(onProgress: (stage: string, fraction: number) => void): Promise<WorldFields> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gen/worldGen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorldGenProgress | WorldGenDone | WorldGenError>) => {
      const data = event.data;
      if (data.type === 'progress') onProgress(data.stage, data.fraction);
      else if (data.type === 'done') {
        worker.terminate();
        resolve(data.fields);
      } else {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'World generation worker failed'));
    };
    worker.postMessage({ start: true });
  });
}

/** Loads the world from cache, or generates it in a worker and caches it. */
export async function loadWorld(onProgress: (stage: string, fraction: number) => void, useCache = true): Promise<{ fields: WorldFields; cached: boolean }> {
  if (useCache) {
    onProgress('Unrolling the map', 0);
    const cached = await readCache();
    if (cached) return { fields: cached, cached: true };
  }
  const fields = await generateInWorker(onProgress);
  if (useCache) void writeCache(fields);
  return { fields, cached: false };
}
