import { describe, expect, it } from 'vitest';
import { Sim, type SimOptions } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { spawnEnemy } from '@/sim/enemies';
import { botInput } from '@/sim/bot';
import { tuning } from '@/sim/tuning';
import { Btn, EMPTY_INPUT, type InputFrame } from '@/sim/types';
import type { StageDef } from '@/sim/defs';

function quiet(sim: Sim, stage: StageDef = STAGES[0]): void {
  sim.loadStage({ ...stage, events: [], duration: 999 });
}

function runBot(sim: Sim, seconds: number, until?: () => boolean): void {
  const input: InputFrame = { x: 0, y: 0, buttons: 0 };
  for (let i = 0; i < seconds * 60; i++) {
    if (until?.()) return;
    sim.step(botInput(sim, input));
  }
}

describe('Surface targets (D10)', () => {
  it('ignore the vulcan but die to missiles', () => {
    const sim = new Sim(1);
    quiet(sim);
    const sam = spawnEnemy(sim, {
      enemy: 'sam',
      behaviour: 'ground',
      from: 'front',
      x: 0,
      y: 0,
      z: -900,
      params: {},
    });
    sam.enemy!.guns = [];
    expect(sam.layer).toBe('surface');
    expect(sam.pos.y).toBeLessThan(-80); // on the ground, below the jet
    // Aim down at it with guns only.
    for (let i = 0; i < 60; i++) sim.step({ x: 0, y: -1, buttons: Btn.Fire });
    expect(sam.alive).toBe(true);
    expect(sam.hp).toBe(sam.maxHp);
    // Lock and fire a missile.
    let locked = false;
    sim.events.on('lockOn', () => (locked = true));
    for (let i = 0; i < 40 && !locked; i++) sim.step({ x: 0, y: -1, buttons: Btn.Lock });
    expect(locked).toBe(true);
    for (let i = 0; i < 180 && sam.alive; i++) sim.step({ x: 0, y: 0, buttons: 0 });
    expect(sam.alive).toBe(false);
  });
});

describe('Flares (D7)', () => {
  it('decoy tracking missiles and are limited per life', () => {
    const sim = new Sim(2);
    quiet(sim);
    const shooter = spawnEnemy(sim, {
      enemy: 'drone',
      behaviour: 'formation',
      from: 'front',
      x: 0,
      y: 0,
      z: -1200,
      params: { ampX: 0, ampY: 0, speed: 0.2 },
    });
    shooter.enemy!.def = { ...shooter.enemy!.def, fire: [{ pattern: 'homing', interval: 100, delay: 0 }] };
    shooter.enemy!.guns = [{ timer: 0, burstLeft: 0, burstTimer: 0 }];
    for (let i = 0; i < 30; i++) sim.step(EMPTY_INPUT);
    expect(sim.threats).toBe(1);
    let decoyed = -1;
    sim.events.on('flare', (e) => (decoyed = e.decoyed));
    sim.step({ x: 0, y: 0, buttons: Btn.Flare });
    expect(decoyed).toBe(1);
    sim.step(EMPTY_INPUT);
    expect(sim.threats).toBe(0);
    const hits: number[] = [];
    sim.events.on('playerHit', (e) => hits.push(e.damage));
    for (let i = 0; i < 240; i++) sim.step(EMPTY_INPUT);
    expect(hits).toEqual([]);
    // Two more flares, then empty.
    for (let k = 0; k < 3; k++) {
      sim.step({ x: 0, y: 0, buttons: Btn.Flare });
      sim.step(EMPTY_INPUT);
    }
    expect(sim.player.flares).toBe(0);
  });
});

describe('Difficulty', () => {
  function shotsFired(opts: Partial<SimOptions>): number {
    const sim = new Sim(5, opts);
    sim.cheats.invincible = true;
    sim.loadStage(STAGES[1]);
    let shots = 0;
    sim.events.on('enemyFire', () => shots++);
    for (let i = 0; i < 60 * 40; i++) sim.step(EMPTY_INPUT);
    return shots;
  }

  it('hard fires more than easy (HP unchanged)', () => {
    const easy = shotsFired({ difficulty: 'easy' });
    const hard = shotsFired({ difficulty: 'hard' });
    expect(hard).toBeGreaterThan(easy * 1.3);
  });
});

