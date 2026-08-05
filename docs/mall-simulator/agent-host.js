import { SALESFORCE_CONFIG } from "./salesforce-config.js";
import {
  READY_EVENT_TYPE,
  RESULT_EVENT_TYPE,
  validateContextEvent
} from "./protocol.js";

const elements = {
  receiverStatus: document.querySelector("#receiver-status"),
  receiverTitle: document.querySelector("#receiver-title"),
  receiverMessage: document.querySelector("#receiver-message"),
  originState: document.querySelector("#origin-state"),
  schemaState: document.querySelector("#schema-state"),
  adapterState: document.querySelector("#adapter-state"),
  acceptedEnvelope: document.querySelector("#accepted-envelope"),
  receiverLog: document.querySelector("#receiver-log")
};

const expectedParentOrigin =
  SALESFORCE_CONFIG.expectedParentOrigin || window.location.origin;
const seenEventIds = new Set();
let messagingReady = false;
let activeScenarioId = "";

window.addEventListener("message", receiveContextEvent);
window.addEventListener("onEmbeddedMessagingReady", () => {
  messagingReady = true;
  setAdapterState("Enhanced Web Chat ready", "success-text");
  addLog("Salesforce Enhanced Web Chat reported ready.", "received");
  announceReady();
});

const waitsForSalesforce = initializeSalesforceAdapter();
if (!waitsForSalesforce) {
  announceReady();
}

async function receiveContextEvent(event) {
  const result = validateContextEvent({
    data: event.data,
    origin: event.origin,
    source: event.source,
    expectedOrigin: expectedParentOrigin,
    expectedSource: window.parent
  });

  if (!result.ok) {
    showRejected(result);
    sendResult(event.data?.eventId, result);
    return;
  }

  if (seenEventIds.has(event.data.eventId)) {
    const replay = {
      ok: false,
      code: "REPLAY_REJECTED",
      message: "The event ID has already been processed.",
      stage: "schema"
    };
    showRejected(replay);
    sendResult(event.data.eventId, replay);
    return;
  }
  seenEventIds.add(event.data.eventId);

  elements.originState.textContent = "Accepted";
  elements.schemaState.textContent = "Accepted";
  elements.acceptedEnvelope.textContent = JSON.stringify(event.data, null, 2);

  if (result.scenario.id === "logout") {
    await handleLogout();
    const logoutResult = {
      ok: true,
      code: "LOGOUT_ACCEPTED",
      message: "The host cleared the verified session boundary."
    };
    showAccepted("Logout accepted", logoutResult.message);
    sendResult(event.data.eventId, logoutResult);
    return;
  }

  try {
    await applyScenarioToSalesforce(event.data);
    const accepted = {
      ok: true,
      code: SALESFORCE_CONFIG.sandboxScenarioIngress.enabled
        ? "SANDBOX_SCENARIO_SUPPLIED"
        : SALESFORCE_CONFIG.bridge.enabled
          ? "CONTEXT_EXCHANGED"
          : "CONTEXT_VALIDATED_DEMO_ONLY",
      message: SALESFORCE_CONFIG.sandboxScenarioIngress.enabled
        ? "The fixed scenario key was supplied to the sandbox Agentforce session."
        : SALESFORCE_CONFIG.bridge.enabled
          ? "The trusted bridge exchanged the opaque demo context."
          : "The envelope is valid; the Salesforce adapter remains safely disabled."
    };
    showAccepted("Context accepted", accepted.message);
    sendResult(event.data.eventId, accepted);
  } catch (error) {
    const bridgeFailure = {
      ok: false,
      code: "BRIDGE_OR_ADAPTER_FAILED",
      message: customerSafeError(error),
      stage: "adapter"
    };
    showRejected(bridgeFailure);
    sendResult(event.data.eventId, bridgeFailure);
  }
}

async function applyScenarioToSalesforce(envelope) {
  if (SALESFORCE_CONFIG.sandboxScenarioIngress.enabled) {
    await applySandboxScenario(envelope.scenarioId);
    return;
  }

  if (!SALESFORCE_CONFIG.bridge.enabled) {
    setAdapterState("Disabled safely", "muted-text");
    addLog("No bridge call made; configuration is disabled.", "info");
    return;
  }

  const bridgeResponse = await exchangeOpaqueContext(envelope);
  if (!SALESFORCE_CONFIG.enhancedWebChat.enabled) {
    throw new Error("Enhanced Web Chat is disabled in salesforce-config.js.");
  }
  if (!messagingReady) {
    throw new Error("Enhanced Web Chat is not ready yet.");
  }

  const prechatApi = window.embeddedservice_bootstrap?.prechatAPI;
  const verificationApi = window.embeddedservice_bootstrap?.userVerificationAPI;
  if (!prechatApi) {
    throw new Error("The Salesforce hidden pre-chat API is unavailable.");
  }

  prechatApi.setHiddenPrechatFields({
    [SALESFORCE_CONFIG.enhancedWebChat.hiddenPrechatContextField]:
      bridgeResponse.mallContextToken
  });

  if (bridgeResponse.mode === "verified") {
    if (!verificationApi || !bridgeResponse.identityToken) {
      throw new Error("The Salesforce user-verification API or token is unavailable.");
    }
    verificationApi.setIdentityToken({
      identityTokenType: "JWT",
      identityToken: bridgeResponse.identityToken
    });
  }

  setAdapterState("Context supplied", "success-text");
  addLog("Opaque context supplied to the Salesforce adapter.", "received");
}

