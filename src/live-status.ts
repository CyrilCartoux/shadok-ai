/**
 * What an agent the browser has NOT opened is doing, for the lazy-loaded
 * cockpit. Since the page opens a socket only for the agents on screen, the
 * others would otherwise go dark: no "waiting for you", no unread, no ding.
 * `GET /channels` (already polled every 4 s) carries this summary instead —
 * derived on each request from the running session, never stored (cf.
 * invariant 6, like `crons`).
 *
 * Only what the server already knows in memory: a filesystem lookup per
 * channel per poll would be the cost invariant 38 warns about.
 */
export interface LiveStatus {
  /** A turn is running. */
  busy: boolean;
  /** A question (dialog) is on screen and no turn is running. */
  needsAnswer: boolean;
  /** When the agent last produced content (epoch ms), if seen since boot. */
  lastAt: number | null;
}

export function liveStatus(s: {
  busy: boolean;
  lastDialogKey: string | null;
  lastActivityAt?: number;
  exited: boolean;
}): LiveStatus | null {
  if (s.exited) return null;
  return {
    busy: s.busy,
    needsAnswer: !s.busy && s.lastDialogKey != null,
    lastAt: s.lastActivityAt ?? null,
  };
}

/** The messages that count as the agent producing something new. */
export const ACTIVITY_MESSAGES: ReadonlySet<string> = new Set([
  "stream-text", "stream-tool", "stream-bash", "stream-result", "dialog", "turn-done",
]);
