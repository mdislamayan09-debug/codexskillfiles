// How long each stage of the frame takes on the graphics card, from the
// EXT_disjoint_timer_query_webgl2 extension (Chrome and Edge have it; where
// it is missing, `available` is false and every stage reads 0). Stages are
// timed one after another, never nested. Results arrive a few frames late
// and are smoothed, so they read steadily in the frame-rate display.

export class GpuTimer {
  readonly available: boolean;
  /** Smoothed milliseconds per stage, in the order the stages last ran. */
  readonly ms: Record<string, number> = {};
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly spare: WebGLQuery[] = [];
  private readonly waiting: { stage: string; query: WebGLQuery }[] = [];
  private open: { stage: string; query: WebGLQuery } | null = null;
  /** Poll count when each stage last reported. */
  private readonly seen: Record<string, number> = {};
  private polls = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    this.available = this.ext !== null;
  }

  /** Start timing `stage` (ending whichever stage was running). */
  begin(stage: string): void {
    if (!this.ext) return;
    this.end();
    // Too many unanswered queries means results are not coming back: stop
    // asking until they do.
    if (this.waiting.length > 48) return;
    const query = this.spare.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.open = { stage, query };
  }

  end(): void {
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
    for (const stage of Object.keys(this.ms)) if (this.polls - (this.seen[stage] ?? 0) > 60) delete this.ms[stage];
    // A disjoint event (a power-state change, say) spoils what is in flight.
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const w of this.waiting) this.spare.push(w.query);
      this.waiting.length = 0;
      return;
    }
    while (this.waiting.length > 0) {
      const w = this.waiting[0];
      if (!gl.getQueryParameter(w.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const ms = (gl.getQueryParameter(w.query, gl.QUERY_RESULT) as number) / 1e6;
      const last = this.ms[w.stage];
      this.ms[w.stage] = last === undefined ? ms : last + (ms - last) * 0.1;
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

  /** Sum of the stages: the frame's GPU time. */
  get total(): number {
    let t = 0;
    for (const v of Object.values(this.ms)) t += v;
    return t;
  }
}
