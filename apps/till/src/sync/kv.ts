/**
 * A tiny durable key/value store that lives in a *different* browser storage bucket than the
 * `LocalStore` (OPFS). That separation is the point: it lets the canary (a device-registration token)
 * survive an eviction that clears OPFS but not `localStorage`, so an empty event store with the token
 * still present reads as **eviction**, not a first run (ADR 0005).
 *
 * It is not durable against a full "Clear Website Data", which wipes every bucket at once — that case
 * is caught instead by the server high-water mark (and, with real device auth in Sprint 4, by
 * re-registration). See `reconcile.ts`.
 */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

/** Browser adapter over `localStorage`. */
export class LocalStorageKeyValue implements KeyValueStore {
  constructor(private readonly storage: Storage = localStorage) {}
  get(key: string): string | null {
    return this.storage.getItem(key)
  }
  set(key: string, value: string): void {
    this.storage.setItem(key, value)
  }
  remove(key: string): void {
    this.storage.removeItem(key)
  }
}

/** In-memory adapter for tests (and for modelling an independent bucket in the device-test proxies). */
export class MemoryKeyValue implements KeyValueStore {
  private readonly map = new Map<string, string>()
  get(key: string): string | null {
    return this.map.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.map.set(key, value)
  }
  remove(key: string): void {
    this.map.delete(key)
  }
}
