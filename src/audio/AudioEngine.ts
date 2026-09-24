// Every sound in STILLWILD is synthesized at runtime with the Web Audio API:
// no files, tiny download, and every biome gets its own living soundscape.
//
//   master ─ compressor ─ out
//     ├── music  (generative score per biome mode)
//     ├── sfx    (footsteps, tools, impacts, UI)   ─┐
//     └── amb    (wind, surf, rivers, fauna, fire)  ├─ reverb send (procedural IR)
//                                                   ┘
// Underwater, a low-pass sweeps over sfx and ambience.

export interface AudioState {
  listener: { x: number; y: number; z: number; fx: number; fy: number; fz: number };
  hours: number;
  /** 0..1 amount of each ambience. */
  wind: number;
  forest: number;
  meadow: number;
  sea: number;
  river: number;
  marsh: number;
  snow: number;
  fire: number;
  /** Seconds between breaking waves reaching the shore (0 = none). */
  surfPeriod: number;
  underwater: boolean;
  lowHealth: number;
  rain: number;
  musicMode: string;
  musicRoot: number;
  inDanger: boolean;
  /** 0..1 boss-fight intensity: drums and a low ostinato take over the score. */
  combat: number;
}

const MODES: Record<string, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  wholetone: [0, 2, 4, 6, 8, 10, 12],
};

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Loop {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private white!: AudioBuffer;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;
  private loops: Record<string, Loop> = {};
  private volumes = { master: 0.8, music: 0.7, sfx: 0.9, amb: 0.85 };
  private nextBird = 0;
  private nextCricket = 0;
  private nextFrog = 0;
  private nextCrackle = 0;
  private nextWave = 0;
  private nextHeart = 0;
  private nextPiece = 20;
  private pieceEnd = 0;
  private nextNote = 0;
  private chordIndex = 0;
  private seed = 1;
  private state: AudioState | null = null;
  private nextBeat = 0;
  private beatIndex = 0;

  /** Must be called from a user gesture (click / key). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.muffle);
    this.amb = ctx.createGain();
    this.amb.connect(this.muffle);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.white = this.noiseBuffer('white');
    this.pink = this.noiseBuffer('pink');
    this.brown = this.noiseBuffer('brown');
    this.loops.wind = this.loop(this.brown, 'lowpass', 420, 0.6);
    this.loops.leaves = this.loop(this.pink, 'bandpass', 4200, 0.7);
    this.loops.surf = this.loop(this.brown, 'lowpass', 380, 0.5);
    this.loops.river = this.loop(this.white, 'bandpass', 900, 0.6);
    this.loops.river2 = this.loop(this.pink, 'bandpass', 2600, 1.2);
    this.loops.fire = this.loop(this.brown, 'lowpass', 220, 0.7);
    this.loops.rain = this.loop(this.pink, 'highpass', 1400, 0.4);
    this.loops.under = this.loop(this.brown, 'lowpass', 160, 0.5);
    this.applyVolumes();
  }

  get running(): boolean {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  setVolumes(master: number, music: number, sfx: number, amb: number): void {
    this.volumes = { master, music, sfx, amb };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.volumes.amb, t, 0.05);
  }

  // ---------------------------------------------------------------------------
  // Building blocks

  private rand(): number {
    // xorshift: audio variety must not touch gameplay RNG.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0 || 1;
    return this.seed / 4294967296;
  }

  private noiseBuffer(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const w = this.rand() * 2 - 1;
      if (kind === 'white') data[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      } else {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.2;
      }
    }
    return buffer;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        // Early reflections then a smooth tail.
        const early = i < ctx.sampleRate * 0.08 && this.rand() < 0.004 ? 0.6 : 0;
        data[i] = ((this.rand() * 2 - 1) * Math.pow(1 - t, decay) + early) * 0.5;
      }
    }
    return buffer;
  }

  private loop(buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx as AudioContext;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = this.rand() * 2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.amb);
    source.start(0, this.rand() * 3);
    return { source, filter, gain };
  }

  /** A short enveloped noise burst. */
  private burst(opts: {
    buffer?: AudioBuffer;
    type?: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    attack?: number;
    decay: number;
    gain: number;
    when?: number;
    bus?: AudioNode;
    pan?: number;
    reverb?: number;
    rate?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = (opts.when ?? ctx.currentTime) + 0.001;
    const src = ctx.createBufferSource();
    src.buffer = opts.buffer ?? this.white;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + (opts.attack ?? 0.002) + opts.decay);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    let node: AudioNode = src.connect(f).connect(g);
    if (opts.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      node = node.connect(p);
    }
    node.connect(opts.bus ?? this.sfx);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      node.connect(s).connect(this.reverbSend);
    }
    src.start(t, this.rand() * 3);
    src.stop(t + a + opts.decay + 0.05);
  }

  /** A pitched tone with an optional pitch sweep. */
  private tone(opts: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    attack?: number;
    decay: number;
    gain: number;
    when?: number;
    bus?: AudioNode;
    pan?: number;
    reverb?: number;
    detune?: number;
    fm?: { ratio: number; index: number };
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = (opts.when ?? ctx.currentTime) + 0.001;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + (opts.attack ?? 0.002) + opts.decay);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + opts.decay);
    if (opts.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = opts.freq * opts.fm.ratio;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(opts.freq * opts.fm.index, t);
      mg.gain.exponentialRampToValueAtTime(opts.freq * 0.01 + 0.01, t + a + opts.decay * 0.6);
      mod.connect(mg).connect(osc.frequency);
      mod.start(t);
      mod.stop(t + a + opts.decay + 0.05);
    }
    let node: AudioNode = osc.connect(g);
    if (opts.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      node = node.connect(p);
    }
    node.connect(opts.bus ?? this.sfx);
    if (opts.reverb) {
      const s = ctx.createGain();
      s.gain.value = opts.reverb;
      node.connect(s).connect(this.reverbSend);
    }
    osc.start(t);
    osc.stop(t + a + opts.decay + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Sound effects

  footstep(surface: string, speed: number, left: boolean): void {
    if (!this.ctx) return;
    const v = Math.min(1, 0.35 + speed / 9);
    const pan = left ? -0.15 : 0.15;
    const r = () => 0.85 + this.rand() * 0.3;
    switch (surface) {
      case 'gravel':
        for (let i = 0; i < 5; i += 1) this.burst({ type: 'highpass', freq: 2200 * r(), decay: 0.02 + this.rand() * 0.03, gain: 0.09 * v, when: this.ctx.currentTime + i * 0.012 * r(), pan });
        break;
      case 'sand':
        this.burst({ buffer: this.pink, type: 'lowpass', freq: 1400 * r(), decay: 0.11, attack: 0.02, gain: 0.12 * v, pan });
        break;
      case 'snow':
        for (let i = 0; i < 3; i += 1) this.burst({ type: 'bandpass', freq: 2800 * r(), q: 1.2, decay: 0.05, gain: 0.1 * v, when: this.ctx.currentTime + i * 0.03, pan });
        break;
      case 'rock':
        this.tone({ freq: 1700 * r(), decay: 0.03, gain: 0.05 * v, pan });
        this.tone({ freq: 95, freqEnd: 60, decay: 0.07, gain: 0.18 * v, pan });
        break;
      case 'mud':
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 600, decay: 0.12, gain: 0.25 * v, pan });
        this.tone({ freq: 260, freqEnd: 120, decay: 0.08, gain: 0.06 * v, pan });
        break;
      case 'water':
      case 'swim':
        this.burst({ type: 'bandpass', freq: 900 * r(), freqEnd: 500, decay: 0.18, attack: 0.02, gain: 0.16 * v, pan, q: 0.6 });
        break;
      case 'ash':
        this.burst({ buffer: this.pink, type: 'lowpass', freq: 900, decay: 0.09, gain: 0.12 * v, pan });
        break;
      default: {
        // Grass & forest floor: soft crunch plus the odd twig.
        this.burst({ buffer: this.pink, type: 'bandpass', freq: 1500 * r(), q: 0.6, decay: 0.08, attack: 0.008, gain: 0.14 * v, pan });
        this.tone({ freq: 85, freqEnd: 55, decay: 0.05, gain: 0.12 * v, pan });
        if (surface === 'forest' && this.rand() < 0.18) this.burst({ type: 'highpass', freq: 3000, decay: 0.015, gain: 0.08 * v, when: this.ctx.currentTime + 0.03, pan });
      }
    }
  }

  land(speed: number): void {
    const v = Math.min(1, speed / 14);
    this.tone({ freq: 110, freqEnd: 45, decay: 0.16, gain: 0.35 * v + 0.05 });
    this.burst({ buffer: this.pink, type: 'lowpass', freq: 900, decay: 0.12, gain: 0.2 * v + 0.04 });
  }

  jump(): void {
    this.burst({ buffer: this.pink, type: 'bandpass', freq: 700, freqEnd: 1400, decay: 0.12, attack: 0.03, gain: 0.05 });
  }

  splash(strength: number): void {
    this.burst({ type: 'lowpass', freq: 2500, freqEnd: 400, decay: 0.45 + strength * 0.4, attack: 0.01, gain: 0.3 * strength + 0.08, reverb: 0.2 });
    for (let i = 0; i < 4; i += 1) this.tone({ freq: 700 + this.rand() * 900, freqEnd: 300, decay: 0.05, gain: 0.03, when: (this.ctx?.currentTime ?? 0) + 0.05 + this.rand() * 0.3 });
  }

  swing(): void {
    this.burst({ buffer: this.pink, type: 'bandpass', freq: 420, freqEnd: 1600, q: 1.4, decay: 0.16, attack: 0.05, gain: 0.12 });
  }

  hit(material: string): void {
    if (!this.ctx) return;
    switch (material) {
      case 'wood':
        this.tone({ freq: 150, freqEnd: 70, decay: 0.14, gain: 0.45 });
        this.burst({ type: 'bandpass', freq: 1100, q: 1, decay: 0.05, gain: 0.25 });
        this.tone({ freq: 430 + this.rand() * 60, decay: 0.09, gain: 0.08, reverb: 0.3 });
        break;
      case 'stone':
        this.tone({ freq: 2100 + this.rand() * 300, decay: 0.35, gain: 0.1, reverb: 0.4 });
        this.tone({ freq: 3370, decay: 0.22, gain: 0.05 });
        this.burst({ type: 'highpass', freq: 2500, decay: 0.04, gain: 0.25 });
        this.tone({ freq: 120, freqEnd: 70, decay: 0.08, gain: 0.2 });
        break;
      case 'timber':
        // A felled trunk: creak then crash.
        this.tone({ type: 'sawtooth', freq: 70, freqEnd: 38, attack: 0.3, decay: 1.1, gain: 0.05, reverb: 0.4 });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 700, freqEnd: 120, decay: 1.6, attack: 0.02, gain: 0.8, when: this.ctx.currentTime + 0.05, reverb: 0.5 });
        this.burst({ buffer: this.pink, type: 'bandpass', freq: 2500, decay: 0.9, attack: 0.02, gain: 0.25, when: this.ctx.currentTime + 0.05 });
        break;
      case 'soft':
        this.burst({ buffer: this.pink, type: 'lowpass', freq: 1200, decay: 0.08, gain: 0.12 });
        break;
      case 'flesh':
      case 'flesh-weak':
        this.tone({ freq: 130, freqEnd: 55, decay: 0.12, gain: 0.4 });
        this.burst({ buffer: this.pink, type: 'lowpass', freq: 1500, decay: 0.07, gain: 0.3 });
        if (material === 'flesh-weak') this.tone({ freq: 1560, decay: 0.35, gain: 0.08, reverb: 0.5, fm: { ratio: 2.7, index: 0.8 } });
        break;
      case 'songstone':
        // A songstone knot struck: a bright, ringing crack.
        this.tone({ freq: 1320 + this.rand() * 80, decay: 1.4, gain: 0.1, reverb: 0.8, fm: { ratio: 2.41, index: 1.4 } });
        this.tone({ freq: 2790, decay: 0.7, gain: 0.05, reverb: 0.6 });
        this.burst({ type: 'highpass', freq: 3200, decay: 0.05, gain: 0.2 });
        this.tone({ freq: 160, freqEnd: 70, decay: 0.12, gain: 0.25 });
        break;
      case 'growl': {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(95, t);
        osc.frequency.linearRampToValueAtTime(70, t + 0.5);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 23;
        const lg = ctx.createGain();
        lg.gain.value = 18;
        lfo.connect(lg).connect(osc.frequency);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 650;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc.connect(f).connect(g).connect(this.sfx);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.6);
        lfo.stop(t + 0.6);
        break;
      }
      default:
        // Glancing blow.
        this.tone({ freq: 900, freqEnd: 600, decay: 0.08, gain: 0.07 });
        this.burst({ type: 'highpass', freq: 1800, decay: 0.03, gain: 0.08 });
    }
  }

  pickup(): void {
    this.burst({ buffer: this.pink, type: 'bandpass', freq: 2100, q: 0.8, decay: 0.07, attack: 0.01, gain: 0.1 });
    this.tone({ freq: 880, freqEnd: 1320, decay: 0.08, gain: 0.03, when: (this.ctx?.currentTime ?? 0) + 0.03 });
  }

  craft(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i += 1) {
      this.burst({ type: 'bandpass', freq: 1200 + this.rand() * 1500, q: 2, decay: 0.05, gain: 0.12, when: this.ctx.currentTime + i * 0.09 });
      this.tone({ freq: 300 + this.rand() * 200, decay: 0.05, gain: 0.05, when: this.ctx.currentTime + i * 0.09 });
    }
  }

  eat(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i += 1) this.burst({ buffer: this.pink, type: 'bandpass', freq: 1800, q: 0.7, decay: 0.06, gain: 0.12, when: this.ctx.currentTime + 0.1 + i * 0.22 });
  }

  drink(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 2; i += 1) this.tone({ freq: 210, freqEnd: 120, decay: 0.12, attack: 0.02, gain: 0.12, when: this.ctx.currentTime + 0.1 + i * 0.35 });
  }

  hurt(amount: number): void {
    this.tone({ freq: 90, freqEnd: 40, decay: 0.25, gain: Math.min(0.5, 0.1 + amount / 40) });
    this.burst({ buffer: this.brown, type: 'lowpass', freq: 400, decay: 0.2, gain: 0.2 });
  }

  ui(kind: 'click' | 'open' | 'close' | 'error'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'click') this.tone({ freq: 1250, decay: 0.03, gain: 0.04 });
    else if (kind === 'open') {
      this.tone({ freq: 520, decay: 0.07, gain: 0.04 });
      this.tone({ freq: 780, decay: 0.09, gain: 0.04, when: t + 0.05 });
    } else if (kind === 'close') {
      this.tone({ freq: 780, decay: 0.06, gain: 0.035 });
      this.tone({ freq: 520, decay: 0.08, gain: 0.035, when: t + 0.05 });
    } else this.tone({ type: 'square', freq: 180, decay: 0.12, gain: 0.03 });
  }

  /** A struck tuning stone: pentatonic bell tones; wrong ones sound dull. */
  stoneTone(index: number, correct: boolean): void {
    if (!this.ctx) return;
    const notes = [62, 64, 66, 69, 71];
    const f = midiToHz(notes[index % notes.length]);
    if (correct) {
      this.tone({ freq: f, decay: 3.5, attack: 0.004, gain: 0.12, reverb: 0.9, fm: { ratio: 1.41, index: 1.8 } });
      this.tone({ freq: f * 2, decay: 2, attack: 0.004, gain: 0.04, reverb: 0.8 });
    } else {
      this.tone({ freq: f * 0.5, freqEnd: f * 0.45, decay: 0.4, gain: 0.12, fm: { ratio: 1.07, index: 3 } });
      this.burst({ buffer: this.brown, type: 'lowpass', freq: 500, decay: 0.3, gain: 0.2 });
    }
  }

  /** Gain and pan for a sound at a world position, from the last listener. */
  private spatial(x: number, y: number, z: number, range = 14): { g: number; pan: number } {
    const l = this.state?.listener;
    if (!l) return { g: 1, pan: 0 };
    const dx = x - l.x;
    const dy = y - l.y;
    const dz = z - l.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const fl = Math.hypot(l.fx, l.fz) || 1;
    const pan = Math.max(-0.85, Math.min(0.85, (dx * (-l.fz / fl) + dz * (l.fx / fl)) / d));
    return { g: 1 / (1 + d / range), pan };
  }

  /** The Wardens: roars, stomps, crashes and the tolling of a freed Bellstone. */
  warden(kind: 'roar' | 'stomp' | 'step' | 'charge' | 'crash' | 'roots' | 'rootsWarn' | 'crack' | 'calm', x: number, y: number, z: number, strength = 1): void {
    if (!this.ctx) return;
    const { g: near, pan } = this.spatial(x, y, z, kind === 'step' ? 10 : 22);
    const g = near * strength;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'roar':
      case 'charge': {
        const long = kind === 'roar' ? 1 : 0.7;
        // Two growling voices, a breath of noise and a chest rumble.
        this.tone({ type: 'sawtooth', freq: 82, freqEnd: 50, attack: 0.25, decay: 2.1 * long, gain: 0.2 * g, pan, reverb: 0.8, fm: { ratio: 0.5, index: 2.6 } });
        this.tone({ type: 'sawtooth', freq: 123, freqEnd: 74, attack: 0.3, decay: 1.7 * long, gain: 0.08 * g, pan, reverb: 0.8, detune: 14 });
        this.burst({ buffer: this.pink, type: 'bandpass', freq: 560, freqEnd: 240, q: 1.3, attack: 0.3, decay: 1.9 * long, gain: 0.5 * g, pan, reverb: 0.7 });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 240, attack: 0.2, decay: 2.2 * long, gain: 0.7 * g, pan });
        if (kind === 'charge') this.burst({ buffer: this.brown, type: 'lowpass', freq: 130, attack: 0.4, decay: 2.8, gain: 0.8 * g, pan, when: t + 0.3 });
        break;
      }
      case 'stomp':
        this.tone({ freq: 58, freqEnd: 26, attack: 0.004, decay: 1.0, gain: 0.7 * g, pan, reverb: 0.6 });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 380, freqEnd: 50, attack: 0.005, decay: 1.6, gain: 1.0 * g, pan, reverb: 0.5 });
        this.burst({ type: 'highpass', freq: 1400, decay: 0.2, gain: 0.18 * g, pan, when: t + 0.02 });
        for (let i = 0; i < 6; i += 1) this.burst({ buffer: this.pink, type: 'bandpass', freq: 900 + this.rand() * 1600, decay: 0.05, gain: 0.08 * g, pan: pan + (this.rand() - 0.5) * 0.4, when: t + 0.15 + this.rand() * 0.6 });
        break;
      case 'step':
        this.tone({ freq: 50, freqEnd: 30, attack: 0.004, decay: 0.35, gain: 0.3 * g, pan });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 200, decay: 0.45, gain: 0.45 * g, pan });
        break;
      case 'crash':
        for (let i = 0; i < 7; i += 1) this.burst({ type: 'highpass', freq: 1600 + this.rand() * 2400, decay: 0.04 + this.rand() * 0.12, gain: 0.3 * g, pan, when: t + i * 0.035 + this.rand() * 0.03 });
        this.tone({ freq: 64, freqEnd: 30, attack: 0.004, decay: 0.8, gain: 0.6 * g, pan, reverb: 0.5 });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 520, freqEnd: 70, attack: 0.01, decay: 1.8, gain: 0.9 * g, pan, reverb: 0.5 });
        break;
      case 'rootsWarn':
        // Creaking wood working its way up through the ground.
        this.tone({ type: 'sawtooth', freq: 120, freqEnd: 260, attack: 0.5, decay: 0.6, gain: 0.05 * g, pan, fm: { ratio: 1.5, index: 3 } });
        this.burst({ buffer: this.brown, type: 'lowpass', freq: 90, freqEnd: 260, attack: 0.9, decay: 0.3, gain: 0.5 * g, pan });
        break;
      case 'roots':
        for (let i = 0; i < 9; i += 1) this.burst({ type: 'highpass', freq: 1300 + this.rand() * 2600, decay: 0.03 + this.rand() * 0.08, gain: 0.22 * g, pan, when: t + this.rand() * 0.25 });
        this.tone({ freq: 90, freqEnd: 40, decay: 0.4, gain: 0.45 * g, pan });
        this.burst({ buffer: this.pink, type: 'bandpass', freq: 800, decay: 0.6, gain: 0.35 * g, pan, reverb: 0.3 });
        break;
      case 'crack':
        for (let i = 0; i < 5; i += 1) this.tone({ freq: 1800 + this.rand() * 3200, decay: 0.3 + this.rand() * 0.9, gain: 0.06 * g, pan, when: t + i * 0.03, reverb: 0.9, fm: { ratio: 1.41 + this.rand(), index: 1.2 } });
        this.burst({ type: 'highpass', freq: 3000, decay: 0.25, gain: 0.4 * g, pan });
        this.tone({ freq: 140, freqEnd: 60, decay: 0.3, gain: 0.4 * g, pan });
        break;
      case 'calm':
        this.bellToll(t + 0.4, 1);
        break;
    }
  }

  /** A Bellstone tolls: inharmonic bell partials and a choir chord under them. */
  bellToll(when = this.ctx?.currentTime ?? 0, strength = 1): void {
    if (!this.ctx) return;
    const f = midiToHz(43);
    const partials: [number, number, number][] = [
      [0.5, 0.2, 9],
      [1, 0.28, 8],
      [1.19, 0.1, 6],
      [2, 0.14, 6],
      [2.76, 0.1, 5],
      [5.4, 0.06, 3.5],
      [8.93, 0.035, 2.2],
    ];
    for (const [ratio, gain, decay] of partials) this.tone({ freq: f * ratio, decay, attack: 0.004, gain: gain * strength, when, bus: this.music, reverb: 1 });
    this.burst({ type: 'bandpass', freq: 2400, q: 2, decay: 0.2, gain: 0.08 * strength, when, bus: this.music });
    for (const n of [55, 62, 67, 71]) this.pad(midiToHz(n), when + 0.6, 9);
  }

  /** Rolling thunder `delay` seconds from now (closer = sharper crack). */
  thunder(delay: number, intensity: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const near = delay < 2.5;
    if (near) this.burst({ type: 'highpass', freq: 1800, decay: 0.25, gain: 0.35 * intensity, when: t, bus: this.amb, reverb: 0.6 });
    this.burst({ buffer: this.brown, type: 'lowpass', freq: near ? 420 : 220, freqEnd: 60, attack: near ? 0.05 : 0.6, decay: 4.5 + delay * 0.3, gain: (near ? 0.9 : 0.55) * intensity, when: t, bus: this.amb, reverb: 0.7 });
    this.burst({ buffer: this.brown, type: 'lowpass', freq: 160, attack: 1.2, decay: 3, gain: 0.35 * intensity, when: t + 1.4, bus: this.amb });
  }

  /** Bell-like arpeggio when a place is discovered. */
  stinger(major = true): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const root = 62;
    const steps = major ? [0, 7, 12, 16, 19] : [0, 7, 10, 15, 19];
    steps.forEach((s, i) =>
      this.tone({ freq: midiToHz(root + s), decay: 2.4, attack: 0.005, gain: 0.07, when: t + i * 0.13, bus: this.music, reverb: 0.8, fm: { ratio: 3.5, index: 1.3 } }),
    );
  }

  // ---------------------------------------------------------------------------
  // Per-frame ambience & music

  update(dt: number, s: AudioState): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.state = s;
    const t = ctx.currentTime;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(s.listener.x, t, 0.02);
      l.positionY.setTargetAtTime(s.listener.y, t, 0.02);
      l.positionZ.setTargetAtTime(s.listener.z, t, 0.02);
      l.forwardX.setTargetAtTime(s.listener.fx, t, 0.02);
      l.forwardY.setTargetAtTime(s.listener.fy, t, 0.02);
      l.forwardZ.setTargetAtTime(s.listener.fz, t, 0.02);
    }
    const day = s.hours > 5.4 && s.hours < 20.2;
    const dusk = (s.hours > 18.5 && s.hours < 21.5) || (s.hours > 4.5 && s.hours < 6.5);
    // Gusts breathe on a slow cycle.
    const gust = 0.55 + 0.45 * Math.sin(t * 0.21) * Math.sin(t * 0.077 + 1.3);
    const set = (name: string, gain: number, freq?: number) => {
      const loop = this.loops[name];
      loop.gain.gain.setTargetAtTime(gain, t, 0.6);
      if (freq) loop.filter.frequency.setTargetAtTime(freq, t, 0.8);
    };
    const under = s.underwater ? 0.25 : 1;
    set('wind', (0.05 + 0.3 * s.wind * gust) * under, 280 + 520 * s.wind * gust);
    set('leaves', 0.08 * s.forest * (0.3 + 0.7 * gust * s.wind) * under);
    set('surf', 0.2 * s.sea * under);
    set('river', 0.1 * s.river * under);
    set('river2', 0.06 * s.river * under, 2200 + 900 * Math.sin(t * 2.3) * Math.sin(t * 0.7));
    set('fire', 0.14 * s.fire);
    set('rain', 0.22 * s.rain);
    set('under', s.underwater ? 0.35 : 0);
    this.muffle.frequency.setTargetAtTime(s.underwater ? 650 : 20000, t, 0.12);

    // Breaking waves.
    if (s.sea > 0.05 && s.surfPeriod > 0 && t > this.nextWave) {
      this.nextWave = t + s.surfPeriod * (0.8 + this.rand() * 0.5);
      this.burst({ buffer: this.brown, type: 'lowpass', freq: 1800, freqEnd: 300, attack: 1.1, decay: 3.2, gain: 0.5 * s.sea * under, bus: this.amb, reverb: 0.25, pan: this.rand() * 0.6 - 0.3 });
      this.burst({ buffer: this.pink, type: 'highpass', freq: 3000, attack: 0.8, decay: 2.2, gain: 0.12 * s.sea * under, bus: this.amb, when: t + 0.9 });
    }

    // Birdsong by day in vegetated places.
    const birdy = (s.forest * 1.2 + s.meadow * 0.8) * (1 - s.snow * 0.8) * (1 - s.rain);
    if (day && birdy > 0.05 && t > this.nextBird) {
      this.nextBird = t + (2.5 + this.rand() * 7) / Math.max(0.2, birdy);
      this.bird(birdy);
    }
    // Crickets and frogs at dusk and night.
    if (!day || dusk) {
      if (s.meadow + s.forest * 0.5 > 0.1 && t > this.nextCricket && s.snow < 0.5) {
        this.nextCricket = t + 0.35 + this.rand() * 0.9;
        this.cricket(Math.min(1, s.meadow + s.forest * 0.5));
      }
      if (s.marsh > 0.1 && t > this.nextFrog) {
        this.nextFrog = t + 0.8 + this.rand() * 2.5;
        this.frog(s.marsh);
      }
    }
    // Campfire crackle.
    if (s.fire > 0.02 && t > this.nextCrackle) {
      this.nextCrackle = t + 0.05 + this.rand() * 0.35;
      this.burst({ type: 'highpass', freq: 2500 + this.rand() * 3000, decay: 0.01 + this.rand() * 0.03, gain: 0.25 * s.fire * this.rand(), bus: this.amb, pan: this.rand() * 0.4 - 0.2 });
    }
    // Heartbeat when badly hurt.
    if (s.lowHealth > 0.05 && t > this.nextHeart) {
      this.nextHeart = t + 0.95 - s.lowHealth * 0.3;
      this.tone({ freq: 62, freqEnd: 40, decay: 0.12, gain: 0.35 * s.lowHealth, bus: this.sfx });
      this.tone({ freq: 58, freqEnd: 38, decay: 0.12, gain: 0.25 * s.lowHealth, bus: this.sfx, when: t + 0.22 });
    }
    this.updateMusic(t, s);
    void dt;
  }

  private bird(level: number): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const species = Math.floor(this.rand() * 4);
    const pan = this.rand() * 1.6 - 0.8;
    const base = [2600, 3400, 4200, 1900][species] * (0.9 + this.rand() * 0.2);
    const notes = species === 3 ? 2 : 2 + Math.floor(this.rand() * 5);
    const gain = 0.03 * Math.min(1, level) * (0.5 + this.rand() * 0.5);
    for (let i = 0; i < notes; i += 1) {
      const when = t + i * (species === 1 ? 0.07 : 0.14) + this.rand() * 0.02;
      const f0 = base * (1 + (this.rand() - 0.5) * 0.25);
      const up = species === 0 || (species === 2 && i % 2 === 0);
      this.tone({ freq: f0, freqEnd: up ? f0 * 1.45 : f0 * 0.7, decay: species === 3 ? 0.35 : 0.06 + this.rand() * 0.05, attack: 0.008, gain, when, bus: this.amb, pan, reverb: 0.35 });
    }
  }

  private cricket(level: number): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const f = 4300 + this.rand() * 700;
    const pan = this.rand() * 1.4 - 0.7;
    for (let i = 0; i < 3; i += 1) this.tone({ freq: f, decay: 0.018, attack: 0.004, gain: 0.012 * level, when: t + i * 0.035, bus: this.amb, pan });
  }

  private frog(level: number): void {
    const ctx = this.ctx as AudioContext;
    const t = ctx.currentTime;
    const pan = this.rand() * 1.4 - 0.7;
    const f = 110 + this.rand() * 90;
    for (let i = 0; i < 2 + Math.floor(this.rand() * 3); i += 1) {
      this.tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.8, decay: 0.09, attack: 0.01, gain: 0.03 * level, when: t + i * 0.13, bus: this.amb, pan, reverb: 0.3 });
    }
  }

  // Generative score: sparse pieces separated by long silences.
  private updateMusic(t: number, s: AudioState): void {
    if (s.combat > 0.02) {
      // A fight takes over: end the current piece and drum.
      this.pieceEnd = Math.min(this.pieceEnd, t);
      this.nextPiece = Math.max(this.nextPiece, t + 25);
      this.updateCombatMusic(t, s);
      return;
    }
    this.nextBeat = 0;
    if (t > this.pieceEnd && t > this.nextPiece) {
      this.pieceEnd = t + 55 + this.rand() * 45;
      this.nextPiece = this.pieceEnd + 90 + this.rand() * 150;
      this.nextNote = t + 1;
      this.chordIndex = 0;
    }
    if (t > this.pieceEnd || t < this.nextNote) return;
    const scale = MODES[s.musicMode] ?? MODES.lydian;
    const night = s.hours < 5.5 || s.hours > 20.5;
    const root = s.musicRoot - (night ? 12 : 0);
    // Chord every ~8 s: degrees I, V, vi, IV-like walk through the mode.
    const walk = [0, 4, 5, 3, 0, 2, 5, 4];
    const degree = walk[this.chordIndex % walk.length];
    const chord = [0, 2, 4].map((k) => {
      const d = degree + k;
      return root + scale[d % 7] + 12 * Math.floor(d / 7);
    });
    this.chordIndex += 1;
    const len = 7.5 + this.rand() * 2;
    for (const n of chord) this.pad(midiToHz(n), t, len);
    // A few melody notes over the chord.
    const count = night ? 2 : 3 + Math.floor(this.rand() * 3);
    for (let i = 0; i < count; i += 1) {
      const d = degree + [0, 2, 4, 5, 7][Math.floor(this.rand() * 5)];
      const note = root + 12 + scale[d % 7] + 12 * Math.floor(d / 7);
      this.tone({ freq: midiToHz(note), decay: 2.2, attack: 0.004, gain: 0.05, when: t + 0.6 + i * (1.2 + this.rand() * 0.8), bus: this.music, reverb: 0.9, fm: { ratio: 2, index: 0.9 }, pan: this.rand() * 0.6 - 0.3 });
    }
    this.nextNote = t + len;
  }

  /** Taiko, frame drum and a low phrygian ostinato, scheduled just ahead. */
  private updateCombatMusic(t: number, s: AudioState): void {
    const bpm = 96 + s.combat * 10;
    const eighth = 60 / bpm / 2;
    if (this.nextBeat < t) {
      this.nextBeat = t + 0.05;
      this.beatIndex = 0;
    }
    const root = 38;
    const pattern = [0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 1, 0, 5, 3, 1, 0];
    const kicks = [1, 0, 0, 0.6, 0, 0, 0.7, 0, 1, 0, 0, 0.6, 0, 0, 0.8, 0.5];
    const g = Math.min(1, s.combat);
    while (this.nextBeat < t + 0.2) {
      const i = this.beatIndex % 16;
      const when = this.nextBeat;
      if (kicks[i] > 0) this.taiko(when, kicks[i] * g);
      if (i === 4 || i === 12) this.burst({ type: 'bandpass', freq: 1700, q: 2.2, decay: 0.09, gain: 0.07 * g, when, bus: this.music, reverb: 0.3 });
      this.tone({ type: 'triangle', freq: midiToHz(root + pattern[i]), decay: eighth * 0.95, attack: 0.006, gain: 0.1 * g, when, bus: this.music, fm: { ratio: 2, index: 0.6 } });
      if (i === 0 && this.beatIndex % 32 === 0) for (const n of [root + 12, root + 19, root + 24]) this.pad(midiToHz(n), when, eighth * 16);
      this.nextBeat += eighth;
      this.beatIndex += 1;
    }
  }

  private taiko(when: number, accent: number): void {
    this.tone({ freq: 72, freqEnd: 42, attack: 0.004, decay: 0.55, gain: 0.34 * accent, when, bus: this.music, reverb: 0.45 });
    this.burst({ buffer: this.brown, type: 'lowpass', freq: 420, freqEnd: 90, decay: 0.32, gain: 0.5 * accent, when, bus: this.music });
    this.burst({ type: 'bandpass', freq: 950, q: 0.8, decay: 0.05, gain: 0.06 * accent, when, bus: this.music });
  }

  private pad(freq: number, t: number, len: number): void {
    const ctx = this.ctx as AudioContext;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.018, t + len * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    f.connect(g);
    g.connect(this.music);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    g.connect(send).connect(this.reverbSend);
    for (const detune of [-7, 0, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }

  get debugState(): AudioState | null {
    return this.state;
  }
}
