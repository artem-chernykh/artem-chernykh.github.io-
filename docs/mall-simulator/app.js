import { SCENARIO_LIST } from "./demo-scenarios.js";
import {
  READY_EVENT_TYPE,
  RESULT_EVENT_TYPE,
  buildContextEnvelope
} from "./protocol.js";

const elements = {
  scenarioSelect: document.querySelector("#scenario-select"),
  scenarioDetail: document.querySelector("#scenario-detail"),
  expectedBadge: document.querySelector("#expected-badge"),
  sendButton: document.querySelector("#send-button"),
  reloadButton: document.querySelector("#reload-button"),
  copyButton: document.querySelector("#copy-button"),
  payloadPreview: document.querySelector("#payload-preview"),
  hostPanel: document.querySelector(".host-panel"),
  frame: document.querySelector("#agent-host"),
  hostStatus: document.querySelector("#host-status"),
  eventLog: document.querySelector("#event-log"),
  clearLogButton: document.querySelector("#clear-log-button")
};

const state = {
  hostReady: false,
  envelope: null,
  appliedScenarioId: "",
  resetEventId: ""
};

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
  elements.sendButton.addEventListener("click", sendContext);
  elements.reloadButton.addEventListener("click", resetHost);
  elements.copyButton.addEventListener("click", copyPayload);
  elements.clearLogButton.addEventListener("click", () => elements.eventLog.replaceChildren());
  elements.frame.addEventListener("load", () => {
    state.hostReady = false;
    elements.sendButton.disabled = true;
    setHostStatus("Waiting", "waiting");
  });
  window.addEventListener("message", receiveHostMessage);

  refreshPreview();
  addLog("Simulator ready. Waiting for the isolated host.", "info");
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

function sendContext() {
  if (!state.hostReady || !elements.frame.contentWindow) {
    addLog("The host is not ready; nothing was sent.", "error");
    return;
  }

  // Rebuild immediately before transmission so ordinary scenarios are fresh.
  state.envelope = buildContextEnvelope(selectedScenario());
  elements.payloadPreview.textContent = JSON.stringify(state.envelope, null, 2);
  elements.frame.contentWindow.postMessage(state.envelope, window.location.origin);
  elements.sendButton.disabled = true;
  addLog(`Sent fixed scenario “${state.envelope.scenarioId}”.`, "sent");
  setHostStatus("Validating", "waiting");
}

function resetHost() {
  if (state.hostReady && elements.frame.contentWindow) {
    const logoutScenario = SCENARIO_LIST.find((scenario) => scenario.id === "logout");
    const logoutEnvelope = buildContextEnvelope(logoutScenario);
    state.resetEventId = logoutEnvelope.eventId;
    elements.frame.contentWindow.postMessage(logoutEnvelope, window.location.origin);
    elements.sendButton.disabled = true;
    setHostStatus("Clearing", "waiting");
    addLog("Ending and clearing the Salesforce session before reset.", "sent");
    return;
  }

  reloadHostFrame();
}

function reloadHostFrame() {
  state.hostReady = false;
  state.appliedScenarioId = "";
  state.resetEventId = "";
  elements.sendButton.disabled = true;
  elements.frame.src = `agent-host.html?v=20260805.3&reset=${Date.now()}`;
  setHostStatus("Loading", "waiting");
  addLog("Agent host reset after the prior Salesforce session boundary was cleared.", "info");
}

function handleScenarioChange() {
  refreshPreview();
  if (state.appliedScenarioId) {
    addLog("Scenario changed; clearing the previous conversation automatically.", "info");
    resetHost();
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

function receiveHostMessage(event) {
  if (event.origin !== window.location.origin || event.source !== elements.frame.contentWindow) {
    return;
  }
  if (!event.data || typeof event.data !== "object") {
    return;
  }

  if (event.data.type === READY_EVENT_TYPE) {
    state.hostReady = true;
    elements.sendButton.disabled = false;
    setHostStatus("Ready", "success");
    addLog("Host ready; exact origin and source window confirmed.", "received");
    return;
  }

  if (event.data.type === RESULT_EVENT_TYPE) {
    const accepted = event.data.ok === true;

    if (state.resetEventId && event.data.eventId === state.resetEventId) {
      if (accepted && event.data.code === "LOGOUT_ACCEPTED") {
        reloadHostFrame();
      } else {
        state.resetEventId = "";
        elements.sendButton.disabled = !state.hostReady;
        setHostStatus("Reset failed", "danger");
        addLog(`Reset failed: ${event.data.code} — ${event.data.message}`, "error");
      }
      return;
    }

    if (accepted && event.data.eventId === state.envelope?.eventId) {
      state.appliedScenarioId =
        state.envelope.scenarioId === "logout" ? "" : state.envelope.scenarioId;
      elements.hostPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setHostStatus(accepted ? "Accepted" : "Rejected", accepted ? "success" : "danger");
    elements.sendButton.disabled = accepted && Boolean(state.appliedScenarioId);
    addLog(
      `${accepted ? "Accepted" : "Rejected"}: ${event.data.code} — ${event.data.message}`,
      accepted ? "received" : "error"
    );
  }
}

function selectedScenario() {
  return SCENARIO_LIST.find((scenario) => scenario.id === elements.scenarioSelect.value);
}

function setHostStatus(label, variant) {
  elements.hostStatus.textContent = label;
  elements.hostStatus.className = `status-chip ${variant}`;
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
  elements.eventLog.prepend(entry);
}

function element(tagName, text, className = "") {
  const node = document.createElement(tagName);
  node.textContent = text;
  if (className) {
    node.className = className;
  }
  return node;
}
