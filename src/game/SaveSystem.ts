// Save games are composed from participants: each system registers a key
// with save/load functions, so new systems (harvested nodes, buildings,
// quests) add themselves without touching this file. Data is JSON in
// localStorage; failures never crash the game — they are reported.

export interface SaveParticipant {
  save(): unknown;
  load(data: unknown): void;
}

export interface SaveMeta {
  slot: string;
  savedAt: number;
  day: number;
  hours: number;
  location: string;
  playtime: number;
}

interface SaveFile {
  version: number;
  meta: SaveMeta;
  data: Record<string, unknown>;
}

const PREFIX = 'stillwild.save.';
const VERSION = 1;
const RESUME_FLAG = 'stillwild.resume';

export class SaveSystem {
  private readonly participants = new Map<string, SaveParticipant>();
  lastError: string | null = null;

  register(key: string, participant: SaveParticipant): void {
    this.participants.set(key, participant);
  }

  save(slot: string, meta: Omit<SaveMeta, 'slot' | 'savedAt'>): boolean {
    const data: Record<string, unknown> = {};
    for (const [key, p] of this.participants) {
      try {
        data[key] = p.save();
      } catch (error) {
        console.error(`Save participant "${key}" failed`, error);
      }
    }
    const file: SaveFile = { version: VERSION, meta: { ...meta, slot, savedAt: Date.now() }, data };
    try {
      localStorage.setItem(PREFIX + slot, JSON.stringify(file));
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  load(slot: string): SaveMeta | null {
    let file: SaveFile;
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      file = JSON.parse(raw) as SaveFile;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
    if (!file || file.version !== VERSION || typeof file.data !== 'object') return null;
    for (const [key, p] of this.participants) {
      if (!(key in file.data)) continue;
      try {
        p.load(file.data[key]);
      } catch (error) {
        console.error(`Load participant "${key}" failed`, error);
      }
    }
    return file.meta;
  }

  meta(slot: string): SaveMeta | null {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) return null;
      return (JSON.parse(raw) as SaveFile).meta ?? null;
    } catch {
      return null;
    }
  }

  delete(slot: string): void {
    try {
      localStorage.removeItem(PREFIX + slot);
    } catch {
      // ignore
    }
  }

  /** Mark that the next boot should resume the session slot (quality reloads). */
  static markResume(): void {
    try {
      sessionStorage.setItem(RESUME_FLAG, '1');
    } catch {
      // ignore
    }
  }

  static consumeResume(): boolean {
    try {
      const flag = sessionStorage.getItem(RESUME_FLAG) === '1';
      sessionStorage.removeItem(RESUME_FLAG);
      return flag;
    } catch {
      return false;
    }
  }
}
