import { clamp, damp } from '../core/math';
import type { EventBus } from '../core/Events';
import type { Difficulty } from '../core/Settings';
import type { StaminaBudget } from '../player/PlayerController';

// Health, stamina, food, water, body temperature and wetness. Pressure is
// real but never instantly lethal: every penalty arrives slowly, is shown
// early, and has an obvious fix (eat, drink, warm up, dry off).

export interface Climate {
  /** Felt air temperature at the player (°C) before wetness and heat sources. */
  airTemperature: number;
  /** Rain/snow falling on the player (0..1), already 0 when sheltered. */
  precipitation: number;
  /** Warmth from fires and hot springs (°C added to felt temperature). */
  heat: number;
  inWater: boolean;
  waterTemperature: number;
  sheltered: boolean;
  resting: boolean;
}

export interface SurvivalSnapshot {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  food: number;
  water: number;
  bodyTemp: number;
  feltTemp: number;
  wetness: number;
  exhausted: boolean;
  flags: string[];
}

const DIFFICULTY_RATE: Record<Difficulty, number> = { explorer: 0.6, survivor: 1, harsh: 1.3 };
const DIFFICULTY_DAMAGE: Record<Difficulty, number> = { explorer: 0.5, survivor: 1, harsh: 1.4 };

export class Survival implements StaminaBudget {
  health = 100;
  maxHealth = 100;
  stamina = 100;
  baseMaxStamina = 100;
  food = 82;
  water = 76;
  bodyTemp = 37;
  feltTemp = 17;
  wetness = 0;
  exhausted = false;
  godMode = false;
  difficulty: Difficulty = 'survivor';
  /** Seconds of regeneration pause after using stamina. */
  private regenDelay = 0;
  private damageCooldown = 0;
  private dead = false;

  constructor(private readonly events: EventBus) {}

  get maxStamina(): number {
    let max = this.baseMaxStamina;
    if (this.food < 20) max -= 25;
    if (this.bodyTemp < 35.5) max -= 20;
    return Math.max(30, max);
  }

  get alive(): boolean {
    return !this.dead;
  }

  // StaminaBudget -----------------------------------------------------------
  spend(amount: number): boolean {
    if (this.godMode) return true;
    if (this.stamina < amount * 0.5) return false;
    this.stamina = Math.max(0, this.stamina - amount);
    this.regenDelay = 0.9;
    if (this.stamina <= 0) this.exhausted = true;
    return true;
  }

  drain(amount: number): boolean {
    if (this.godMode) return true;
    if (this.stamina <= 0) {
      this.exhausted = true;
      return false;
    }
    this.stamina = Math.max(0, this.stamina - amount);
    this.regenDelay = 0.7;
    if (this.stamina <= 0) this.exhausted = true;
    return true;
  }

  hold(): void {
    this.regenDelay = Math.max(this.regenDelay, 0.4);
  }

  // Changes -------------------------------------------------------------------
  damage(amount: number, source: string): void {
    if (this.dead || this.godMode || amount <= 0) return;
    const scaled = amount * DIFFICULTY_DAMAGE[this.difficulty];
    this.health = Math.max(0, this.health - scaled);
    this.events.emit('damage', { amount: scaled, source });
    if (this.health <= 0) {
      this.dead = true;
      this.events.emit('died', { cause: source });
    }
  }

  heal(amount: number): void {
    if (this.dead) return;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    if (this.health > before) this.events.emit('healed', { amount: this.health - before });
  }

  eat(food: number, water = 0): void {
    this.food = clamp(this.food + food, 0, 100);
    this.water = clamp(this.water + water, 0, 100);
  }

  drink(amount: number): void {
    this.water = clamp(this.water + amount, 0, 100);
  }

  revive(): void {
    this.dead = false;
    this.health = this.maxHealth * 0.6;
    this.stamina = this.maxStamina;
    this.food = Math.max(this.food, 45);
    this.water = Math.max(this.water, 45);
    this.bodyTemp = 37;
    this.wetness = 0;
    this.exhausted = false;
  }

