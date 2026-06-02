import type { ConnectionOptions } from 'bullmq';

export function getBullMqConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : 6379;
  const db =
    parsed.pathname && parsed.pathname.length > 1
      ? Number(parsed.pathname.slice(1))
      : undefined;

  return {
    host: parsed.hostname || 'localhost',
    port,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    db: Number.isFinite(db) ? db : undefined,
    maxRetriesPerRequest: null,
  };
}
