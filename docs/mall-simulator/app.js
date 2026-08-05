import { SCENARIO_LIST } from "./demo-scenarios.js?v=20260805.8";
import { createMessagingLifecycle } from "./messaging-lifecycle.js?v=20260805.8";
import { buildContextEnvelope, validateContextEvent } from "./protocol.js?v=20260805.8";
import { SALESFORCE_CONFIG } from "./salesforce-config.js?v=20260805.8";

const SALESFORCE_READY_TIMEOUT_MS = 20000;

const elements = {
  scenarioSelect: document.querySelector("#scenario-select"),
  scenarioDetail: document.querySelector("#scenario-detail"),
  expectedBadge: document.querySelector("#expected-badge"),
  sendButton: document.querySelector("#send-button"),
  reloadButton: document.querySelector("#reload-button"),
  copyButton: document.querySelector("#copy-button"),
  payloadPreview: document.querySelector("#payload-preview"),
  hostPanel: document.querySelector(".host-panel"),
  hostStatus: document.querySelector("#host-status"),
  eventLog: document.querySelector("#event-log"),
  clearLogButton: document.querySelector("#clear-log-button"),
  receiverStatus: document.querySelector("#receiver-status"),
  receiverTitle: document.querySelector("#receiver-title"),
  receiverMessage: document.querySelector("#receiver-message"),
  originState: document.querySelector("#origin-state"),
  schemaState: document.querySelector("#schema-state"),
  adapterState: document.querySelector("#adapter-state"),
  acceptedEnvelope: document.querySelector("#accepted-envelope"),
  receiverLog: document.querySelector("#receiver-log")
};

const state = {
  envelope: null,
  appliedScenarioId: "",
  salesforceReadyTimeout: null,
  initialSessionPreparing: false,
  initialSessionPrepared: false
};
const seenEventIds = new Set();
const lifecycle = createMessagingLifecycle({
  getApi: () => window.embeddedservice_bootstrap
});

// Salesforce lifecycle listeners must exist before its bootstrap is injected.
window.addEventListener("onEmbeddedMessagingReady", handleMessagingReady);
window.addEventListener(
  "onEmbeddedMessagingButtonCreated",
  handleMessagingButtonCreated
);
window.addEventListener(
  "onEmbeddedMessagingConversationOpened",
  handleConversationOpened
);
window.addEventListener(
  "onEmbeddedMessagingConversationStarted",
  handleConversationStarted
);
window.addEventListener(
  "onEmbeddedMessagingConversationClosed",
  handleConversationClosed
);
window.addEventListener(
  "onEmbeddedMessagingSessionStatusUpdate",
  handleSessionStatusUpdate
);
window.addEventListener(
  "onEmbeddedMessagingFirstBotMessageSent",
  handleFirstBotMessage
);
window.addEventListener("onEmbeddedMessagingWindowClosed", handleWindowClosed);

initialize();

function initialize() {
  for (const scenario of SCENARIO_LIST) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.label;
    elements.scenarioSelect.append(option);
  }

  elements.scenarioSelect.value = SCENARIO_LIST[0].id;
  elements.scenarioSelect.addEventListener("change", handleScenarioChange);
  elements.sendButton.addEventListener("click", () => void sendContext());
  elements.reloadButton.addEventListener("click", () => void resetHost());
  elements.copyButton.addEventListener("click", copyPayload);
  elements.clearLogButton.addEventListener("click", () =>
    elements.eventLog.replaceChildren()
  );

  refreshPreview();
  setHostStatus("Loading", "waiting");
  setReceiverStatus("Starting", "waiting");
  addLog("Simulator ready. Connecting directly to Salesforce.", "info");
  addReceiverLog("Loading the published Agentforce deployment.", "info");
  initializeSalesforceAdapter();
}

function refreshPreview() {
  const scenario = selectedScenario();
  state.envelope = buildContextEnvelope(scenario);

  elements.scenarioDetail.replaceChildren(
    element("strong", scenario.shortLabel),
    element("p", scenario.summary),
    element("p", scenario.expected, "expected-copy")
  );
  elements.expectedBadge.textContent =
    scenario.expectedResult === "accepted" ? "Expected: accept" : "Expected: reject";
  elements.expectedBadge.className = `status-chip ${
    scenario.expectedResult === "accepted" ? "success" : "danger"
  }`;
  elements.payloadPreview.textContent = JSON.stringify(state.envelope, null, 2);
}

