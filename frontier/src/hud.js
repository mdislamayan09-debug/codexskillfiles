// HUD: cores, minimap/compass, weapon & ammo, prompts, feed, region banners, parchment map, menus.
import { HALF, WORLD_SIZE, RES, TOWN, CAMP, RANCH, CHURCH, LAKE, SWAMP } from './world.js';

const ICONS = {
  heart: '<path d="M12 21s-7-4.6-9.3-9C1 8.6 3 5 6.5 5c2 0 3.5 1.2 5.5 3.2C14 6.2 15.5 5 17.5 5 21 5 23 8.6 21.3 12 19 16.4 12 21 12 21z"/>',
  stamina: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  eye: '<path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>',
  horse: '<path d="M19 3c-2 0-4 1-5 2l-5 1c-2 .4-3 2-3 4v3l-2 4 2 1 2-3h2l1 7h3l-1-7 3-2 3 1 1-2-2-3V6l1-2z"/>',
};

function core(id, icon) {
  return `<div class="core" id="${id}">
    <svg viewBox="0 0 44 44" class="ring"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" pathLength="100"/></svg>
    <div class="fill"></div>
    <svg viewBox="0 0 24 24" class="ico">${ICONS[icon]}</svg>
  </div>`;
}

export class HUD {
  constructor(world) {
    this.world = world;
    const root = (this.root = document.getElementById('hud'));
    root.innerHTML = `
      <div id="feed"></div>
      <div id="topright"><div id="money">$0.00</div><div id="clock"></div><div id="wanted"></div></div>
      <div id="banner"><div class="b1"></div><div class="b2"></div></div>
      <div id="reticle"><div class="dot"></div><div class="hit"></div></div>
      <div id="bl">
        <div id="mini"><canvas width="220" height="220"></canvas><div class="north">N</div><div class="me"></div></div>
        <div id="cores">${core('c-health', 'heart')}${core('c-stamina', 'stamina')}${core('c-deadeye', 'eye')}<div class="sep"></div>${core('c-horse', 'horse')}${core('c-hstam', 'stamina')}</div>
      </div>
      <div id="br"><div id="prompts"></div><div id="weapon"><svg viewBox="0 0 120 40" class="gun"><path d="M4 14h66l4-4h16l2 4h22v6H92l-4 4H76l-8 14H54l6-14H40l-4 4H20l-2-4H4z"/></svg><div id="ammo">6<span>/ 48</span></div></div></div>
      <div id="objective"></div>
      <div id="subtitle"></div>
      <div id="deadeye-overlay"></div>
      <div id="mapscreen"><canvas width="1024" height="1024"></canvas><div class="legend">CEDAR VALLEY · COLORADO TERRITORY · 1899</div><div class="close">[M] Close</div></div>
      <div id="help">
        <h2>Controls</h2>
        <table>
          <tr><td>W A S D</td><td>Move / steer horse</td></tr>
          <tr><td>Shift</td><td>Sprint / gallop (hold)</td></tr>
          <tr><td>Ctrl</td><td>Walk</td></tr>
          <tr><td>Mouse</td><td>Look (click to capture)</td></tr>
          <tr><td>Right mouse</td><td>Aim · Left mouse: Fire</td></tr>
          <tr><td>Q</td><td>Dead Eye</td></tr>
          <tr><td>R</td><td>Reload</td></tr>
          <tr><td>E</td><td>Mount / dismount</td></tr>
          <tr><td>H</td><td>Whistle for horse</td></tr>
          <tr><td>F</td><td>Loot / interact</td></tr>
          <tr><td>V</td><td>Cinematic camera</td></tr>
          <tr><td>M</td><td>Map</td></tr>
          <tr><td>T</td><td>Wait one hour</td></tr>
          <tr><td>Space</td><td>Jump</td></tr>
          <tr><td>F1</td><td>This help</td></tr>
        </table>
      </div>`;
    this.el = (id) => root.querySelector(id);
    this.feedEl = this.el('#feed');
    this.mini = this.el('#mini canvas').getContext('2d');
    this.mapCanvas = this.buildMap(1024);
    const mc = this.el('#mapscreen canvas').getContext('2d');
    mc.drawImage(this.mapCanvas, 0, 0);
    this.drawMapLabels(mc, 1024);
    this.bannerT = 0;
    this.hitT = 0;
    this.lastRegion = '';
  }

