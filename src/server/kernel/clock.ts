/** One clock for the server. Tests replace it to control time. */
let current: () => number = () => Date.now();

export function nowMs(): number {
  return current();
}

export function nowIso(): string {
  return new Date(current()).toISOString();
}

export function isoAfter(ms: number): string {
  return new Date(current() + ms).toISOString();
}

export function setClock(fn: (() => number) | null): void {
  current = fn ?? (() => Date.now());
}
