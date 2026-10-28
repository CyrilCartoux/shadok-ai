import assert from "node:assert/strict";
import test from "node:test";
// @ts-ignore — plain ESM shared with the browser
import { GROUP_ICONS, UNGROUPED, randomGroupIcon, resolveGroupView, groupMood, cleanGroupIcon } from "../public/group-nav.js";

test("group icon: drawn from the list, bounds included", () => {
  assert.equal(randomGroupIcon(() => 0), GROUP_ICONS[0]);
  assert.equal(randomGroupIcon(() => 0.9999999), GROUP_ICONS[GROUP_ICONS.length - 1]);
  assert.equal(randomGroupIcon(() => 1), GROUP_ICONS[GROUP_ICONS.length - 1]);
  assert.ok(GROUP_ICONS.includes(randomGroupIcon()));
});

test("group view: a saved group that still exists is kept, as a string", () => {
  assert.equal(resolveGroupView("3", [1, 3]), "3");
  assert.equal(resolveGroupView(3, ["3"]), "3");
});

test("group view: a dissolved or missing group falls back to ungrouped", () => {
  assert.equal(resolveGroupView("7", [1, 3]), UNGROUPED);
  assert.equal(resolveGroupView(null, [1]), UNGROUPED);
  assert.equal(resolveGroupView(UNGROUPED, []), UNGROUPED);
});

test("group mood: what needs you first", () => {
  assert.equal(groupMood(["working", "unread", null]), "unread");
  assert.equal(groupMood(["working", "needs-answer"]), "needs-answer");
  assert.equal(groupMood(["working"]), "working");
  assert.equal(groupMood([null, null]), null);
  assert.equal(groupMood([]), null);
});

test("group icon: typed text is trimmed and kept short, empty keeps the old one", () => {
  assert.equal(cleanGroupIcon("  🚀 "), "🚀");
  assert.equal(cleanGroupIcon("👨‍👩‍👧"), "👨‍👩‍👧");          // one grapheme, several code points
  assert.equal(cleanGroupIcon("abcdef"), "ab");
  assert.equal(cleanGroupIcon("   "), null);
  assert.equal(cleanGroupIcon(undefined), null);
});

// @ts-ignore — plain ESM shared with the browser
import { idleMood, splitHistory, HISTORY_FIRST } from "../public/group-nav.js";

test("idle mood: a waiting question first, then work, then new content", () => {
  assert.equal(idleMood(null, 0), null);
  assert.equal(idleMood({ needsAnswer: true, busy: true, lastAt: 9 }, 1), "needs-answer");
  assert.equal(idleMood({ needsAnswer: false, busy: true, lastAt: 9 }, 1), "working");
  assert.equal(idleMood({ needsAnswer: false, busy: false, lastAt: 9 }, 1), "unread");
  assert.equal(idleMood({ needsAnswer: false, busy: false, lastAt: 9 }, 9), null);
  // Nothing known yet on either side is not "unread".
  assert.equal(idleMood({ needsAnswer: false, busy: false, lastAt: null }, 1), null);
  assert.equal(idleMood({ needsAnswer: false, busy: false, lastAt: 9 }, null), null);
});

test("history split: the last N now, the rest behind Load older", () => {
  const turns = Array.from({ length: 50 }, (_, i) => ({ ids: ["m" + i] }));
  const { older, recent } = splitHistory(turns, 30);
  assert.equal(older.length, 20);
  assert.equal(recent.length, 30);
  assert.deepEqual(recent[0].ids, ["m20"]);
  assert.equal(splitHistory(turns.slice(0, 10)).older.length, 0);
  assert.equal(HISTORY_FIRST, 30);
});

test("history split: a link into the older part draws everything", () => {
  const turns = Array.from({ length: 50 }, (_, i) => ({ ids: ["m" + i] }));
  assert.equal(splitHistory(turns, 30, "m3").recent.length, 50);
  assert.equal(splitHistory(turns, 30, "m45").recent.length, 30);
});
