export type AppEvent =
  | { type: 'run.progress'; runId: number }
  | { type: 'posting.added'; postingId: string }
  | { type: 'posting.updated'; postingId: string }
  | { type: 'match.updated'; postingId: string }
  | { type: 'queue.changed' }
  | { type: 'llm.status'; available: boolean }
  | { type: 'profile.updated' }
  | { type: 'application.updated'; postingId: string }
  | { type: 'postings.cleared' };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

/** In-process event bus. The SSE endpoint forwards every event to the browser. */
export function publish(event: AppEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not stop the publisher.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
