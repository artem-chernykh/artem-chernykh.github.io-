const DEFAULT_READY_TIMEOUT_MS = 20000;

export function createMessagingLifecycle({
  getApi,
  readyTimeoutMilliseconds = DEFAULT_READY_TIMEOUT_MS
}) {
  let apiReady = false;
  let buttonCreated = false;
  let busy = false;
  let readyGeneration = 0;
  let readyCycleResolved = false;
  let conversationOpen = false;
  let sessionBoundaryUsed = false;
  let activeConversationKey = "";
  let lastConversationDetail = null;
  const readyWaiters = new Set();

  function handleReady() {
    apiReady = true;
    markClientReady();
  }

  function handleButtonCreated() {
    buttonCreated = true;
    markClientReady();
  }

  function markClientReady() {
    if (!apiReady || !buttonCreated || readyCycleResolved) {
      return;
    }
    readyCycleResolved = true;
    readyGeneration += 1;
    resolveWaiters(readyWaiters, readyGeneration, undefined);
  }

  function handleConversationOpened() {
    conversationOpen = true;
  }

  function handleConversationStarted(detail = {}) {
    conversationOpen = true;
    lastConversationDetail = detail;
  }

  function handleConversationClosed() {
    conversationOpen = false;
    activeConversationKey = "";
  }

  function handleSessionStatus(status) {
    const normalizedStatus = typeof status === "string" ? status.toLowerCase() : "";
    if (["active", "waiting"].includes(normalizedStatus)) {
      conversationOpen = true;
    }
    if (normalizedStatus === "ended") {
      handleConversationClosed();
    }
  }

  async function startConversation({
    conversationKey,
    hiddenPrechatFields,
    beforeLaunch
  }) {
    if (!isClientReady()) {
      throw new Error("Salesforce Enhanced Web Chat is not ready yet.");
    }
    if (!conversationKey || !isPlainObject(hiddenPrechatFields)) {
      throw new Error("The conversation context is incomplete.");
    }

    return runExclusive(async () => {
      // The first conversation on a freshly initialized page does not need a
      // destructive clear. Any subsequent conversation gets a new session
      // boundary so hidden pre-chat data can never leak between scenarios.
      if (sessionBoundaryUsed || conversationOpen || activeConversationKey) {
        await clearSessionBoundary();
      }

      const api = requireApi();
      if (!api.prechatAPI?.setHiddenPrechatFields) {
        throw new Error("The Salesforce hidden pre-chat API is unavailable.");
      }
      if (!api.utilAPI?.launchChat) {
        throw new Error("The Salesforce Launch Chat API is unavailable.");
      }

      api.prechatAPI.setHiddenPrechatFields(hiddenPrechatFields);
      if (beforeLaunch) {
        await beforeLaunch(api);
      }

      activeConversationKey = conversationKey;
      sessionBoundaryUsed = true;
      await api.utilAPI.launchChat();

      // launchChat resolves when the client opens. ConversationStarted can be
      // much later when a visible pre-chat form is enabled, so it is telemetry
      // only and must not turn a successful launch into a timeout failure.
      return Object.freeze({ launched: true, conversation: lastConversationDetail });
    });
  }

  async function reset() {
    if (!isClientReady()) {
      throw new Error("Salesforce Enhanced Web Chat is not ready to reset.");
    }
    return runExclusive(clearSessionBoundary);
  }

  async function clearSessionBoundary() {
    const api = requireApi();
    if (!api.userVerificationAPI?.clearSession) {
      throw new Error("The Salesforce session-clear API is unavailable.");
    }

    const previousReadyGeneration = readyGeneration;
    apiReady = false;
    readyCycleResolved = false;
    await api.userVerificationAPI.clearSession({ shouldEndSession: true });

    if (readyGeneration === previousReadyGeneration) {
      await waitForGeneration({
        waiters: readyWaiters,
        afterGeneration: previousReadyGeneration,
        timeoutMilliseconds: readyTimeoutMilliseconds,
        timeoutMessage: "Salesforce did not become ready after clearing the previous conversation."
      });
    }

    conversationOpen = false;
    sessionBoundaryUsed = false;
    activeConversationKey = "";
    lastConversationDetail = null;
  }

  async function runExclusive(operation) {
    if (busy) {
      throw new Error("Another Salesforce chat operation is already running.");
    }
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  }

  function requireApi() {
    const api = getApi();
    if (!api) {
      throw new Error("The Salesforce Enhanced Web Chat API is unavailable.");
    }
    return api;
  }

  function snapshot() {
    return Object.freeze({
      ready: isClientReady(),
      apiReady,
      buttonCreated,
      busy,
      conversationOpen,
      activeConversationKey,
      readyGeneration
    });
  }

  function isClientReady() {
    return apiReady && buttonCreated;
  }

  return Object.freeze({
    handleReady,
    handleButtonCreated,
    handleConversationOpened,
    handleConversationStarted,
    handleConversationClosed,
    handleSessionStatus,
    startConversation,
    reset,
    snapshot
  });
}

function waitForGeneration({
  waiters,
  afterGeneration,
  timeoutMilliseconds,
  timeoutMessage
}) {
  return new Promise((resolve, reject) => {
    const waiter = {
      afterGeneration,
      resolve,
      timeoutId: setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(timeoutMessage));
      }, timeoutMilliseconds)
    };
    waiters.add(waiter);
  });
}

function resolveWaiters(waiters, generation, value) {
  for (const waiter of waiters) {
    if (generation <= waiter.afterGeneration) {
      continue;
    }
    clearTimeout(waiter.timeoutId);
    waiters.delete(waiter);
    waiter.resolve(value);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