async function sendContext() {
  const currentState = lifecycle.snapshot();
  if (!currentState.ready || currentState.busy) {
    addLog("Salesforce is not ready; nothing was submitted.", "error");
    return;
  }

  state.envelope = buildContextEnvelope(selectedScenario());
  elements.payloadPreview.textContent = JSON.stringify(state.envelope, null, 2);
  setControlsForOperation(true);
  setHostStatus("Validating", "waiting");
  addLog(`Validating fixed scenario “${state.envelope.scenarioId}”.`, "sent");

  const result = validateContextEvent({
    data: state.envelope,
    origin: window.location.origin,
    source: window,
    expectedOrigin: window.location.origin,
    expectedSource: window
  });

  if (!result.ok) {
    showRejected(result);
    setControlsForOperation(false);
    return;
  }

  if (seenEventIds.has(state.envelope.eventId)) {
    showRejected({
      ok: false,
      code: "REPLAY_REJECTED",
      message: "The event ID has already been processed.",
      stage: "schema"
    });
    setControlsForOperation(false);
    return;
  }
  seenEventIds.add(state.envelope.eventId);

  elements.originState.textContent = "Accepted";
  elements.schemaState.textContent = "Accepted";
  elements.acceptedEnvelope.textContent = JSON.stringify(state.envelope, null, 2);

  try {
    if (result.scenario.id === "logout") {
      setHostStatus("Clearing", "waiting");
      setAdapterState("Ending conversation", "muted-text");
      await lifecycle.reset();
      state.appliedScenarioId = "";
      showCleared(
        "Logout accepted",
        "Salesforce ended the conversation and cleared its browser session."
      );
      return;
    }

    setHostStatus("Starting chat", "waiting");
    setReceiverStatus("Connecting", "waiting");
    setAdapterState("Preparing scenario context", "muted-text");
    addReceiverLog(
      "Applying the validated scenario through hidden pre-chat and opening Agentforce.",
      "sent"
    );
    await applyScenarioToSalesforce(state.envelope);
    state.appliedScenarioId = result.scenario.id;
    showAccepted(
      "Agentforce chat opened",
      "The scenario was validated and supplied through hidden pre-chat. Complete any visible pre-chat prompts inside the chat."
    );
    elements.hostPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showRejected({
      ok: false,
      code: "BRIDGE_OR_ADAPTER_FAILED",
      message: customerSafeError(error),
      stage: "adapter"
    });
  } finally {
    setControlsForOperation(false);
  }
}

async function applyScenarioToSalesforce(envelope) {
  if (SALESFORCE_CONFIG.sandboxScenarioIngress.enabled) {
    await lifecycle.startConversation({
      conversationKey: envelope.scenarioId,
      hiddenPrechatFields: {
        [SALESFORCE_CONFIG.sandboxScenarioIngress.hiddenPrechatScenarioField]:
          envelope.scenarioId
      }
    });
    return;
  }

  if (!SALESFORCE_CONFIG.bridge.enabled) {
    throw new Error("The Salesforce context adapter is disabled.");
  }

  const bridgeResponse = await exchangeOpaqueContext(envelope);
  await lifecycle.startConversation({
    conversationKey: envelope.scenarioId,
    hiddenPrechatFields: {
      [SALESFORCE_CONFIG.enhancedWebChat.hiddenPrechatContextField]:
        bridgeResponse.mallContextToken
    },
    beforeLaunch: async (api) => {
      if (bridgeResponse.mode !== "verified") {
        return;
      }
      if (!api.userVerificationAPI?.setIdentityToken || !bridgeResponse.identityToken) {
        throw new Error("The Salesforce user-verification API or token is unavailable.");
      }
      api.userVerificationAPI.setIdentityToken({
        identityTokenType: "JWT",
        identityToken: bridgeResponse.identityToken
      });
    }
  });
}

