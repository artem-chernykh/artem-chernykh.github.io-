// This is the only file that should contain environment-specific Salesforce
// deployment coordinates. It must never contain a private key, OAuth client
// secret, password, long-lived access token or real customer data.

const bridge = Object.freeze({
  enabled: false,
  // Example: "https://alfred-mall-demo.example.test/context/exchange"
  exchangeUrl: "",
  timeoutMilliseconds: 8000
});

const sandboxScenarioIngress = Object.freeze({
  enabled: true,
  // The public demo may send only the fixed scenario ID after the local
  // protocol checks pass. Salesforce resolves every identity, role and
  // authorization value from sandbox-locked Custom Metadata.
  hiddenPrechatScenarioField: "MallSimulationScenarioId"
});

const enhancedWebChat = Object.freeze({
  enabled: true,
  // Public deployment coordinates from the IBM development sandbox. They are
  // not credentials. The SCRT host remains sandbox-specific.
  bootstrapUrl:
    "https://flender.my.site.com/ESWAgentforceMessaging1771957419228/assets/js/bootstrap.min.js",
  orgId: "00D9Z00000PX42hUAD",
  deploymentName: "Agentforce_Messaging",
  siteUrl: "https://flender.my.site.com/ESWAgentforceMessaging1771957419228",
  scrt2Url: "https://flender--ibmdev.sandbox.my.salesforce-scrt.com",
  language: "en_US",
  // Configure this as a hidden pre-chat field mapped to a Salesforce-side
  // resolver. The value is a signed/opaque context token, never raw trust data.
  hiddenPrechatContextField: "MallContextToken"
});

export const SALESFORCE_CONFIG = Object.freeze({
  // Blank means same-origin parent and child, which is correct for GitHub Pages
  // and the local static server. Never configure a wildcard.
  expectedParentOrigin: "",
  bridge,
  sandboxScenarioIngress,
  enhancedWebChat
});
