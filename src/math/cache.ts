/** A bounded least-recently-used cache. `get` refreshes an entry's recency. */
export class BoundedMathCache<Value> {
  private readonly entries = new Map<string, Value>();

  public constructor(private readonly capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Math cache capacity must be a positive safe integer.');
    }
  }

  public get(key: string): Value | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: string, value: Value): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  public get size(): number {
    return this.entries.size;
  }

  public has(key: string): boolean {
    return this.entries.has(key);
  }
}
