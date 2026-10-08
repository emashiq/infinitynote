/**
 * Remembers the outcome of recent requests per note, so a request retried with the same requestId gets the same
 * answer instead of being applied twice. Bounded per note; the oldest entry is evicted first.
 */
export class RequestCache<T> {
  private readonly byNote = new Map<string, Map<string, T>>();

  constructor(private readonly perNote = 100) {}

  get(noteId: string, requestId: string): T | undefined {
    return this.byNote.get(noteId)?.get(requestId);
  }

  set(noteId: string, requestId: string, value: T): void {
    let cache = this.byNote.get(noteId);
    if (!cache) {
      cache = new Map();
      this.byNote.set(noteId, cache);
    }
    cache.set(requestId, value);
    if (cache.size > this.perNote) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
}
