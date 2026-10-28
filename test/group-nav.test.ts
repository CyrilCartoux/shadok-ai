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
