/**
 * Typed, synchronous event bus between systems (B13). Handlers run immediately
 * during emit so audio/FX react on the same tick the simulation produced them.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    const list = this.handlers[type];
    if (!list) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
