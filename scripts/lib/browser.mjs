// How the playtests and captures start Chromium.
//
// On a machine with a graphics card the game renders on it: many times
// faster than software, and closer to what a player sees. The cloud sessions
// have no GPU and a pre-installed Chromium, so there WebGL runs on
// SwiftShader instead. `--swiftshader` forces software rendering anywhere;
// `--gpu` forces the card even where SwiftShader is the default.
//
// `--profile <dir>` keeps a browser profile between runs. The island is
// cached in the profile's IndexedDB, so later runs skip generating it: handy
// when iterating on a capture. Playtests leave it off and start clean.
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PREINSTALLED = '/opt/pw-browsers/chromium';

/** True when this run renders in software (SwiftShader). */
export function softwareRendering(args = process.argv.slice(2)) {
  if (args.includes('--swiftshader')) return true;
  if (args.includes('--gpu')) return false;
  return existsSync(PREINSTALLED);
}

/**
 * A browser with `newPage({ viewport })` and `close()`. Scripts use nothing
 * else, so a persistent profile can stand in for a fresh browser.
 */
export async function launchChromium(args = process.argv.slice(2)) {
  const software = softwareRendering(args);
  const options = {
    // `--headed` opens a real window: frame pacing as a player sees it
    // (headless compositing adds its own cost).
    headless: !args.includes('--headed'),
    // The full Chromium, never the headless shell (which has no GPU backend).
    ...(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : { channel: 'chromium' }),
    args: software
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
      : // SwiftShader stays allowed as a fallback, so a machine without a
        // usable card still runs the tests (slowly) instead of failing.
        ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'],
  };
  const i = args.indexOf('--profile');
  if (i < 0) return chromium.launch(options);
  const context = await chromium.launchPersistentContext(args[i + 1], options);
  return {
    async newPage(pageOptions = {}) {
      const page = await context.newPage();
      if (pageOptions.viewport) await page.setViewportSize(pageOptions.viewport);
      return page;
    },
    close: () => context.close(),
  };
}
