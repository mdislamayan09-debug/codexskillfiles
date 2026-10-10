// Find draw calls that GL rejects (sampler/texture mismatch) and name the program behind them.
import { launch } from './launch.mjs';
import fs from 'node:fs';
const url = process.argv[2];
const shot = process.argv[3] || 'snowride';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript(() => {
  window.__bad = new Map();
  const P = WebGL2RenderingContext.prototype;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const orig = P[fn];
    P[fn] = function (...a) {
      while (this.getError() !== 0) {}
      orig.apply(this, a);
      const e = this.getError();
      if (e !== 0) {
        const prog = this.getParameter(this.CURRENT_PROGRAM);
        if (!window.__bad.has(prog)) {
          const n = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS);
          const samplers = [];
          for (let i = 0; i < n; i++) {
            const u = this.getActiveUniform(prog, i);
            if ([0x8b5e, 0x8dc1, 0x8b62, 0x8dc4, 0x8b60, 0x8dca, 0x8dcf, 0x8dd2, 0x8dd7, 0x8b5f, 0x8dc5].includes(u.type)) {
              const unit = this.getUniform(prog, this.getUniformLocation(prog, u.name));
              samplers.push(`${u.name}:0x${u.type.toString(16)}@${unit}`);
            }
          }
          window.__bad.set(prog, { fn, err: e, samplers, count: 0, where: {} });
        }
        const b = window.__bad.get(prog); b.count++;
        const vp = this.getParameter(this.VIEWPORT);
        const fb = this.getParameter(this.FRAMEBUFFER_BINDING);
        const k = `f${window.__game ? window.__game.frame : -1} fb${fb ? 1 : 0} ${vp[2]}x${vp[3]}`;
        b.where[k] = (b.where[k] || 0) + 1;
      }
    };
  }
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 600000, polling: 1000 });
await page.evaluate((s) => window.__game.setShot(s), shot);
await page.waitForFunction(() => window.__game.frame >= 3, null, { timeout: 600000, polling: 500 });
const out = await page.evaluate(() => {
  const progs = window.__game.renderer.info.programs || [];
  const res = [];
  for (const [prog, info] of window.__bad) {
    const p = progs.find((q) => q.program === prog);
    res.push({ ...info, name: p ? p.name : '?', key: p ? String(p.cacheKey).slice(0, 160) : '?' });
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('glcheck.out.json', JSON.stringify(out, null, 1));
await browser.close();
