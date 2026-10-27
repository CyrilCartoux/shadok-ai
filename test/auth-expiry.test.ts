import assert from "node:assert/strict";
import test from "node:test";
import { fmtExpiry, expiryWarning, EXPIRY_WARN_MS } from "../public/auth-expiry.js";

const NOW = 1_800_000_000_000; // a fixed "now" so the clock is deterministic
const h = (n: number) => n * 3600_000;
const d = (n: number) => n * 86_400_000;

test("fmtExpiry: days / hours / minutes / expired", () => {
  assert.equal(fmtExpiry(NOW + d(22), NOW), "in 22 days");
  assert.equal(fmtExpiry(NOW + h(6), NOW), "in 6 h");
  assert.equal(fmtExpiry(NOW + 40 * 60_000, NOW), "in 40 min");
  assert.equal(fmtExpiry(NOW - 1, NOW), "expired");
  assert.equal(fmtExpiry(NOW, NOW), "expired"); // exactly now counts as expired
});

test("expiryWarning: a healthy signed-in session well inside its window → no nag", () => {
  const auth = { state: "signed-in", loggedIn: true, tokenExpiresAt: NOW + d(22) };
  assert.equal(expiryWarning(auth, NOW), null);
});

test("expiryWarning: within 24h → nags, carrying the countdown wording", () => {
  const auth = { state: "signed-in", loggedIn: true, tokenExpiresAt: NOW + h(18) };
  const w = expiryWarning(auth, NOW);
  assert.ok(w);
  assert.equal(w!.expired, false);
  assert.ok(w!.remainingMs > 0 && w!.remainingMs < EXPIRY_WARN_MS);
  assert.match(w!.text, /in 18 h/);
  assert.match(w!.text, /re-login/i);
});

test("expiryWarning: exactly at the 24h threshold does not nag yet (strictly inside)", () => {
  const auth = { state: "signed-in", loggedIn: true, tokenExpiresAt: NOW + EXPIRY_WARN_MS };
  assert.equal(expiryWarning(auth, NOW), null);
  // One millisecond closer and it does.
  assert.ok(expiryWarning({ ...auth, tokenExpiresAt: NOW + EXPIRY_WARN_MS - 1 }, NOW));
});

test("expiryWarning: already past the deadline still nags, flagged expired", () => {
  const auth = { state: "signed-in", loggedIn: true, tokenExpiresAt: NOW - h(1) };
  const w = expiryWarning(auth, NOW);
  assert.ok(w);
  assert.equal(w!.expired, true);
  assert.match(w!.text, /has expired/i);
});

test("expiryWarning: a failed probe (unknown) never nags — it is not 'signed out'", () => {
  assert.equal(expiryWarning({ state: "unknown", tokenExpiresAt: NOW + h(1) }, NOW), null);
});

test("expiryWarning: a signed-out account is the sign-in card's job, not the banner's", () => {
  assert.equal(expiryWarning({ state: "signed-out", tokenExpiresAt: NOW + h(1) }, NOW), null);
  assert.equal(expiryWarning({ loggedIn: false, tokenExpiresAt: NOW + h(1) }, NOW), null);
});

test("expiryWarning: no numeric deadline (env token, or missing) → nothing to warn about", () => {
  assert.equal(expiryWarning({ state: "signed-in", loggedIn: true }, NOW), null);
  assert.equal(expiryWarning({ state: "signed-in", tokenExpiresAt: "soon" as unknown as number }, NOW), null);
  assert.equal(expiryWarning(null, NOW), null);
});
