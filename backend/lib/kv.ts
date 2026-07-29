import { Redis } from "@upstash/redis";

/**
 * Vercel KV is Upstash Redis under the hood, and injects these env var names.
 * Using the Upstash client directly (rather than @vercel/kv) keeps a move to
 * plain Upstash — or any other host — an env-var swap. See ADR-0001.
 */
export const kv = new Redis({
  url: requireEnv("KV_REST_API_URL"),
  token: requireEnv("KV_REST_API_TOKEN"),
});

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Env var ${name} belum diset`);
  return value;
}
