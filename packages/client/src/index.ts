import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Task = components['schemas']['Task'];
export type Project = components['schemas']['Project'];
export type Week = components['schemas']['Week'];
export type Token = components['schemas']['Token'];
export type Webhook = components['schemas']['Webhook'];
export type Calendar = components['schemas']['Calendar'];
export type CalendarEvent = components['schemas']['CalendarEvent'];

export interface ClientOptions {
  /** Defaults to same origin. */
  baseUrl?: string;
  /** API token for server-to-server use. Browsers use the session cookie instead. */
  token?: string;
  /** Send cookies + CSRF header (web UI). */
  browser?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: { title?: string; detail?: string; [k: string]: unknown },
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
}

export function createApiClient(opts: ClientOptions = {}) {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl ?? '',
    credentials: opts.browser ? 'include' : 'same-origin',
  });
  const mw: Middleware = {
    onRequest({ request }) {
      if (opts.token) request.headers.set('authorization', `Bearer ${opts.token}`);
      if (opts.browser) request.headers.set('x-requested-with', 'todo-web');
      return request;
    },
  };
  client.use(mw);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Unwrap an openapi-fetch result or throw ApiError with the problem+json body. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) throw new ApiError(response.status, (error ?? {}) as { title?: string });
  return data as T;
}
