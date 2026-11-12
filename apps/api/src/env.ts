export interface Config {
  databasePath: string;
  adminPasswordHash: string;
  sessionSecret: string;
  corsOrigins: string[];
  timeZone: string;
  port: number;
  webDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databasePath: env.DATABASE_PATH ?? './data/todo.db',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    sessionSecret: env.SESSION_SECRET ?? 'dev-secret',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    timeZone: env.TZ ?? 'UTC',
    port: Number(env.PORT ?? 3000),
    webDir: env.WEB_DIR ?? null,
  };
}
