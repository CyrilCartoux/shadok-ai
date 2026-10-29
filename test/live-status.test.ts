import assert from "node:assert/strict";
import test from "node:test";
import { liveStatus, ACTIVITY_MESSAGES } from "../src/live-status.js";

test("live status: a dead process says nothing", () => {
  assert.equal(liveStatus({ busy: false, lastDialogKey: "q", exited: true }), null);
});

test("live status: a question counts only while no turn runs", () => {
  assert.deepEqual(liveStatus({ busy: false, lastDialogKey: "q", lastActivityAt: 5, exited: false }), {
    busy: false, needsAnswer: true, lastAt: 5,
  });
  // The dialog key survives into the turn its answer started; that is not a question.
  assert.equal(liveStatus({ busy: true, lastDialogKey: "q", exited: false })!.needsAnswer, false);
  assert.equal(liveStatus({ busy: false, lastDialogKey: null, exited: false })!.needsAnswer, false);
});

test("live status: no activity seen since boot is null, not zero", () => {
  assert.equal(liveStatus({ busy: false, lastDialogKey: null, exited: false })!.lastAt, null);
});

test("activity: content counts, screen refreshes and gauges do not", () => {
  for (const t of ["stream-text", "stream-tool", "dialog", "turn-done"]) assert.ok(ACTIVITY_MESSAGES.has(t), t);
  for (const t of ["screen", "tokens", "context", "background", "working"]) assert.ok(!ACTIVITY_MESSAGES.has(t), t);
});