describe('Jets (C7)', () => {
  it('apply speed, lock count and armour', () => {
    const dart = new Sim(1, { jet: 'dart' });
    const manta = new Sim(1, { jet: 'manta' });
    quiet(dart);
    quiet(manta);
    expect(dart.cruiseSpeed).toBeGreaterThan(manta.cruiseSpeed);
    expect(dart.player.maxArmor).toBe(3);
    expect(manta.player.maxArmor).toBe(5);
    // Manta can hold 8 locks.
    for (let i = 0; i < 8; i++)
      spawnEnemy(manta, {
        enemy: 'bomber',
        behaviour: 'formation',
        from: 'front',
        x: (i - 3.5) * 40,
        y: 0,
        z: -1400,
        params: { ampX: 0, ampY: 0, speed: 0 },
      }).enemy!.guns = [];
    for (let i = 0; i < 120; i++) manta.step({ x: Math.sin(i / 12), y: 0, buttons: Btn.Lock });
    expect(manta.player.locks.length).toBe(8);
  });
});

describe('Assists (C9)', () => {
  it('auto-fire shoots only when a target is under the reticle', () => {
    const sim = new Sim(1, { autoFire: true });
    quiet(sim);
    for (let i = 0; i < 30; i++) sim.step(EMPTY_INPUT);
    expect(sim.score.stats.shotsFired).toBe(0);
    spawnEnemy(sim, {
      enemy: 'drone',
      behaviour: 'formation',
      from: 'front',
      x: 0,
      y: 0,
      z: -1200,
      params: { ampX: 0, ampY: 0, speed: 0.1 },
    });
    for (let i = 0; i < 30; i++) sim.step(EMPTY_INPUT);
    expect(sim.score.stats.shotsFired).toBeGreaterThan(5);
  });
});

describe('Loop manoeuvre (C5)', () => {
  it('makes the player immune and shakes chasers to the front', () => {
    const sim = new Sim(1);
    quiet(sim);
    const chaser = spawnEnemy(sim, {
      enemy: 'chaser',
      behaviour: 'pursuit',
      from: 'behind',
      x: 0,
      y: 0,
      z: 300,
      params: { holdTime: 99 },
    });
    for (let i = 0; i < 120; i++) sim.step(EMPTY_INPUT);
    expect(chaser.pos.z).toBeGreaterThan(0);
    sim.startLoop();
    expect(chaser.pos.z).toBeLessThan(-200);
    sim.step(EMPTY_INPUT);
    expect(sim.player.loopTime).toBeGreaterThan(0);
    expect(sim.player.loopAngle).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 3; i++) sim.step(EMPTY_INPUT);
    expect(sim.player.loopTime).toBe(-1);
  });
});

describe('Refuel (F15)', () => {
  it('restocks missiles and awards the bonus', () => {
    const sim = new Sim(1);
    quiet(sim);
    sim.player.missiles = 12;
    let bonus = 0;
    sim.events.on('refuelDone', (e) => (bonus = e.bonus));
    sim.startRefuel();
    expect(sim.state).toBe('refuel');
    for (let i = 0; i < 60 * 12 && sim.state === 'refuel'; i++) sim.step({ x: 1, y: 1, buttons: Btn.Fire });
    expect(bonus).toBe(50000);
    expect(sim.player.missiles).toBe(tuning.missile.ammo);
    expect(sim.score.stats.shotsFired).toBe(0); // guns locked during refuel
  });
});

describe('Content', () => {
  it.each(STAGES.map((s, i) => [s.name, i] as const))(
    'stage %s runs to completion under the autopilot',
    (_n, i) => {
      const sim = new Sim(100 + i);
      sim.cheats.invincible = true;
      sim.cheats.infiniteMissiles = true;
      let cleared = false;
      sim.events.on('stageClear', () => (cleared = true));
      sim.loadStage(STAGES[i]);
      runBot(sim, 200, () => cleared);
      expect(cleared).toBe(true);
      expect(sim.score.stats.kills).toBeLessThanOrEqual(sim.score.stats.spawned);
    },
  );

  it.each([
    ['Boss 2 carrier group', 11, 23],
    ['Boss 3 stealth ace', 15, 33],
    ['Boss 4 orbital platform', 17, 30],
  ])('%s advances through all phases', (_n, stage, t) => {
    const sim = new Sim(7);
    sim.cheats.invincible = true;
    sim.cheats.infiniteMissiles = true;
    const phases: number[] = [];
    sim.events.on('bossPhase', (e) => phases.push(e.phase));
    sim.loadStage(STAGES[stage]);
    sim.director!.jumpTo(sim, t);
    runBot(sim, 300, () => sim.state !== 'playing');
    expect(phases).toEqual([2, 3]);
    expect(sim.state).toBe('cleared');
  });

  it('seeded variants and mirroring stay deterministic', () => {
    const run = (seed: number) => {
      const sim = new Sim(seed);
      sim.loadStage(STAGES[3]);
      runBot(sim, 30);
      return sim.stateHash();
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });
});