async function resetHost() {
  const currentState = lifecycle.snapshot();
  if (!currentState.ready) {
    window.location.reload();
    return;
  }
  if (currentState.busy) {
    return;
  }

  setControlsForOperation(true);
  setHostStatus("Clearing", "waiting");
  setReceiverStatus("Clearing", "waiting");
  setAdapterState("Ending conversation", "muted-text");
  addLog("Ending and clearing the Salesforce session.", "sent");
  addReceiverLog("Reset requested through the official clearSession API.", "sent");

  try {
    await lifecycle.reset();
    state.appliedScenarioId = "";
    elements.originState.textContent = "Pending";
    elements.schemaState.textContent = "Pending";
    elements.acceptedEnvelope.textContent = "No event accepted.";
    setHostStatus("Ready", "success");
    setReceiverStatus("Ready", "success");
    setAdapterState("Enhanced Web Chat ready", "success-text");
    elements.receiverTitle.textContent = "Fresh Agentforce session ready";
    elements.receiverMessage.textContent =
      "Select a scenario and start a new website conversation.";
    addLog("Salesforce session boundary cleared.", "received");
  } catch (error) {
    setHostStatus("Reset failed", "danger");
    setReceiverStatus("Reset failed", "danger");
    setAdapterState("Reset failed", "danger-text");
    elements.receiverTitle.textContent = "Salesforce session reset failed";
    elements.receiverMessage.textContent = customerSafeError(error);
    addLog(customerSafeError(error), "error");
  } finally {
    setControlsForOperation(false);
  }
}

function handleScenarioChange() {
  refreshPreview();
  if (state.appliedScenarioId) {
    addLog("Scenario changed; clearing the previous conversation automatically.", "info");
    void resetHost();
  }
}

async function copyPayload() {
  try {
    await navigator.clipboard.writeText(elements.payloadPreview.textContent);
    elements.copyButton.textContent = "Copied";
    setTimeout(() => {
      elements.copyButton.textContent = "Copy JSON";
    }, 1200);
  } catch {
    addLog("Clipboard access was unavailable. Select the JSON manually.", "error");
  }
}

function handleMessagingReady() {
  lifecycle.handleReady();
  addReceiverLog("Salesforce emitted onEmbeddedMessagingReady.", "received");
  updateSalesforceClientReadiness();
}

function handleMessagingButtonCreated() {
  lifecycle.handleButtonCreated();
  addReceiverLog(
    "Salesforce emitted onEmbeddedMessagingButtonCreated; Launch Chat is available.",
    "received"
  );
  updateSalesforceClientReadiness();
}

function updateSalesforceClientReadiness() {
  const currentState = lifecycle.snapshot();
  if (!currentState.ready) {
    setAdapterState(
      currentState.apiReady
        ? "API ready · waiting for chat client"
        : "Chat client created · waiting for API",
      "muted-text"
    );
    setReceiverStatus("Initializing", "waiting");
    setHostStatus("Loading", "waiting");
    setControlsForOperation(false);
    return;
  }

  clearTimeout(state.salesforceReadyTimeout);
  if (!state.initialSessionPrepared) {
    if (!state.initialSessionPreparing) {
      void prepareInitialSessionBoundary();
    }
    return;
  }

  showSalesforceClientReady();
}

async function prepareInitialSessionBoundary() {
  state.initialSessionPreparing = true;
  setHostStatus("Clearing old session", "waiting");
  setReceiverStatus("Preparing", "waiting");
  setAdapterState("Removing any restored conversation", "muted-text");
  elements.receiverTitle.textContent = "Preparing a fresh Agentforce session";
  elements.receiverMessage.textContent =
    "The simulator is clearing any Salesforce conversation restored by this browser.";
  setControlsForOperation(true);
  addReceiverLog(
    "Clearing the browser's persisted Salesforce Messaging session before testing.",
    "sent"
  );

  try {
    await lifecycle.reset();
    state.initialSessionPrepared = true;
    addReceiverLog("A clean Salesforce session boundary is ready.", "received");
    showSalesforceClientReady();
  } catch (error) {
    setHostStatus("Session cleanup failed", "danger");
    setReceiverStatus("Setup failed", "danger");
    setAdapterState("Could not clear restored session", "danger-text");
    elements.receiverTitle.textContent = "Salesforce session cleanup failed";
    elements.receiverMessage.textContent = customerSafeError(error);
    addReceiverLog(customerSafeError(error), "error");
  } finally {
    state.initialSessionPreparing = false;
    setControlsForOperation(false);
  }
}

