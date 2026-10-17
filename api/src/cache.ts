interface Entry {
  expires: number;
  value: unknown;
}

const MAX_ENTRIES = 500;
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Tiny in-memory TTL cache with in-flight de-duplication, for expensive spatial
 * queries whose inputs only change when ingestion runs.
 */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { expires: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export const FIVE_MINUTES = 5 * 60 * 1000;
