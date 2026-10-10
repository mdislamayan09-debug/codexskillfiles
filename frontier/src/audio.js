// Procedural Web Audio: wind, birds, crickets, river, hooves, footsteps, gunshots, and a sparse
// plucked-guitar score (Karplus-Strong) that swells while riding.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = C.createGain(); this.master.gain.value = 0.8; this.master.connect(C.destination);
    this.verb = C.createConvolver(); this.verb.buffer = this.impulse(2.8, 2.2);
    this.verbGain = C.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    // wind bed
    this.wind = this.loopNoise(); this.windF = C.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.6;
    this.windG = C.createGain(); this.windG.gain.value = 0.05;
    this.wind.connect(this.windF).connect(this.windG).connect(this.master);
    // river bed
    this.river = this.loopNoise(); const rf = C.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1400;
    this.riverG = C.createGain(); this.riverG.gain.value = 0;
    this.river.connect(rf).connect(this.riverG).connect(this.master);
    this.enabled = true;
    this.birdT = 0; this.cricketT = 0; this.musicT = 3; this.musicStep = 0;
  }
  impulse(sec, decay) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec);
    const b = C.createBuffer(2, n, C.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  makeNoise(sec) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec);
    const b = C.createBuffer(1, n, C.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; }

  burst({ freq = 1000, q = 1, type = 'lowpass', dur = 0.2, gain = 0.5, verb = 0.2, attack = 0.002, when = 0 } = {}) {
    const C = this.ctx; const t = C.currentTime + when;
    const s = C.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g); g.connect(this.master);
    if (verb) { const v = C.createGain(); v.gain.value = verb; g.connect(v).connect(this.verb); }
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone({ freq = 440, type = 'sine', dur = 0.2, gain = 0.2, slide = 0, verb = 0.2, when = 0 } = {}) {
    const C = this.ctx; const t = C.currentTime + when;
    const o = C.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    if (verb) { const v = C.createGain(); v.gain.value = verb; g.connect(v).connect(this.verb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  pluck(freq, gain = 0.12, when = 0) {
    // Karplus-Strong string
    const C = this.ctx, sr = C.sampleRate, n = Math.floor(sr * 2.2);
    const b = C.createBuffer(1, n, sr), d = b.getChannelData(0);
    const p = Math.floor(sr / freq);
    for (let i = 0; i < p; i++) d[i] = Math.random() * 2 - 1;
    for (let i = p; i < n; i++) d[i] = (d[i - p] + d[i - p + 1]) * 0.4965;
    const s = C.createBufferSource(); s.buffer = b;
    const g = C.createGain(); g.gain.value = gain;
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    s.connect(f).connect(g).connect(this.master);
    const v = C.createGain(); v.gain.value = 0.5; g.connect(v).connect(this.verb);
    s.start(C.currentTime + when);
  }

  gunshot(pos, vol = 1) {
    if (!this.enabled) return;
    let att = 1;
    if (pos && this.listener) att = Math.min(1, 25 / Math.max(5, pos.distanceTo(this.listener)));
    const g = vol * att;
    this.burst({ freq: 3500, type: 'lowpass', dur: 0.12, gain: 0.9 * g, verb: 0.9 });
    this.burst({ freq: 900, type: 'lowpass', dur: 0.5, gain: 0.6 * g, verb: 1.2 });
    this.tone({ freq: 90, type: 'sine', dur: 0.35, gain: 0.7 * g, slide: -50, verb: 0.3 });
    // distant echo slap
    this.burst({ freq: 700, type: 'lowpass', dur: 0.6, gain: 0.12 * g, verb: 1.5, when: 0.35 });
  }
  hoof(gait) {
    if (!this.enabled) return;
    const n = gait >= 3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      this.burst({ freq: 380 + Math.random() * 200, type: 'lowpass', dur: 0.09, gain: 0.22, verb: 0.05, when: i * (gait >= 3 ? 0.07 : 0.16) });
      this.tone({ freq: 70 + Math.random() * 20, dur: 0.08, gain: 0.25, verb: 0, when: i * (gait >= 3 ? 0.07 : 0.16) });
    }
  }
  step() { if (this.enabled) this.burst({ freq: 900, type: 'bandpass', q: 0.8, dur: 0.07, gain: 0.12, verb: 0 }); }
  click() { if (this.enabled) this.burst({ freq: 4000, type: 'highpass', dur: 0.03, gain: 0.25, verb: 0 }); }
  reload() { if (!this.enabled) return; for (let i = 0; i < 6; i++) this.burst({ freq: 3000, type: 'bandpass', q: 3, dur: 0.03, gain: 0.15, verb: 0, when: 0.15 * i + 0.2 }); }
  cash() { if (!this.enabled) return; [1318, 1568, 2093].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.08, when: i * 0.07 })); }
  notify() { if (this.enabled) { this.pluck(220, 0.12); this.pluck(330, 0.1, 0.12); } }
  deadEye(on) { if (this.enabled) { this.tone({ freq: on ? 160 : 320, type: 'sine', dur: 0.6, gain: 0.25, slide: on ? -100 : 200, verb: 1 }); this.burst({ freq: 300, dur: 0.6, gain: 0.2, verb: 1 }); } }
  whistle() {
    if (!this.enabled) return;
    this.tone({ freq: 1800, type: 'sine', dur: 0.18, gain: 0.12, slide: 400, verb: 0.6 });
    this.tone({ freq: 2200, type: 'sine', dur: 0.3, gain: 0.12, slide: -500, verb: 0.6, when: 0.2 });
  }

  update(dt, { night = 0, speed = 0, nearWater = 0, riding = false, listener = null, deadEye = 0 }) {
    if (!this.enabled) return;
    this.listener = listener;
    const C = this.ctx, t = C.currentTime;
    this.windG.gain.setTargetAtTime(0.035 + speed * 0.006 + Math.sin(t * 0.3) * 0.015, t, 0.5);
    this.windF.frequency.setTargetAtTime(400 + speed * 40 + Math.sin(t * 0.17) * 120, t, 0.5);
    this.riverG.gain.setTargetAtTime(nearWater * 0.06, t, 0.5);
    this.master.gain.setTargetAtTime(deadEye > 0.5 ? 0.45 : 0.8, t, 0.2);
    // birds by day, crickets at night
    this.birdT -= dt;
    if (this.birdT < 0) {
      this.birdT = 1.5 + Math.random() * 5;
      if (night < 0.5) {
        const f = 2200 + Math.random() * 2000, n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone({ freq: f * (1 + Math.random() * 0.2), type: 'sine', dur: 0.08 + Math.random() * 0.1, gain: 0.025, slide: (Math.random() - 0.5) * 1500, when: i * 0.13, verb: 0.6 });
      } else if (Math.random() < 0.3) {
        this.tone({ freq: 380, type: 'sine', dur: 0.5, gain: 0.03, slide: -60, verb: 1 }); // owl
        this.tone({ freq: 360, type: 'sine', dur: 0.7, gain: 0.03, slide: -60, verb: 1, when: 0.6 });
      }
    }
    if (night > 0.5) {
      this.cricketT -= dt;
      if (this.cricketT < 0) { this.cricketT = 0.4 + Math.random() * 0.4; for (let i = 0; i < 3; i++) this.tone({ freq: 4400, type: 'square', dur: 0.025, gain: 0.006, when: i * 0.05, verb: 0.3 }); }
    }
    // sparse score while riding: A minor, open-string feel
    this.musicT -= dt;
    if (riding && this.musicT < 0) {
      const prog = [[110, 165, 220, 262], [98, 147, 196, 247], [87, 131, 175, 220], [82, 123, 165, 208]];
      const chord = prog[this.musicStep % prog.length];
      chord.forEach((f, i) => this.pluck(f, 0.06, i * 0.11));
      if (Math.random() < 0.5) this.pluck(chord[3] * 2, 0.04, 0.9);
      this.musicStep++;
      this.musicT = 2.6;
    }
  }
}
