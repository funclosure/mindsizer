export const IDLE_TIMEOUT_MS = Number(process.env.MINDSIZER_IDLE_TIMEOUT_MS) || 180_000;

export interface Watchdog {
  kick(): void;            // call on every stream message — resets the idle timer
  stop(): void;            // clear the timer (call when done)
  readonly fired: boolean; // true once onIdle has fired
}

/** Start an idle watchdog: calls onIdle() if kick() isn't called within `ms`. Latches after firing. */
export function startWatchdog(ms: number, onIdle: () => void): Watchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  const arm = () => {
    timer = setTimeout(() => { fired = true; onIdle(); }, ms);
  };
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  arm();
  return {
    kick() { if (fired) return; clear(); arm(); },
    stop() { clear(); },
    get fired() { return fired; },
  };
}
