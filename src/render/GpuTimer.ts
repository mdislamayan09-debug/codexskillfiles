// How long the frame takes on the graphics card, from the
// EXT_disjoint_timer_query_webgl2 extension (Chrome and Edge have it; where
// it is missing, `available` is false and everything reads 0). Results
// arrive a few frames late and are smoothed.
//
// Queries are not free: on Windows every one costs the main thread time, and
// checking for a disjoint event is a round trip to the GPU process. So in
// play one query spans a whole frame, every 7th frame (enough for dynamic
// resolution); `detailed` times each stage of every frame, for the frame-rate
// display and the profiling scripts.

// Seven, so the sampled frames fall on every phase of the shadow cascades' 2-,
// 4- and 8-frame cycles instead of always on the same light one.
const SAMPLE_EVERY = 7;

export class GpuTimer {
  readonly available: boolean;
  /** Smoothed milliseconds per stage (just `frame` unless detailed). */
  readonly ms: Record<string, number> = {};
  /** Time every stage of every frame (costs main-thread time). */
  detailed = false;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly spare: WebGLQuery[] = [];
  private readonly waiting: { stage: string; query: WebGLQuery }[] = [];
  private open: { stage: string; query: WebGLQuery } | null = null;
  /** Poll count when each stage last reported. */
  private readonly seen: Record<string, number> = {};
  private polls = 0;
  private frames = 0;
  /** The last raw (unsmoothed) results, [stage, ms], for diagnostics. */
  readonly recent: [string, number][] = [];
  private sampling = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.available = this.ext !== null;
  }

  /** Call first thing in a frame's GPU work: decides whether it is timed. */
  startFrame(): void {
    this.frames += 1;
    this.sampling = this.detailed || this.frames % SAMPLE_EVERY === 0;
    if (this.sampling && !this.detailed) this.open_('frame');
  }

  /** Close the frame's timing (call last). */
  finishFrame(): void {
    this.close();
    this.sampling = false;
  }

  /** Start timing `stage` (ending whichever stage was running); detailed mode only. */
  begin(stage: string): void {
    if (!this.detailed || !this.sampling) return;
    this.open_(stage);
  }

  /** End the running stage; detailed mode only (a sampled frame runs to `finishFrame`). */
  end(): void {
    if (this.detailed) this.close();
  }

  private open_(stage: string): void {
    if (!this.ext) return;
    this.close();
    // Too many unanswered queries means results are not coming back: stop
    // asking until they do.
    if (this.waiting.length > 48) return;
    const query = this.spare.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { stage, query };
  }

  private close(): void {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.waiting.push(this.open);
    this.open = null;
  }

  /** Collect finished results (call once a frame, outside any stage). */
  poll(): void {
    const ext = this.ext;
    if (!ext) return;
    const gl = this.gl;
    this.polls += 1;
    // A stage that has stopped running (god rays with the sun behind you)
    // drops out rather than holding its last value.
    const stale = this.detailed ? 60 : 60 * SAMPLE_EVERY;
    for (const stage of Object.keys(this.ms)) if (this.polls - (this.seen[stage] ?? 0) > stale) delete this.ms[stage];
    if (this.waiting.length === 0 || !gl.getQueryParameter(this.waiting[0].query, gl.QUERY_RESULT_AVAILABLE)) return;
    // A disjoint event (a power-state change, say) spoils what is in flight.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const w of this.waiting) this.spare.push(w.query);
      this.waiting.length = 0;
      return;
    }
    const k = this.detailed ? 0.1 : 0.35;
    while (this.waiting.length > 0) {
      const w = this.waiting[0];
      if (!gl.getQueryParameter(w.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const ms = (gl.getQueryParameter(w.query, gl.QUERY_RESULT) as number) / 1e6;
      this.recent.push([w.stage, ms]);
      if (this.recent.length > 512) this.recent.shift();
      const last = this.ms[w.stage];
      this.ms[w.stage] = last === undefined ? ms : last + (ms - last) * k;
      this.seen[w.stage] = this.polls;
      this.spare.push(w.query);
      this.waiting.shift();
    }
  }

  /**
   * Forget the smoothed times, so a measurement is not carried by what came
   * before (a view change's shader compiles and streaming take seconds).
   */
  reset(): void {
    for (const stage of Object.keys(this.ms)) delete this.ms[stage];
  }

  /** The frame's GPU time (the sum of the stages when detailed). */
  get total(): number {
    let t = 0;
    for (const [stage, v] of Object.entries(this.ms)) if (this.detailed ? stage !== 'frame' : stage === 'frame') t += v;
    return t;
  }
}