  update(dt: number, climate: Climate): void {
    if (this.dead) return;
    const rate = DIFFICULTY_RATE[this.difficulty];

    // Wetness: soaked instantly in water, slowly in rain, dries near warmth.
    if (climate.inWater) this.wetness = 1;
    else if (climate.precipitation > 0) this.wetness = Math.min(1, this.wetness + climate.precipitation * 0.02 * dt);
    else {
      const dry = 0.006 + Math.max(0, climate.airTemperature - 10) * 0.0006 + climate.heat * 0.0025;
      this.wetness = Math.max(0, this.wetness - dry * dt);
    }

    // Felt temperature → body temperature drift.
    const air = climate.inWater ? climate.waterTemperature : climate.airTemperature;
    this.feltTemp = air - this.wetness * 9 + climate.heat + (climate.sheltered ? 4 : 0);
    let target = 37;
    if (this.feltTemp < 10) target = 37 - (10 - this.feltTemp) * 0.24;
    else if (this.feltTemp > 29) target = 37 + (this.feltTemp - 29) * 0.13;
    this.bodyTemp = damp(this.bodyTemp, clamp(target, 30, 41.5), 0.018, dt);

    // Food and water.
    const hot = this.bodyTemp > 38.3 ? 2 : 1;
    this.food = Math.max(0, this.food - (100 / 2700) * rate * dt * (this.stamina < this.maxStamina ? 1.15 : 1));
    this.water = Math.max(0, this.water - (100 / 2100) * rate * hot * dt);

    // Stamina regeneration.
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else {
      let regen = 24;
      if (this.water < 25) regen *= 0.5;
      if (this.bodyTemp < 35.5) regen *= 0.7;
      if (this.food > 70 && this.water > 50) regen *= 1.15;
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    }
    if (this.stamina > this.maxStamina) this.stamina = this.maxStamina;
    if (this.exhausted && this.stamina > this.maxStamina * 0.3) this.exhausted = false;

    // Health regeneration when fed and hydrated; faster when resting warm.
    if (this.food > 25 && this.water > 25 && this.bodyTemp > 35 && this.bodyTemp < 38.8) {
      let regen = 0.3;
      if (climate.resting || climate.heat > 4 || climate.sheltered) regen *= 3;
      this.heal(regen * dt);
    }

    // Slow damage from neglect — never sudden.
    this.damageCooldown -= dt;
    if (this.damageCooldown <= 0) {
      this.damageCooldown = 1;
      if (this.food <= 0) this.damage(0.25, 'starvation');
      if (this.water <= 0) this.damage(0.35, 'dehydration');
      if (this.bodyTemp < 34) this.damage(0.7 * (34 - this.bodyTemp + 0.5), 'cold');
      if (this.bodyTemp > 39.6) this.damage(0.5, 'heat');
    }
  }

  snapshot(): SurvivalSnapshot {
    const flags: string[] = [];
    if (this.food < 20) flags.push(this.food <= 0 ? 'starving' : 'hungry');
    if (this.water < 25) flags.push(this.water <= 0 ? 'parched' : 'thirsty');
    if (this.bodyTemp < 35.5) flags.push(this.bodyTemp < 34 ? 'freezing' : 'cold');
    if (this.bodyTemp > 38.3) flags.push(this.bodyTemp > 39.6 ? 'overheating' : 'hot');
    if (this.wetness > 0.35) flags.push('wet');
    if (this.exhausted) flags.push('exhausted');
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      stamina: this.stamina,
      maxStamina: this.maxStamina,
      food: this.food,
      water: this.water,
      bodyTemp: this.bodyTemp,
      feltTemp: this.feltTemp,
      wetness: this.wetness,
      exhausted: this.exhausted,
      flags,
    };
  }
}
