/**
 * Client error reporting (J7): uncaught errors and rejections are deduplicated,
 * capped per session and sent to /api/errors — only when an API is configured
 * and the player hasn't turned off anonymous stats. No identifiers are sent.
 */
const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const MAX_PER_SESSION = 10;

export class Telemetry {
  enabled = true;
  private readonly seen = new Set<string>();
  private queue: { message: string; stack: string; version: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  report(message: string, stack = ''): void {
    if (!this.enabled || API === undefined || this.seen.size >= MAX_PER_SESSION) return;
    const key = message.slice(0, 200);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.queue.push({
      message: message.slice(0, 300),
      stack: stack.slice(0, 2000),
      version: __APP_VERSION__,
    });
    this.timer ??= setTimeout(() => this.flush(), 2000);
  }

  private flush(): void {
    this.timer = null;
    if (!this.queue.length) return;
    const body = JSON.stringify({ errors: this.queue.splice(0) });
    void fetch(`${API}/api/errors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }
}
