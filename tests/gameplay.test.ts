import { describe, expect, it } from 'vitest';
import { Sim } from '@/sim/sim';
import { STAGES } from '@/sim/stages';
import { ScoreKeeper } from '@/sim/score';
import { Rail } from '@/sim/rail';
import { spawnEnemy } from '@/sim/enemies';
import { Btn, EMPTY_INPUT, type InputFrame } from '@/sim/types';
import { tuning } from '@/sim/tuning';
import { ReplayPlayer, ReplayRecorder } from '@/sim/replay';
import { botInput } from '@/sim/bot';
import { runStage } from './harness';

function emptyStage(sim: Sim): void {
  sim.loadStage({ ...STAGES[0], events: [], duration: 999 });
}

describe('ScoreKeeper', () => {
  it('chains the multiplier within the combo window and caps it', () => {
    const s = new ScoreKeeper(3);
    expect(s.kill(100).multiplier).toBe(1);
    expect(s.kill(100).multiplier).toBe(2);
    s.update(tuning.score.comboWindow + 0.1);
    expect(s.kill(100).multiplier).toBe(1);
    for (let i = 0; i < 20; i++) s.kill(100);
    expect(s.multiplier).toBe(tuning.score.comboMax);
  });

  it('awards extra lives at thresholds', () => {
    const s = new ScoreKeeper(3);
    expect(s.add(tuning.score.extraLifeFirst)).toBe(1);
    expect(s.lives).toBe(4);
    expect(s.add(tuning.score.extraLifeEvery - 1)).toBe(0);
    expect(s.add(1)).toBe(1);
  });
});

describe('Rail', () => {
  it('passes through its control points and clamps at the ends', () => {
    const r = new Rail([
      [0, 0, 100],
      [1000, 50, 150],
      [2000, 0, 120],
    ]);
    const o = { x: 0, y: 0 };
    expect(r.sample(1000, o)).toEqual({ x: 50, y: 150 });
    expect(r.sample(-10, o)).toEqual({ x: 0, y: 100 });
    expect(r.sample(99999, o)).toEqual({ x: 0, y: 120 });
    r.sample(500, o);
    expect(o.x).toBeGreaterThan(0);
    expect(o.x).toBeLessThan(50);
  });
});

describe('Player flight', () => {
  it('stays inside the envelope under full deflection', () => {
    const sim = new Sim(1);
    emptyStage(sim);
    for (let i = 0; i < 300; i++) sim.step({ x: 1, y: -1, buttons: 0 });
    const p = sim.player.e.pos;
    expect(p.x).toBeCloseTo(tuning.flight.envelopeX);
    expect(p.y).toBeCloseTo(-tuning.flight.envelopeY);
  });

  it('afterburner and air-brake change forward speed', () => {
    const sim = new Sim(1);
    emptyStage(sim);
    for (let i = 0; i < 180; i++) sim.step({ x: 0, y: 0, buttons: Btn.Boost });
    expect(sim.speed).toBeGreaterThan(sim.cruiseSpeed * 1.5);
    for (let i = 0; i < 240; i++) sim.step({ x: 0, y: 0, buttons: Btn.Brake });
    expect(sim.speed).toBeLessThan(sim.cruiseSpeed * 0.65);
  });

  it('rolls on a double flick and grants brief immunity', () => {
    const sim = new Sim(1);
    emptyStage(sim);
    const rolls: number[] = [];
    sim.events.on('roll', (e) => rolls.push(e.dir));
    const seq = [1, 1, 1, 0, 0, 1, 1];
    for (const x of seq) sim.step({ x, y: 0, buttons: 0 });
    expect(rolls).toEqual([1]);
    expect(sim.player.rollTime).toBeGreaterThanOrEqual(0);
  });

  it('does not roll on ordinary held steering', () => {
    const sim = new Sim(1);
    emptyStage(sim);
    const rolls: number[] = [];
    sim.events.on('roll', (e) => rolls.push(e.dir));
    for (let i = 0; i < 60; i++) sim.step({ x: 1, y: 0, buttons: 0 });
    for (let i = 0; i < 60; i++) sim.step({ x: -1, y: 0, buttons: 0 });
    expect(rolls).toEqual([]);
  });
});

