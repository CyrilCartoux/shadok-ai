import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// In the groups rail collapsed to icons (body.rail-mini), a group row is almost
// entirely its icon button, so a single click on the icon must SELECT the group
// (setView) and only a double-click opens the icon picker — otherwise selecting
// a collapsed group is impossible, which is the reported symptom. Native
// dblclick can't be used: selecting a non-active group rebuilds the rail
// (renderRail keys on the active view) and replaces the icon between the two
// clicks, so the detection lives on a module-level stamp. Locked here like
// test/ws-url.test.ts locks the socket scheme: browser-only wiring, invisible to
// tsc, and exactly what a refactor of the rail could quietly revert.
const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "index.html"),
  "utf8",
);

test("the rail icon's single click selects the group, double-click opens the picker", () => {
  // The stamp survives the rail rebuild that a selection triggers.
  assert.match(HTML, /let lastIconClick\s*=\s*\{/, "expected a module-level double-click stamp");
  // The icon click handler resolves to the picker only on a quick second click.
  const m = HTML.match(/ic\.addEventListener\(\s*["']click["']\s*,\s*\(e\)\s*=>\s*\{([\s\S]*?)\n\s{6}\}\);/);
  assert.ok(m, "expected the rail icon click handler");
  const body = m![1];
  assert.match(body, /lastIconClick\.view\s*===\s*view/, "must compare against the last-clicked view");
  assert.match(body, /openIconPicker\(group, ic\)/, "a double-click opens the icon picker");
  assert.match(body, /setView\(view\)/, "a single click selects the group");
  // The picker branch must be the double-click one, the select branch the else.
  assert.match(
    body,
    /if\s*\([\s\S]*?<\s*350\s*\)\s*\{\s*[\s\S]*?openIconPicker[\s\S]*?\}\s*else\s*\{\s*[\s\S]*?setView\(view\)/,
    "openIconPicker on the fast second click, setView otherwise",
  );
});

test("the rail icon advertises the double-click", () => {
  assert.match(HTML, /ic\.title\s*=\s*["']Double-click to change the icon["']/);
});
