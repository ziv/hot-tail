import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';
import { EventBus } from '@/core/events';
import { Pool, World } from '@/core/ecs';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});

describe('EventBus', () => {
  it('delivers and unsubscribes', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: number[] = [];
    const off = bus.on('ping', (n) => got.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual([1]);
  });
});

describe('World', () => {
  interface E {
    id: number;
    alive: boolean;
    tag: string;
  }

  it('maintains queries across add/remove/flush', () => {
    const w = new World<E>();
    const as = w.query((e) => e.tag === 'a');
    const a1 = w.add({ id: 0, alive: false, tag: 'a' });
    w.add({ id: 0, alive: false, tag: 'b' });
    const a2 = w.add({ id: 0, alive: false, tag: 'a' });
    expect(as.size).toBe(2);
    w.remove(a1);
    expect(a1.alive).toBe(false);
    expect(as.size).toBe(2); // deferred until flush
    const removed: E[] = [];
    w.flush((e) => removed.push(e));
    expect(as.items).toEqual([a2]);
    expect(removed).toEqual([a1]);
    expect(w.entities.length).toBe(2);
  });

  it('assigns fresh ids when a pooled object is re-added', () => {
    const w = new World<E>();
    const pool = new Pool<E>();
    const e = w.add(pool.acquire('a', () => ({ id: 0, alive: false, tag: 'a' })));
    const firstId = e.id;
    w.remove(e);
    w.flush((x) => pool.release('a', x));
    const again = w.add(pool.acquire('a', () => ({ id: 0, alive: false, tag: 'a' })));
    expect(again).toBe(e);
    expect(again.id).not.toBe(firstId);
  });
});
