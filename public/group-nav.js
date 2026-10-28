/**
 * The two-column navigation: groups on the left (the "rail"), the selected
 * group's agents beside it. Pure, so the browser and test/group-nav.test.ts
 * share it.
 *
 * The rail is a VIEW over the agents column, never a second copy of the groups:
 * the order, names and membership still live in the agents column's DOM, which
 * is what `persistGroups` / `persistChannels` read. So nothing here owns state.
 */

/** Icons a new group draws from; any emoji can be typed in instead. */
export const GROUP_ICONS = [
  "📁", "🚀", "🧪", "🛠", "📦", "🎯", "🧭", "🔬", "🌱", "⚡",
  "🧩", "📊", "🔒", "🎨", "📣", "🐛", "🗂", "🛰", "🔥", "💡",
];

/** The view a group is selected under; the agents with no group have their own. */
export const UNGROUPED = "ungrouped";

/** A random icon from GROUP_ICONS. `rand` is injectable for the tests. */
export function randomGroupIcon(rand = Math.random) {
  const i = Math.floor(rand() * GROUP_ICONS.length);
  return GROUP_ICONS[Math.min(Math.max(i, 0), GROUP_ICONS.length - 1)];
}

/**
 * The view to show, from what was saved and the groups that exist now. A saved
 * group that was dissolved (here or on another device) falls back to the
 * ungrouped view rather than to an empty column.
 */
export function resolveGroupView(saved, groupIds) {
  const ids = (groupIds || []).map(String);
  return saved != null && ids.includes(String(saved)) ? String(saved) : UNGROUPED;
}

/**
 * One mood for a whole group, from its agents' moods — what the rail shows for
 * a group that is not on screen. Ordered by how much it needs you: a question
 * waiting beats an unread answer, which beats work in progress.
 */
export function groupMood(moods) {
  const set = new Set(moods || []);
  for (const m of ["needs-answer", "unread", "working"]) if (set.has(m)) return m;
  return null;
}

/**
 * A typed icon, trimmed and kept short: one emoji may be several code points
 * (a flag, a skin tone, a ZWJ family), so the cap is on graphemes when the
 * runtime can count them. Empty → null, so the caller keeps the old one.
 */
export function cleanGroupIcon(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)];
    return seg.slice(0, 2).map((x) => x.segment).join("");
  }
  return [...s].slice(0, 2).join("");
}

/**
 * What a tab the page has NOT opened shows, from the `live` summary the server
 * adds to GET /channels. `seenAt` is the content instant the tab already
 * accounts for; anything newer is unread. A question waiting beats everything,
 * since it blocks the agent.
 */
export function idleMood(live, seenAt) {
  if (!live) return null;
  if (live.needsAnswer) return "needs-answer";
  if (live.busy) return "working";
  if (live.lastAt != null && seenAt != null && live.lastAt > seenAt) return "unread";
  return null;
}

/** How many history turns are drawn at first; the rest wait behind "Load older". */
export const HISTORY_FIRST = 30;

/**
 * Split a replayed history into what is drawn now and what waits. A link to a
 * message in the older part draws everything, or the link would land nowhere.
 */
export function splitHistory(turns, first = HISTORY_FIRST, wantMsgId = null) {
  const list = turns || [];
  if (list.length <= first) return { older: [], recent: list };
  if (wantMsgId && list.slice(0, -first).some((h) => (h.ids || []).includes(wantMsgId))) {
    return { older: [], recent: list };
  }
  return { older: list.slice(0, -first), recent: list.slice(-first) };
}
