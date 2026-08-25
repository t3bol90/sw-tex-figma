/** Cancels stale UI-local async work without asking the controller to trust an id. */
export class ApplyEpochGate {
  private epoch = 0;
  public begin(): number {
    this.epoch += 1;
    return this.epoch;
  }
  public invalidate(): void {
    this.epoch += 1;
  }
  public isCurrent(token: number): boolean {
    return token === this.epoch;
  }
}