  buildMap(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const W = this.world;
    const step = WORLD_SIZE / size;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -HALF + (i + 0.5) * step, z = -HALF + (j + 0.5) * step;
      const h = W.heightAt(x, z);
      const hx = W.heightAt(x + step, z), hz = W.heightAt(x, z + step);
      const shade = Math.max(0, Math.min(1, 0.6 + (h - hx) * 0.06 + (h - hz) * 0.06));
      const sp = W.splatAt(x, z);
      // parchment palette
      let r = 214, gg = 196, b = 156;
      const elev = Math.min(1, Math.max(0, h / 400));
      r -= elev * 50; gg -= elev * 50; b -= elev * 40;
      if (sp.forest > 0.3) { r -= 34 * sp.forest; gg -= 18 * sp.forest; b -= 34 * sp.forest; }
      if (h > 280) { r += 30; gg += 32; b += 40; }
      r *= 0.55 + shade * 0.6; gg *= 0.55 + shade * 0.6; b *= 0.55 + shade * 0.6;
      if (h < 0) { const d = Math.min(1, -h / 4); r = 120 - 30 * d; gg = 132 - 25 * d; b = 128 - 15 * d; }
      if (sp.road > 0.4) { r = 120; gg = 86; b = 56; }
      // contour lines
      if (h > 4 && Math.floor(h / 40) !== Math.floor(hx / 40)) { r *= 0.8; gg *= 0.8; b *= 0.8; }
      const k = (j * size + i) * 4;
      const n = (Math.random() - 0.5) * 10;
      img.data[k] = r + n; img.data[k + 1] = gg + n; img.data[k + 2] = b + n; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // vignette / burnt edge
    const gr = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
    gr.addColorStop(0, 'rgba(60,40,20,0)'); gr.addColorStop(1, 'rgba(60,40,20,0.55)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  }

  toMap(x, z, size) { return [((x + HALF) / WORLD_SIZE) * size, ((z + HALF) / WORLD_SIZE) * size]; }

  drawMapLabels(g, size) {
    g.font = `${size * 0.022}px "IM Fell English SC", Georgia, serif`;
    g.fillStyle = '#3a2614';
    g.textAlign = 'center';
    const lab = (t, x, z, s = 1) => { const [mx, my] = this.toMap(x, z, size); g.font = `${size * 0.02 * s}px "IM Fell English SC", Georgia, serif`; g.fillText(t, mx, my); };
    const icon = (x, z, col) => { const [mx, my] = this.toMap(x, z, size); g.fillStyle = col; g.beginPath(); g.arc(mx, my, size * 0.007, 0, 7); g.fill(); g.fillStyle = '#3a2614'; };
    icon(TOWN.x, TOWN.z, '#7a1a10'); lab('Copper Hollow', TOWN.x, TOWN.z - 70, 1.3);
    icon(CAMP.x, CAMP.z, '#202020'); lab('Cutter Hideout', CAMP.x, CAMP.z - 50);
    lab("Hale's Ranch", RANCH.x, RANCH.z + 80, 0.9);
    lab('Lake Ardent', LAKE.x, LAKE.z, 1.1);
    lab('Bluewater Bayou', SWAMP.x, SWAMP.z, 1.1);
    lab('THE GRANITE TEETH', 0, -1500, 1.8);
    lab('Dawson River', -480, -500, 0.9);
  }

  region(pos) {
    const d = (a) => Math.hypot(pos.x - a.x, pos.z - a.z);
    if (d(TOWN) < 170) return ['Copper Hollow', 'Cedar Valley'];
    if (d(RANCH) < 110) return ["Hale's Ranch", 'Cedar Valley'];
    if (d(CAMP) < 120) return ['Cutter Hideout', 'Pine Ridge'];
    if (d(LAKE) < 330) return ['Lake Ardent', 'Cedar Valley'];
    if (pos.x > 600 && pos.z > 650) return ['Bluewater Bayou', 'Lemoine Parish'];
    if (pos.z < -800) return ['The Granite Teeth', 'Colorado Territory'];
    if (pos.z < -300) return ['Pine Ridge', 'Cedar Valley'];
    return ['The Heartlands', 'Cedar Valley'];
  }

  banner(a, b) {
    this.el('#banner .b1').textContent = a;
    this.el('#banner .b2').textContent = b;
    const el = this.el('#banner');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'item ' + cls;
    d.innerHTML = text;
    this.feedEl.prepend(d);
    setTimeout(() => d.classList.add('out'), 4200);
    setTimeout(() => d.remove(), 5200);
    while (this.feedEl.children.length > 4) this.feedEl.lastChild.remove();
  }

  hitmarker(kill) {
    const h = this.el('#reticle .hit');
    h.className = 'hit ' + (kill ? 'kill' : 'on');
    clearTimeout(this._hm); this._hm = setTimeout(() => (h.className = 'hit'), 220);
  }

  setCore(id, v, core = v) {
    const el = this.el('#' + id);
    el.querySelector('.fg').style.strokeDashoffset = String(100 - v);
    el.querySelector('.fill').style.transform = `scale(${0.25 + 0.75 * core / 100})`;
    el.classList.toggle('low', v < 25);
  }

  setObjective(t) { this.el('#objective').innerHTML = t ? `<span>◆</span> ${t}` : ''; }
  subtitle(t, dur = 4) {
    const s = this.el('#subtitle'); s.textContent = t; s.classList.add('show');
    clearTimeout(this._st); this._st = setTimeout(() => s.classList.remove('show'), dur * 1000);
  }

  update(dt, g) {
    const p = g.player;
    const pos = p.mounted ? p.hpos : p.pos;
    this.setCore('c-health', p.health);
    this.setCore('c-stamina', p.stamina);
    this.setCore('c-deadeye', p.deadEye);
    this.setCore('c-horse', p.horseHealth);
    this.setCore('c-hstam', p.horseStamina);
    this.root.classList.toggle('mounted', p.mounted || p.pos.distanceTo(p.hpos) < 25);
    this.root.classList.toggle('aiming', p.aiming);
    this.root.classList.toggle('cinematic', p.cinematicOn);
    this.el('#money').textContent = '$' + g.money.toFixed(2);
    const t = g.sky.time; const hh = Math.floor(t), mm = Math.floor((t - hh) * 60);
    this.el('#clock').textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    this.el('#wanted').textContent = g.wanted > 0 ? `WANTED · $${g.bounty.toFixed(0)} BOUNTY` : '';
    this.el('#ammo').innerHTML = `${g.ammo}<span>/ ${g.reserve}</span>`;
    this.el('#reticle').classList.toggle('enemy', !!g.reticleEnemy);
    this.el('#deadeye-overlay').style.opacity = g.deadEyeK;
    // prompts
    const pr = [];
    if (!p.mounted && p.pos.distanceTo(p.hpos) < 3.5) pr.push(['E', 'Mount']);
    if (p.mounted) pr.push(['E', 'Dismount']);
    if (!p.mounted && p.pos.distanceTo(p.hpos) > 15) pr.push(['H', 'Whistle']);
    if (g.lootTarget) pr.push(['F', g.lootTarget]);
    if (p.mounted) pr.push(['V', 'Cinematic Camera']);
    const html = pr.map(([k, t]) => `<div><kbd>${k}</kbd>${t}</div>`).join('');
    if (html !== this._pr) { this.el('#prompts').innerHTML = html; this._pr = html; }
    // region banner
    const [r1, r2] = this.region(pos);
    if (r1 !== this.lastRegion) { this.lastRegion = r1; this.banner(r1, r2); }
    this.drawMini(pos, p.camYaw, g);
  }

  drawMini(pos, yaw, game) {
    const g = this.mini, S = 220, R = S / 2;
    const scale = 1.35; // minimap zoom
    const src = this.mapCanvas, ms = src.width;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.translate(R, R);
    g.rotate(yaw + Math.PI);
    const [mx, my] = this.toMap(pos.x, pos.z, ms);
    const k = (ms / WORLD_SIZE) * 0 + scale; // zoom factor
    g.scale(k, k);
    g.drawImage(src, -mx, -my);
    // blips
    const blip = (x, z, col, r = 3) => { const [bx, by] = this.toMap(x, z, ms); g.fillStyle = col; g.beginPath(); g.arc(bx - mx, by - my, r / k, 0, 7); g.fill(); };
    for (const a of game.npcs.actors) {
      if (a.dead) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d > 220) continue;
      if (a.kind === 'outlaw' && game.npcs.alerted) blip(a.pos.x, a.pos.z, '#b01a10', 3.2);
      else if (a.kind === 'towns') blip(a.pos.x, a.pos.z, 'rgba(240,235,220,0.8)', 2);
      else if (a.kind === 'deer') blip(a.pos.x, a.pos.z, 'rgba(255,255,255,0.4)', 1.6);
    }
    const p = game.player;
    if (!p.mounted) blip(p.hpos.x, p.hpos.z, '#e8c27a', 3.5);
    blip(CAMP.x, CAMP.z, '#f0e0b0', 5);
    g.restore();
    // vignette ring
    const gr = g.createRadialGradient(R, R, R * 0.6, R, R, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(10,6,2,0.55)');
    g.fillStyle = gr; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.fill();
    // north marker position on the ring
    const n = this.el('#mini .north');
    const ang = yaw + Math.PI - Math.PI / 2;
    n.style.transform = `translate(${Math.cos(ang) * (R - 14)}px, ${Math.sin(ang) * (R - 14)}px)`;
  }
}
