/**
 * Privacy-friendly analytics (J6): only anonymous aggregate counters (stage
 * reached, deaths, session length) — no identifiers, no cookies. Sent only
 * when an API is configured and the player hasn't opted out in Settings.
 */
const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');

export type StatType = 'stage_start' | 'stage_clear' | 'death' | 'game_over' | 'session_length';

export class Analytics {
  enabled = true;
  private queue: { type: StatType; stage: number; value: number }[] = [];
  private readonly started = Date.now();

  constructor() {
    if (typeof window === 'undefined') return;
    setInterval(() => this.flush(), 30_000);
    addEventListener('pagehide', () => {
      this.track('session_length', 0, Math.round((Date.now() - this.started) / 1000));
      this.flush(true);
    });
  }

  track(type: StatType, stage: number, value = 1): void {
    if (!this.enabled || API === undefined) return;
    this.queue.push({ type, stage, value });
    if (this.queue.length >= 50) this.flush();
  }

  flush(beacon = false): void {
    if (API === undefined || this.queue.length === 0) return;
    const body = JSON.stringify({ events: this.queue.splice(0) });
    const url = `${API}/api/events`;
    if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, body);
    else
      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
  }
}
