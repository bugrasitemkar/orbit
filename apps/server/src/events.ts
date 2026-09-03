/**
 * In-process SSE event hub: the indexer publishes, browser clients subscribe.
 */
export interface OrbitEvent {
  type: 'session-updated'
  sessionId: string
  title: string | null
}

type Listener = (event: OrbitEvent) => void

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publish(event: OrbitEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // A broken listener must not break the indexer.
    }
  }
}
