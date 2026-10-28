import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The sign-in card is a non-dismissable funnel when the instance is SIGNED OUT
// (signing in is the only way to make it usable), but a VOLUNTARY re-login
// opened from the panel/banner (force) must be closable — and closing it has to
// cancel the pending `claude auth login` child on the server (DELETE
// /auth/login → cancelLogin), or it is left waiting on stdin. Locked here like
// test/ws-url.test.ts locks the socket scheme: browser-only wiring, silent to
// tsc, and the exact thing a refactor of the card could quietly drop.
const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "index.html"),
  "utf8",
);

test("the auth card has a close button", () => {
  assert.match(HTML, /id="authClose"/, "expected a #authClose button in the card");
});

test("closability tracks `force`: the signed-out funnel is not dismissable", () => {
  // openAuthCard records the force flag and only shows ✕ for a voluntary open.
  assert.match(HTML, /authDismissable\s*=\s*force/, "openAuthCard must record force → dismissable");
  assert.match(
    HTML,
    /\$\("authClose"\)\.hidden\s*=\s*!force/,
    "the ✕ is shown only for a forced (voluntary) re-login",
  );
});

test("closing is gated on dismissable AND cancels the server flow", () => {
  const m = HTML.match(/function closeAuthCard\(\)\s*\{([\s\S]*?)\n\s{2}\}/);
  assert.ok(m, "expected a closeAuthCard() function");
  const body = m![1];
  assert.match(body, /if\s*\(\s*!authDismissable\s*\)\s*return/, "must no-op when the card is the signed-out funnel");
  assert.match(body, /fetch\(\s*["']\/auth\/login["']\s*,\s*\{\s*method:\s*["']DELETE["']/, "must cancel the pending login child");
  assert.match(body, /\$\("authOverlay"\)\.hidden\s*=\s*true/, "must hide the overlay");
});

test("Escape only closes a dismissable auth card", () => {
  assert.match(
    HTML,
    /authOverlay"\)\.hidden\s*&&\s*authDismissable\s*\)\s*\{\s*closeAuthCard\(\)/,
    "the Escape cascade must gate the auth card on authDismissable",
  );
});
