import { DEMO_SCENARIOS } from "./demo-scenarios.js";

export const CONTEXT_EVENT_TYPE = "flender.mall.context.v1";
export const CONTEXT_EVENT_VERSION = 1;
export const RESULT_EVENT_TYPE = "flender.mall.context.result.v1";
export const READY_EVENT_TYPE = "flender.mall.host.ready.v1";
export const MAX_EVENT_AGE_MS = 90 * 1000;
export const MAX_FUTURE_SKEW_MS = 10 * 1000;

const ALLOWED_KEYS = Object.freeze([
  "type",
  "version",
  "eventId",
  "issuedAt",
  "scenarioId",
  "demoToken"
]);

const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildContextEnvelope(scenario, options = {}) {
  const now = options.now ?? Date.now();
  const issuedAt = now - (scenario.staleByMilliseconds ?? 0);
  const envelope = {
    type: CONTEXT_EVENT_TYPE,
    version: CONTEXT_EVENT_VERSION,
    eventId: options.eventId ?? createEventId(),
    issuedAt: new Date(issuedAt).toISOString(),
    scenarioId: scenario.id,
    demoToken: scenario.demoToken
  };

  return Object.freeze({ ...envelope, ...(scenario.forbiddenField ?? {}) });
}

export function validateContextEvent({
  data,
  origin,
  source,
  expectedOrigin,
  expectedSource,
  now = Date.now()
}) {
  if (origin !== expectedOrigin) {
    return failure("ORIGIN_REJECTED", "The event origin is not allowed.", "origin");
  }

  if (source !== expectedSource) {
    return failure("SOURCE_REJECTED", "The event did not come from the parent window.", "origin");
  }

  if (!isPlainObject(data)) {
    return failure("INVALID_OBJECT", "The event must be a plain JSON object.", "schema");
  }

  const receivedKeys = Object.keys(data).sort();
  const expectedKeys = [...ALLOWED_KEYS].sort();
  if (
    receivedKeys.length !== expectedKeys.length ||
    receivedKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return failure(
      "UNEXPECTED_FIELDS",
      "The event contains missing or unexpected fields.",
      "schema"
    );
  }

  if (data.type !== CONTEXT_EVENT_TYPE || data.version !== CONTEXT_EVENT_VERSION) {
    return failure("PROTOCOL_REJECTED", "The event protocol is not supported.", "schema");
  }

  if (typeof data.eventId !== "string" || !EVENT_ID_PATTERN.test(data.eventId)) {
    return failure("INVALID_EVENT_ID", "The event ID is invalid.", "schema");
  }

  if (typeof data.issuedAt !== "string") {
    return failure("INVALID_TIMESTAMP", "The event timestamp is missing.", "schema");
  }

  const timestamp = Date.parse(data.issuedAt);
  if (!Number.isFinite(timestamp)) {
    return failure("INVALID_TIMESTAMP", "The event timestamp is invalid.", "schema");
  }

  if (timestamp < now - MAX_EVENT_AGE_MS) {
    return failure("STALE_EVENT", "The event is outside the freshness window.", "schema");
  }

  if (timestamp > now + MAX_FUTURE_SKEW_MS) {
    return failure("FUTURE_EVENT", "The event timestamp is too far in the future.", "schema");
  }

  if (typeof data.scenarioId !== "string" || !(data.scenarioId in DEMO_SCENARIOS)) {
    return failure("UNKNOWN_SCENARIO", "The scenario is not in the fixed demo allowlist.", "schema");
  }

  if (typeof data.demoToken !== "string" || data.demoToken.length > 100) {
    return failure("INVALID_DEMO_TOKEN", "The demo token is invalid.", "schema");
  }

  const scenario = DEMO_SCENARIOS[data.scenarioId];
  if (!constantTimeDemoCompare(data.demoToken, scenario.demoToken)) {
    return failure("TOKEN_REJECTED", "The scenario and demo token do not match.", "schema");
  }

  return Object.freeze({
    ok: true,
    code: "CONTEXT_ACCEPTED",
    message: "The context envelope passed browser-side validation.",
    stage: "complete",
    scenario
  });
}

function failure(code, message, stage) {
  return Object.freeze({ ok: false, code, message, stage });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function constantTimeDemoCompare(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function createEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