function showSalesforceClientReady() {
  setAdapterState("Enhanced Web Chat ready", "success-text");
  setReceiverStatus("Ready", "success");
  setHostStatus("Ready", "success");
  elements.receiverTitle.textContent = "Salesforce Agentforce is ready";
  elements.receiverMessage.textContent =
    "Choose a fixed scenario and select Start scenario and open chat.";
  setControlsForOperation(false);
}

function handleConversationOpened() {
  lifecycle.handleConversationOpened();
  addReceiverLog("A Salesforce conversation was opened in this browser tab.", "received");
}

function handleConversationStarted(event) {
  lifecycle.handleConversationStarted(event.detail ?? {});
  const conversationId = event.detail?.conversationId;
  setAdapterState("Conversation connected", "success-text");
  setReceiverStatus("Connected", "success");
  setHostStatus("Connected", "success");
  addReceiverLog(
    conversationId
      ? `Salesforce started conversation ${conversationId}.`
      : "Salesforce started a new conversation.",
    "received"
  );
}

function handleConversationClosed() {
  lifecycle.handleConversationClosed();
  state.appliedScenarioId = "";
  addReceiverLog("The Salesforce conversation ended.", "received");
  setControlsForOperation(false);
}

function handleSessionStatusUpdate(event) {
  const status = extractSessionStatus(event.detail);
  lifecycle.handleSessionStatus(status);
  addReceiverLog(`Messaging session status: ${status || "updated"}.`, "received");
  if (String(status).toLowerCase() === "ended") {
    state.appliedScenarioId = "";
    setHostStatus("Ended", "neutral");
    setReceiverStatus("Ended", "neutral");
    setAdapterState("Session ended · new scenario available", "muted-text");
    setControlsForOperation(false);
  }
}

function handleFirstBotMessage() {
  addReceiverLog("ALFRED sent the first Agentforce message.", "received");
}

function handleWindowClosed() {
  addReceiverLog("The Salesforce chat window closed.", "info");
}

function initializeSalesforceAdapter() {
  const config = SALESFORCE_CONFIG.enhancedWebChat;
  if (!config.enabled) {
    setAdapterState("Disabled safely", "muted-text");
    addReceiverLog("Salesforce adapter disabled by explicit configuration.", "info");
    return;
  }

  const requiredValues = [
    config.bootstrapUrl,
    config.orgId,
    config.deploymentName,
    config.siteUrl,
    config.scrt2Url
  ];
  if (requiredValues.some((value) => !value)) {
    setAdapterState("Configuration incomplete", "danger-text");
    setReceiverStatus("Setup failed", "danger");
    addReceiverLog("Salesforce deployment coordinates are incomplete.", "error");
    return;
  }

  const script = document.createElement("script");
  script.src = config.bootstrapUrl;
  script.async = true;
  script.addEventListener("load", () => {
    try {
      window.embeddedservice_bootstrap.settings.language = config.language;
      window.embeddedservice_bootstrap.settings.hideChatButtonOnLoad = true;
      // Agentforce_Messaging is currently Web v1. Do not set v2-only inline mode here.
      window.embeddedservice_bootstrap.init(
        config.orgId,
        config.deploymentName,
        config.siteUrl,
        { scrt2URL: config.scrt2Url }
      );
      setAdapterState("Initializing", "muted-text");
      state.salesforceReadyTimeout = setTimeout(() => {
        if (lifecycle.snapshot().ready) {
          return;
        }
        setAdapterState("Timed out · reload page", "danger-text");
        setReceiverStatus("Setup failed", "danger");
        setHostStatus("Setup failed", "danger");
        elements.receiverTitle.textContent = "Salesforce chat did not become ready";
        elements.receiverMessage.textContent =
          "Reload the simulator. If this persists, inspect CORS and Trusted Domains.";
        addReceiverLog(
          "Enhanced Web Chat did not report ready within 20 seconds.",
          "error"
        );
      }, SALESFORCE_READY_TIMEOUT_MS);
    } catch {
      setAdapterState("Initialization failed", "danger-text");
      setReceiverStatus("Setup failed", "danger");
      addReceiverLog("Enhanced Web Chat initialization failed.", "error");
    }
  });
  script.addEventListener("error", () => {
    setAdapterState("Bootstrap blocked", "danger-text");
    setReceiverStatus("Setup failed", "danger");
    addReceiverLog("Enhanced Web Chat bootstrap script did not load.", "error");
  });
  document.head.append(script);
}

