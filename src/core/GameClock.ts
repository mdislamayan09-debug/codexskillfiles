/**
 * In-game time. One full day lasts `dayLengthMinutes` real minutes (default
 * 26: ~16 minutes of daylight, ~10 of night). Time can be scaled (sleeping)
 * or frozen (menus, cutscenes).
 */
export class GameClock {
  /** Hours in [0, 24). */
  hours = 7.25;
  day = 1;
  dayLengthMinutes = 26;
  scale = 1;
  frozen = false;

  /** Advances the clock; returns in-game hours elapsed. */
  update(realDt: number): number {
    if (this.frozen) return 0;
    const hoursPerSecond = 24 / (this.dayLengthMinutes * 60);
    const advance = realDt * hoursPerSecond * this.scale;
    this.hours += advance;
    while (this.hours >= 24) {
      this.hours -= 24;
      this.day += 1;
    }
    return advance;
  }

  /** Total in-game hours since day 1 00:00 (monotonic; used for timers). */
  get totalHours(): number {
    return (this.day - 1) * 24 + this.hours;
  }

  set(day: number, hours: number): void {
    this.day = Math.max(1, Math.floor(day));
    this.hours = ((hours % 24) + 24) % 24;
  }

  get isNight(): boolean {
    return this.hours < 5.3 || this.hours > 20.4;
  }

  /** 0 at midnight, 1 at noon, smooth. */
  get daylight(): number {
    return 0.5 - 0.5 * Math.cos(((this.hours - 0.5) / 24) * Math.PI * 2);
  }
}
