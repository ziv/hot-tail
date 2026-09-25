import { tuning } from './tuning';
import type { BonusTally, StageStats } from './types';

/**
 * Score, combo multiplier (D9), lives and extra-life thresholds. Kills within
 * the combo window chain the multiplier up to ×comboMax.
 */
export class ScoreKeeper {
  score = 0;
  lives: number;
  chain = 0;
  comboTimer = 0;
  nextExtraLife: number;
  stats: StageStats = emptyStats();

  constructor(lives = tuning.player.lives) {
    this.lives = lives;
    this.nextExtraLife = tuning.score.extraLifeFirst;
  }

  get multiplier(): number {
    return Math.min(tuning.score.comboMax, 1 + this.chain);
  }

  /** Registers a kill and returns the points awarded. */
  kill(base: number): { points: number; multiplier: number } {
    if (this.comboTimer > 0) this.chain++;
    else this.chain = 0;
    const multiplier = this.multiplier;
    this.comboTimer = tuning.score.comboWindow;
    const points = base * multiplier;
    return { points, multiplier };
  }

  /** Adds points; returns the number of extra lives earned. */
  add(points: number): number {
    this.score += points;
    let earned = 0;
    while (this.score >= this.nextExtraLife) {
      earned++;
      this.lives++;
      this.nextExtraLife += tuning.score.extraLifeEvery;
    }
    return earned;
  }

  update(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.chain = 0;
      }
    }
  }

  resetStage(): void {
    this.stats = emptyStats();
  }

  stageBonus(): BonusTally {
    const s = this.stats;
    const hitRate = s.shotsFired > 0 ? Math.min(1, s.shotsHit / s.shotsFired) : 0;
    const killRate = s.spawned > 0 ? Math.min(1, s.kills / s.spawned) : 0;
    const noDamage = s.damageTaken === 0;
    const hitRateBonus = Math.round(hitRate * 100) * 1000;
    const killBonus = Math.round(killRate * 100) * 1000;
    const damageBonus = noDamage ? 150000 : Math.max(0, 100000 - s.damageTaken * 20000);
    return {
      hitRate,
      hitRateBonus,
      killRate,
      killBonus,
      noDamage,
      damageBonus,
      total: hitRateBonus + killBonus + damageBonus,
    };
  }
}

export function emptyStats(): StageStats {
  return { shotsFired: 0, shotsHit: 0, missilesFired: 0, kills: 0, spawned: 0, damageTaken: 0, deaths: 0 };
}
