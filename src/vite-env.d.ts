/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  state: string;
  score: number;
  targetScore: number;
  complete: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
    mode?: string;
    health?: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs?: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  world?: Record<string, unknown>;
  timings?: Record<string, number>;
  errors?: string[];
}

interface ThreeGameTestHooks {
  seed(value: number): void | Promise<void>;
  setState(name: string): { state: string } | Promise<{ state: string }>;
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  setReducedMotion(enabled: boolean): void | Promise<void>;
  hideDebugUi(hidden: boolean): void | Promise<void>;
  [extra: string]: unknown;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
