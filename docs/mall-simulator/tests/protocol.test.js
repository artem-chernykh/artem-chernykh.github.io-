import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_SCENARIOS } from "../demo-scenarios.js";
import { buildContextEnvelope, validateContextEvent } from "../protocol.js";

const origin = "https://example.github.io";
const parentWindow = Object.freeze({ name: "parent" });
const now = Date.parse("2026-08-05T10:00:00.000Z");
const eventId = "77dc5d4c-cbcb-43ff-9eaf-55012c084a04";

function validate(data, overrides = {}) {
  return validateContextEvent({
    data,
    origin: overrides.origin ?? origin,
    source: overrides.source ?? parentWindow,
    expectedOrigin: origin,
    expectedSource: parentWindow,
    now
  });
}

test("accepts an allowlisted fresh scenario and matching token", () => {
  const envelope = buildContextEnvelope(DEMO_SCENARIOS.guest, { now, eventId });
  assert.equal(validate(envelope).ok, true);
});

test("rejects a wrong parent origin", () => {
  const envelope = buildContextEnvelope(DEMO_SCENARIOS.guest, { now, eventId });
  assert.equal(validate(envelope, { origin: "https://evil.example" }).code, "ORIGIN_REJECTED");
});

test("rejects a message from a different window", () => {
  const envelope = buildContextEnvelope(DEMO_SCENARIOS.guest, { now, eventId });
  assert.equal(validate(envelope, { source: {} }).code, "SOURCE_REJECTED");
});

test("rejects the stale negative-test event", () => {
  const envelope = buildContextEnvelope(DEMO_SCENARIOS.stale, { now, eventId });
  assert.equal(validate(envelope).code, "STALE_EVENT");
});

test("rejects browser-supplied trust fields", () => {
  const envelope = buildContextEnvelope(DEMO_SCENARIOS.malformed, { now, eventId });
  assert.equal(validate(envelope).code, "UNEXPECTED_FIELDS");
});

test("rejects a token copied from a different scenario", () => {
  const envelope = {
    ...buildContextEnvelope(DEMO_SCENARIOS.guest, { now, eventId }),
    demoToken: DEMO_SCENARIOS["partner-known"].demoToken
  };
  assert.equal(validate(envelope).code, "TOKEN_REJECTED");
});
