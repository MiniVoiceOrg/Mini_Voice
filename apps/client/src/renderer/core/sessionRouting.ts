/**
 * Thin indirection between the network layer and the session manager (#400).
 *
 * A `NetworkClient` must not import `SessionManager` (which owns clients), so
 * incoming events are handed to a router the manager installs at startup.
 * Until it does, the default router simply emits, which is exactly the
 * single-server behaviour the app had before.
 */
export type SessionEventRouter = (sessionKey: string, event: string, emit: () => void) => void;

let router: SessionEventRouter = (_sessionKey, _event, emit) => emit();

export function setSessionEventRouter(fn: SessionEventRouter): void {
  router = fn;
}

export function routeSessionEvent(sessionKey: string, event: string, emit: () => void): void {
  router(sessionKey, event, emit);
}

let foreground = true;
let originKey: string | null = null;

export function setForegroundContext(value: boolean): void {
  foreground = value;
}

export function setEventOrigin(key: string | null): void {
  originKey = key;
}

/** Server that produced the event being handled right now, if known. */
export function currentEventOrigin(): string | null {
  return originKey;
}

/**
 * Whether the event being handled right now came from the server the user is
 * looking at. Handlers that produce something perceivable — a sound, a dialog,
 * a view swap — must check this, because they also run for background servers.
 */
export function isForegroundEvent(): boolean {
  return foreground;
}

/**
 * Runs a UI notification outside any background-routing window.
 *
 * Globals like the voice store are shared by every session, so their events
 * repaint whatever is on screen. Emitting one while a background server's event
 * is being routed would make the views read that background server's stores and
 * paint its channels over the visible ones (#400). Deferring by a microtask
 * lands the emit after `route()` has restored everything.
 */
export function emitOutsideRouting(emit: () => void): void {
  if (foreground) {
    emit();
    return;
  }
  queueMicrotask(emit);
}
