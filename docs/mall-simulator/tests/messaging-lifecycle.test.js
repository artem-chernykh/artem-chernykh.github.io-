import assert from "node:assert/strict";
import test from "node:test";
import { createMessagingLifecycle } from "../messaging-lifecycle.js";

function createHarness(overrides = {}) {
  const calls = [];
  const api = {
    prechatAPI: {
      setHiddenPrechatFields(fields) {
        calls.push(["prechat", fields]);
      }
    },
    utilAPI: {
      async launchChat() {
        calls.push(["launch"]);
      }
    },
    userVerificationAPI: {
      async clearSession(options) {
        calls.push(["clear", options]);
        if (overrides.clearError) {
          throw overrides.clearError;
        }
      }
    }
  };
  const lifecycle = createMessagingLifecycle({
    getApi: () => api,
    readyTimeoutMilliseconds: 50
  });
  return { api, calls, lifecycle };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test("waits for both Ready and ButtonCreated before enabling a first launch", async () => {
  const { calls, lifecycle } = createHarness();
  lifecycle.handleReady();
  assert.equal(lifecycle.snapshot().ready, false);
  lifecycle.handleButtonCreated();
  assert.equal(lifecycle.snapshot().ready, true);

  const result = await lifecycle.startConversation({
    conversationKey: "standard-known",
    hiddenPrechatFields: { MallSimulationScenarioId: "standard-known" }
  });

  assert.deepEqual(calls, [
    ["prechat", { MallSimulationScenarioId: "standard-known" }],
    ["launch"]
  ]);
  assert.deepEqual(result, { launched: true, conversation: null });
});

test("clears a used session and waits for fresh Ready before the next launch", async () => {
  const { calls, lifecycle } = createHarness();
  lifecycle.handleButtonCreated();
  lifecycle.handleReady();

  await lifecycle.startConversation({
    conversationKey: "guest",
    hiddenPrechatFields: { MallSimulationScenarioId: "guest" }
  });

  const pending = lifecycle.startConversation({
    conversationKey: "standard-known",
    hiddenPrechatFields: { MallSimulationScenarioId: "standard-known" }
  });
  await flushPromises();
  assert.deepEqual(calls, [
    ["prechat", { MallSimulationScenarioId: "guest" }],
    ["launch"],
    ["clear", { shouldEndSession: true }]
  ]);

  lifecycle.handleReady();
  assert.deepEqual(await pending, { launched: true, conversation: null });
  assert.deepEqual(calls.slice(-2), [
    ["prechat", { MallSimulationScenarioId: "standard-known" }],
    ["launch"]
  ]);
});

test("does not apply pre-chat or launch when session clearing fails", async () => {
  const { calls, lifecycle } = createHarness({
    clearError: new Error("clear failed")
  });
  lifecycle.handleReady();
  lifecycle.handleButtonCreated();

  await lifecycle.startConversation({
    conversationKey: "initial",
    hiddenPrechatFields: { MallSimulationScenarioId: "initial" }
  });

  await assert.rejects(
    lifecycle.startConversation({
      conversationKey: "guest",
      hiddenPrechatFields: { MallSimulationScenarioId: "guest" }
    }),
    /clear failed/
  );
  assert.deepEqual(calls.slice(-1), [["clear", { shouldEndSession: true }]]);
});

test("prevents overlapping Salesforce chat operations", async () => {
  const { lifecycle } = createHarness();
  lifecycle.handleReady();
  lifecycle.handleButtonCreated();

  await lifecycle.startConversation({
    conversationKey: "initial",
    hiddenPrechatFields: { MallSimulationScenarioId: "initial" }
  });
  const first = lifecycle.startConversation({
    conversationKey: "guest",
    hiddenPrechatFields: { MallSimulationScenarioId: "guest" }
  });
  await assert.rejects(
    lifecycle.startConversation({
      conversationKey: "partner-known",
      hiddenPrechatFields: { MallSimulationScenarioId: "partner-known" }
    }),
    /not ready|already running/
  );

  lifecycle.handleReady();
  await first;
});

test("does not wait for ConversationStarted after launchChat opens pre-chat", async () => {
  const { lifecycle } = createHarness();
  lifecycle.handleButtonCreated();
  lifecycle.handleReady();

  const result = await lifecycle.startConversation({
    conversationKey: "guest",
    hiddenPrechatFields: { MallSimulationScenarioId: "guest" }
  });

  assert.deepEqual(result, { launched: true, conversation: null });
  lifecycle.handleConversationStarted({ conversationId: "later-conversation" });
  assert.equal(lifecycle.snapshot().conversationOpen, true);
});

test("reset waits for the post-clear Ready event", async () => {
  const { calls, lifecycle } = createHarness();
  lifecycle.handleReady();
  lifecycle.handleButtonCreated();

  const pending = lifecycle.reset();
  await flushPromises();
  assert.deepEqual(calls, [["clear", { shouldEndSession: true }]]);
  assert.equal(lifecycle.snapshot().ready, false);

  lifecycle.handleReady();
  await pending;
  assert.equal(lifecycle.snapshot().ready, true);
});
