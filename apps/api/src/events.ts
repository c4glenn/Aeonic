import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import type { Db } from './db';
import { schema } from './db';

export interface AppEvent {
  id: string;
  type: string;
  ts: string;
  data: Record<string, unknown>;
}

export class Bus {
  private em = new EventEmitter().setMaxListeners(0);
  emit(type: string, data: Record<string, unknown>): AppEvent {
    const event: AppEvent = { id: nanoid(), type, ts: new Date().toISOString(), data };
    this.em.emit('event', event);
    return event;
  }
  subscribe(fn: (e: AppEvent) => void): () => void {
    this.em.on('event', fn);
    return () => this.em.off('event', fn);
  }
}

export interface WebhookOptions {
  fetch?: typeof fetch;
  /** Delay before each attempt, in ms. Length = number of attempts. */
  retryDelays?: number[];
}

export function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function startWebhookDispatcher(db: Db, bus: Bus, opts: WebhookOptions = {}): () => void {
  const doFetch = opts.fetch ?? fetch;
  const delays = opts.retryDelays ?? [0, 2_000, 15_000, 60_000];

  const attempt = async (hook: typeof schema.webhooks.$inferSelect, event: AppEvent, body: string, n: number) => {
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await doFetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aeonic-event': event.type,
          'x-aeonic-delivery': event.id,
          'x-aeonic-signature': sign(hook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    db.insert(schema.webhookDeliveries)
      .values({
        id: nanoid(),
        webhookId: hook.id,
        event: event.type,
        attempt: n,
        status,
        error,
        createdAt: new Date().toISOString(),
      })
      .run();
    if (error && n < delays.length) {
      setTimeout(() => void attempt(hook, event, body, n + 1), delays[n]!).unref();
    }
  };

  return bus.subscribe((event) => {
    const hooks = db.select().from(schema.webhooks).all();
    const body = JSON.stringify(event);
    for (const hook of hooks) {
      if (hook.events.length && !hook.events.includes(event.type)) continue;
      setTimeout(() => void attempt(hook, event, body, 1), delays[0] ?? 0).unref();
    }
  });
}
