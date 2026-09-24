import type { QualityName } from '../render/Quality';
import type { Bindings } from './Input';

// Player-facing options, persisted per browser. Every read goes through
// defaults so a missing or corrupt store (private windows, cleared data)
// never breaks the game.

export type Difficulty = 'explorer' | 'survivor' | 'harsh';

export interface GameSettings {
  quality: QualityName | 'auto';
  fov: number;
  renderScale: number;
  brightness: number;
  mouseSensitivity: number;
  padSensitivity: number;
  invertY: boolean;
  toggleSprint: boolean;
  toggleCrouch: boolean;
  headBob: boolean;
  reducedMotion: boolean;
  cameraShake: boolean;
  colorblind: 0 | 1 | 2 | 3;
  subtitles: boolean;
  subtitleSize: 'small' | 'medium' | 'large';
  uiScale: number;
  hudOpacity: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  difficulty: Difficulty;
  showFps: boolean;
  bindings: Partial<Bindings> | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'auto',
  fov: 74,
  renderScale: 1,
  brightness: 1,
  mouseSensitivity: 1,
  padSensitivity: 1,
  invertY: false,
  toggleSprint: false,
  toggleCrouch: true,
  headBob: true,
  reducedMotion: false,
  cameraShake: true,
  colorblind: 0,
  subtitles: true,
  subtitleSize: 'medium',
  uiScale: 1,
  hudOpacity: 1,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  ambienceVolume: 0.85,
  difficulty: 'survivor',
  showFps: false,
  bindings: null,
};

const STORAGE_KEY = 'stillwild.settings.v1';

export class SettingsStore {
  private data: GameSettings;
  private readonly listeners = new Set<(key: keyof GameSettings) => void>();

  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GameSettings>;
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) {
          if (parsed[key] !== undefined && typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) {
            (this.data as unknown as Record<string, unknown>)[key] = parsed[key];
          } else if (key === 'bindings' && parsed.bindings && typeof parsed.bindings === 'object') {
            this.data.bindings = parsed.bindings;
          }
        }
      }
    } catch {
      // Storage unavailable or corrupt: defaults stand.
    }
  }

  get<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.data[key];
  }

  get all(): Readonly<GameSettings> {
    return this.data;
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.save();
    for (const fn of this.listeners) fn(key);
  }

  reset(): void {
    this.data = { ...DEFAULT_SETTINGS };
    this.save();
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) for (const fn of this.listeners) fn(key);
  }

  onChange(fn: (key: keyof GameSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore quota/private mode failures.
    }
  }
}
