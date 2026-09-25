/**
 * Minimal ECS (B2) in the miniplex style: entities are plain objects whose
 * optional fields are components; systems iterate cached queries. Queries are
 * evaluated when an entity is added, so components are fixed for the lifetime
 * of a spawned entity (pooled objects are re-added after being reset).
 */
export interface BaseEntity {
  id: number;
  alive: boolean;
}

export class Query<E extends BaseEntity> {
  readonly items: E[] = [];
  constructor(readonly predicate: (e: E) => boolean) {}

  get size(): number {
    return this.items.length;
  }
}

export class World<E extends BaseEntity> {
  readonly entities: E[] = [];
  private readonly queries: Query<E>[] = [];
  private readonly pendingRemove: E[] = [];
  private nextId = 1;

  query(predicate: (e: E) => boolean): Query<E> {
    const q = new Query(predicate);
    for (const e of this.entities) if (predicate(e)) q.items.push(e);
    this.queries.push(q);
    return q;
  }

  add(e: E): E {
    e.id = this.nextId++;
    e.alive = true;
    this.entities.push(e);
    for (const q of this.queries) if (q.predicate(e)) q.items.push(e);
    return e;
  }

  /** Marks the entity dead; it is unlinked from queries on the next flush(). */
  remove(e: E): void {
    if (!e.alive) return;
    e.alive = false;
    this.pendingRemove.push(e);
  }

  /** Returns the removed entities so callers can recycle them into pools. */
  flush(onRemoved?: (e: E) => void): void {
    if (this.pendingRemove.length === 0) return;
    for (const e of this.pendingRemove) {
      swapRemove(this.entities, e);
      for (const q of this.queries) if (q.predicate(e)) swapRemove(q.items, e);
      onRemoved?.(e);
    }
    this.pendingRemove.length = 0;
  }

  clear(onRemoved?: (e: E) => void): void {
    for (const e of this.entities) this.remove(e);
    this.flush(onRemoved);
  }
}

function swapRemove<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i < 0) return;
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}

/** Object pool keyed by a string (entity kind) to avoid per-spawn allocation. */
export class Pool<T> {
  private readonly free = new Map<string, T[]>();

  acquire(key: string, create: () => T): T {
    const list = this.free.get(key);
    return list && list.length > 0 ? list.pop()! : create();
  }

  release(key: string, item: T): void {
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    list.push(item);
  }
}