async function applySandboxScenario(scenarioId) {
  const config = SALESFORCE_CONFIG.enhancedWebChat;
  if (!config.enabled) {
    throw new Error("Enhanced Web Chat is disabled in salesforce-config.js.");
  }
  if (!messagingReady) {
    throw new Error("Enhanced Web Chat is not ready yet.");
  }

  const prechatApi = window.embeddedservice_bootstrap?.prechatAPI;
  if (!prechatApi) {
    throw new Error("The Salesforce hidden pre-chat API is unavailable.");
  }
  if (activeScenarioId) {
    throw new Error(
      "A Mall scenario is already bound to this conversation. Reset the Agent host before switching scenarios."
    );
  }

  prechatApi.setHiddenPrechatFields({
    [SALESFORCE_CONFIG.sandboxScenarioIngress.hiddenPrechatScenarioField]: scenarioId
  });
  activeScenarioId = scenarioId;
  window.embeddedservice_bootstrap?.utilAPI?.showChatButton?.();
  setAdapterState("Scenario supplied · open chat", "success-text");
  addLog("Fixed scenario key supplied to hidden pre-chat; no trust data was sent.", "received");
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

async function handleLogout() {
  const verificationApi = window.embeddedservice_bootstrap?.userVerificationAPI;
  if (verificationApi?.clearSession) {
    await verificationApi.clearSession({ shouldEndSession: true });
    addLog("Salesforce verified session cleared and ended.", "received");
  } else {
    addLog("No live Salesforce session existed; local host state was cleared.", "info");
  }
  activeScenarioId = "";
  elements.acceptedEnvelope.textContent = "Session cleared. Start a new Guest conversation.";
  setAdapterState("Session cleared", "success-text");
}

function initializeSalesforceAdapter() {
  const config = SALESFORCE_CONFIG.enhancedWebChat;
  if (!config.enabled) {
    setAdapterState("Disabled safely", "muted-text");
    addLog("Salesforce adapter disabled by explicit configuration.", "info");
    return false;
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
    addLog("Salesforce deployment coordinates are incomplete.", "error");
    return true;
  }

  const script = document.createElement("script");
  script.src = config.bootstrapUrl;
  script.async = true;
  script.addEventListener("load", () => {
    try {
      window.embeddedservice_bootstrap.settings.language = config.language;
      window.embeddedservice_bootstrap.settings.hideChatButtonOnLoad = true;
      window.embeddedservice_bootstrap.init(
        config.orgId,
        config.deploymentName,
        config.siteUrl,
        { scrt2URL: config.scrt2Url }
      );
      setAdapterState("Initializing", "muted-text");
    } catch {
      setAdapterState("Initialization failed", "danger-text");
      addLog("Enhanced Web Chat initialization failed.", "error");
    }
  });
  script.addEventListener("error", () => {
    setAdapterState("Bootstrap blocked", "danger-text");
    addLog("Enhanced Web Chat bootstrap script did not load.", "error");
  });
  document.head.append(script);
  return true;
}

function announceReady() {
  setReceiverStatus("Ready", "success");
  elements.receiverTitle.textContent = "Receiver ready";
  elements.receiverMessage.textContent = `Only ${expectedParentOrigin} and the direct parent window are accepted.`;
  window.parent.postMessage(
    { type: READY_EVENT_TYPE, version: 1 },
    expectedParentOrigin
  );
  addLog("Ready message sent to the exact parent origin.", "sent");
}

function showAccepted(title, message) {
  setReceiverStatus("Accepted", "success");
  elements.receiverTitle.textContent = title;
  elements.receiverMessage.textContent = message;
  addLog(message, "received");
}

function showRejected(result) {
  setReceiverStatus("Rejected", "danger");
  elements.receiverTitle.textContent = "Context rejected";
  elements.receiverMessage.textContent = `${result.code}: ${result.message}`;
  if (result.stage === "origin") {
    elements.originState.textContent = "Rejected";
  } else {
    elements.originState.textContent = "Accepted";
    elements.schemaState.textContent = "Rejected";
  }
  addLog(`${result.code}: ${result.message}`, "error");
}

function sendResult(eventId, result) {
  window.parent.postMessage(
    {
      type: RESULT_EVENT_TYPE,
      version: 1,
      eventId: typeof eventId === "string" ? eventId : "",
      ok: result.ok,
      code: result.code,
      message: result.message
    },
    expectedParentOrigin
  );
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
  elements.receiverLog.prepend(entry);
}

function customerSafeError(error) {
  if (error?.name === "AbortError") {
    return "The trusted bridge did not respond within the configured time.";
  }
  return error instanceof Error ? error.message : "The adapter could not apply the context.";
}
