/** Per-workflow-token gate. React rerenders and handshake resumes cannot duplicate auto work. */
export class AutoApplyGate {
  private readonly consumed = new Set<number>();
  public claim(token: number): boolean {
    if (this.consumed.has(token)) return false;
    this.consumed.add(token);
    return true;
  }
}
