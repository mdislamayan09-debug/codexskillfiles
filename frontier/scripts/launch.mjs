// One place that decides how the capture/probe tooling starts Chromium.
// GL=metal (default on macOS) renders on the real GPU, the same path the owner's MacBook uses in play.
// GL=swiftshader is the software path the earlier rounds were captured with (5-15 min a frame).
import { chromium } from 'playwright';
import fs from 'node:fs';

export const GL = process.env.GL || (process.platform === 'darwin' ? 'metal' : 'swiftshader');

export function launch() {
  const boxed = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  if (GL === 'swiftshader') {
    return chromium.launch({
      executablePath: boxed,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
    });
  }
  // the full browser in new-headless mode keeps the GPU process; the headless shell falls back to software
  return chromium.launch({
    channel: boxed ? undefined : 'chromium',
    executablePath: boxed,
    args: ['--use-gl=angle', `--use-angle=${GL}`, '--ignore-gpu-blocklist', '--enable-webgl', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
}