describe('Weapons', () => {
  it('vulcan fires at the configured rate and kills a drone ahead', () => {
    const sim = new Sim(1);
    emptyStage(sim);
    const drone = spawnEnemy(sim, {
      enemy: 'drone',
      behaviour: 'formation',
      from: 'front',
      x: 0,
      y: 0,
      z: -900,
      params: { ampX: 0, ampY: 0 },
    });
    let kills = 0;
    sim.events.on('kill', () => kills++);
    for (let i = 0; i < 60; i++) sim.step({ x: 0, y: 0, buttons: Btn.Fire });
    expect(sim.score.stats.shotsFired).toBeGreaterThanOrEqual(19);
    expect(sim.score.stats.shotsFired).toBeLessThanOrEqual(21);
    expect(kills).toBe(1);
    expect(drone.alive).toBe(false);
  });

  it('locks multiple targets and the missile volley destroys them', () => {
    const sim = new Sim(3);
    emptyStage(sim);
    const targets = [-60, 0, 60].map((x) =>
      spawnEnemy(sim, {
        enemy: 'fighter',
        behaviour: 'formation',
        from: 'front',
        x,
        y: 10,
        z: -1500,
        params: { ampX: 30, ampY: 10, speed: 0.4 },
      }),
    );
    for (const t of targets) t.enemy!.def = { ...t.enemy!.def, fire: [] };
    const locks: number[] = [];
    sim.events.on('lockOn', (e) => locks.push(e.count));
    // Sweep the reticle across all three while holding lock.
    for (let i = 0; i < 90; i++) sim.step({ x: Math.sin(i / 10), y: 0, buttons: Btn.Lock });
    expect(locks.length).toBe(3);
    for (let i = 0; i < 240; i++) sim.step(EMPTY_INPUT);
    expect(targets.every((t) => !t.alive)).toBe(true);
    expect(sim.player.missiles).toBe(tuning.missile.ammo - 3);
  });

  it('enemy missiles lose track after a barrel roll dodge', () => {
    const sim = new Sim(5);
    emptyStage(sim);
    sim.cheats.invincible = false;
    const hits: number[] = [];
    sim.events.on('playerHit', (e) => hits.push(e.damage));
    // Fire an enemy missile from close range straight at the player, then roll.
    const chaser = spawnEnemy(sim, {
      enemy: 'drone',
      behaviour: 'formation',
      from: 'front',
      x: 0,
      y: 0,
      z: -600,
      params: {},
    });
    chaser.enemy!.def = { ...chaser.enemy!.def, fire: [{ pattern: 'homing', interval: 100, delay: 0 }] };
    chaser.enemy!.guns = [{ timer: 0, burstLeft: 0, burstTimer: 0 }];
    chaser.pos.z = -700;
    let rolled = false;
    for (let i = 0; i < 240; i++) {
      const close = sim.missiles.items.some((m) => m.alive && m.kind === 'emissile' && m.pos.z > -130);
      const input: InputFrame = { x: 0, y: 0, buttons: close && !rolled ? Btn.Roll : 0 };
      if (close) rolled = true;
      sim.step(input);
    }
    expect(rolled).toBe(true);
    expect(hits).toEqual([]);
  });
});

describe('Stage director', () => {
  it('spawns scripted waves and clears the stage with a bonus', () => {
    const sim = new Sim(11);
    sim.cheats.invincible = true;
    let cleared = false;
    sim.events.on('stageClear', () => (cleared = true));
    sim.loadStage(STAGES[0]);
    const input: InputFrame = { x: 0, y: 0, buttons: 0 };
    for (let i = 0; i < 60 * 90 && !cleared; i++) sim.step(botInput(sim, input));
    expect(sim.score.stats.spawned).toBeGreaterThan(50);
    expect(sim.score.stats.kills).toBeLessThanOrEqual(sim.score.stats.spawned);
    expect(sim.score.stats.kills).toBeGreaterThan(10);
    expect(cleared).toBe(true);
    expect(sim.state).toBe('cleared');
  });

  it('boss stage: fortress phases advance and the stage clears', () => {
    const sim = new Sim(21);
    sim.cheats.invincible = true;
    sim.cheats.infiniteMissiles = true;
    const phases: number[] = [];
    let defeated = false;
    sim.events.on('bossPhase', (e) => phases.push(e.phase));
    sim.events.on('bossDefeated', () => (defeated = true));
    sim.loadStage(STAGES[5]);
    sim.director!.jumpTo(sim, 41);
    const input: InputFrame = { x: 0, y: 0, buttons: 0 };
    for (let i = 0; i < 60 * 150 && sim.state === 'playing'; i++) sim.step(botInput(sim, input));
    expect(phases).toEqual([2, 3]);
    expect(defeated).toBe(true);
    expect(sim.state).toBe('cleared');
  });

  it('game over after all lives are lost', () => {
    const sim = runStage(1, 3, 60 * 20, (_s, out) => {
      out.x = 0;
      out.y = 0;
      out.buttons = 0;
      return out;
    });
    const over = (): boolean => sim.state === 'gameover';
    let guard = 0;
    while (!over() && guard++ < 20) {
      // Ram a drone into the player until every life is gone.
      sim.player.invuln = 0;
      const e = spawnEnemy(sim, {
        enemy: 'drone',
        behaviour: 'formation',
        from: 'front',
        x: 0,
        y: 0,
        z: -40,
        params: { ampX: 0, ampY: 0 },
      });
      e.pos.copy(sim.player.e.pos).z -= 5;
      for (let i = 0; i < 200 && !over(); i++) sim.step(EMPTY_INPUT);
    }
    expect(over()).toBe(true);
    expect(sim.score.lives).toBe(0);
  });
});

describe('Determinism (Q3)', () => {
  it('same seed + same inputs gives identical state', () => {
    const a = runStage(1, 1234, 60 * 40);
    const b = runStage(1, 1234, 60 * 40);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.score.score).toBeGreaterThan(0);
  });

  it('different seeds diverge', () => {
    const a = runStage(0, 1, 60 * 20);
    const b = runStage(0, 2, 60 * 20);
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('a recorded replay reproduces the run exactly', () => {
    const rec = new ReplayRecorder(99, 1);
    const live = runStage(1, 99, 60 * 30, (sim, out) => {
      botInput(sim, out);
      rec.record(out);
      return out;
    });
    const player = new ReplayPlayer(rec.finish());
    const replayed = runStage(1, 99, 60 * 30, (_sim, out) => player.next(out));
    expect(replayed.stateHash()).toBe(live.stateHash());
  });
});
