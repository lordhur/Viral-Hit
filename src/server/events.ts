export type ServerEventName = "transcribe" | "export" | "url-import" | "watch" | "diagnostics" | "job";

export interface ServerEvent {
  channel: ServerEventName;
  data: unknown;
}

type Listener = (event: ServerEvent) => void;

/** In-process fan-out used by the SSE route; no media or credentials are events. */
export class EventHub {
  private listeners = new Set<Listener>();

  emit(channel: ServerEventName, data: unknown): void {
    const event = { channel, data };
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