async function exchangeOpaqueContext(envelope) {
  const { exchangeUrl, timeoutMilliseconds } = SALESFORCE_CONFIG.bridge;
  if (!exchangeUrl) {
    throw new Error("The trusted bridge URL is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(exchangeUrl, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: envelope.scenarioId,
        demoToken: envelope.demoToken,
        eventId: envelope.eventId,
        issuedAt: envelope.issuedAt
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`The trusted bridge returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (
      !payload ||
      !["guest", "verified"].includes(payload.mode) ||
      typeof payload.mallContextToken !== "string" ||
      (payload.mode === "verified" && typeof payload.identityToken !== "string")
    ) {
      throw new Error("The trusted bridge response does not match the contract.");
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function showAccepted(title, message) {
  setHostStatus("Chat open", "success");
  setReceiverStatus("Open", "success");
  setAdapterState("Scenario supplied · chat launched", "success-text");
  elements.receiverTitle.textContent = title;
  elements.receiverMessage.textContent = message;
  addLog(message, "received");
  addReceiverLog(message, "received");
}

function showCleared(title, message) {
  setHostStatus("Ready", "success");
  setReceiverStatus("Ready", "success");
  setAdapterState("Session cleared", "success-text");
  elements.receiverTitle.textContent = title;
  elements.receiverMessage.textContent = message;
  addLog(message, "received");
  addReceiverLog(message, "received");
}

function showRejected(result) {
  setHostStatus("Rejected", "danger");
  setReceiverStatus("Rejected", "danger");
  elements.receiverTitle.textContent = "Context rejected";
  elements.receiverMessage.textContent = `${result.code}: ${result.message}`;
  if (result.stage === "origin") {
    elements.originState.textContent = "Rejected";
  } else if (result.stage === "schema") {
    elements.originState.textContent = "Accepted";
    elements.schemaState.textContent = "Rejected";
  }
  addLog(`${result.code}: ${result.message}`, "error");
  addReceiverLog(`${result.code}: ${result.message}`, "error");
}

function setControlsForOperation(forcedBusy) {
  const currentState = lifecycle.snapshot();
  const busy = forcedBusy || currentState.busy;
  elements.scenarioSelect.disabled = busy;
  elements.sendButton.disabled =
    busy || !currentState.ready || Boolean(state.appliedScenarioId);
  elements.reloadButton.disabled = busy;
}

function selectedScenario() {
  return SCENARIO_LIST.find((scenario) => scenario.id === elements.scenarioSelect.value);
}

function setHostStatus(label, variant) {
  elements.hostStatus.textContent = label;
  elements.hostStatus.className = `status-chip ${variant}`;
}

function setReceiverStatus(label, variant) {
  elements.receiverStatus.textContent = label;
  elements.receiverStatus.className = `status-chip ${variant}`;
}

function setAdapterState(label, className) {
  elements.adapterState.textContent = label;
  elements.adapterState.className = className;
}

function addLog(message, variant) {
  addLogEntry(elements.eventLog, message, variant);
}

function addReceiverLog(message, variant) {
  addLogEntry(elements.receiverLog, message, variant);
}

function addLogEntry(target, message, variant) {
  const entry = document.createElement("li");
  const timestamp = document.createElement("time");
  timestamp.dateTime = new Date().toISOString();
  timestamp.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const text = document.createElement("span");
  text.textContent = message;
  entry.className = `log-${variant}`;
  entry.append(timestamp, text);
  target.prepend(entry);
}

function extractSessionStatus(detail) {
  return (
    detail?.status ??
    detail?.data?.status ??
    detail?.conversationEntry?.entryPayload?.status ??
    ""
  );
}

function element(tagName, text, className = "") {
  const node = document.createElement(tagName);
  node.textContent = text;
  if (className) {
    node.className = className;
  }
  return node;
}

function customerSafeError(error) {
  if (error?.name === "AbortError") {
    return "The trusted bridge did not respond within the configured time.";
  }
  return error instanceof Error ? error.message : "The adapter could not apply the context.";
}
