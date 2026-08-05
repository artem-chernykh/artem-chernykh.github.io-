import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIO_LIST } from "../demo-scenarios.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const simulatorDirectory = resolve(testDirectory, "..");

test("ships exactly the nine approved fixed demo scenarios", () => {
  assert.deepEqual(
    SCENARIO_LIST.map((scenario) => scenario.id),
    [
      "guest",
      "standard-known",
      "partner-known",
      "authenticated-unknown",
      "quote-denied",
      "multi-role",
      "stale",
      "malformed",
      "logout"
    ]
  );
});

test("enables only the sandbox scenario ingress and keeps the trusted bridge disabled", async () => {
  const config = await readFile(resolve(simulatorDirectory, "salesforce-config.js"), "utf8");
  assert.match(config, /const bridge = Object\.freeze\(\{\s*enabled: false/s);
  assert.match(config, /const sandboxScenarioIngress = Object\.freeze\(\{\s*enabled: true/s);
  assert.match(config, /const enhancedWebChat = Object\.freeze\(\{\s*enabled: true/s);
  assert.doesNotMatch(config, /-----BEGIN (?:RSA )?PRIVATE KEY-----/);
  assert.doesNotMatch(config, /clientSecret|privateKey|password\s*:/i);
  assert.match(config, /deploymentName: "Mall_Demo_Agentforce_Messaging"/);
  assert.match(config, /orgId: "00D9Z00000PX42h"/);
  assert.doesNotMatch(config, /orgId: "00D9Z00000PX42hUAD"/);
  assert.match(config, /ESWMallDemoAgentforceM1785964764088/);
  assert.doesNotMatch(config, /ESWAgentforceMessaging1771957419228/);
});

test("direct parent integration does not use postMessage plumbing", async () => {
  const source = await readFile(resolve(simulatorDirectory, "app.js"), "utf8");
  assert.doesNotMatch(source, /postMessage|contentWindow|window\.parent/);
});

test("references only local simulator assets in the public page", async () => {
  const page = await readFile(resolve(simulatorDirectory, "index.html"), "utf8");
  assert.doesNotMatch(page, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
});

test("embeds Salesforce directly and does not render the legacy host iframe", async () => {
  const [page, app, lifecycle] = await Promise.all(
    ["index.html", "app.js", "messaging-lifecycle.js"].map((name) =>
      readFile(resolve(simulatorDirectory, name), "utf8")
    )
  );

  assert.match(page, /id="salesforce-mount"/);
  assert.doesNotMatch(page, /<iframe\b|agent-host\.html|id="agent-host"/i);
  assert.match(app, /embeddedservice_bootstrap\.init/);
  assert.match(
    app,
    /embeddedservice_bootstrap\.settings\.restrictSessionOnMessagingChannel\s*=\s*true/
  );
  assert.match(lifecycle, /setHiddenPrechatFields/);
  assert.match(lifecycle, /launchChat\(\)/);
  assert.doesNotMatch(app, /displayMode\s*=\s*["']inline["']/);
});

test("registers lifecycle listeners before injecting Salesforce bootstrap", async () => {
  const app = await readFile(resolve(simulatorDirectory, "app.js"), "utf8");
  const readyListener = app.indexOf(
    'addEventListener("onEmbeddedMessagingReady"'
  );
  const buttonCreatedListener = app.indexOf(
    '"onEmbeddedMessagingButtonCreated"'
  );
  const bootstrapAppend = app.indexOf("document.head.append(script)");
  assert.ok(readyListener >= 0);
  assert.ok(buttonCreatedListener >= 0);
  assert.ok(bootstrapAppend >= 0);
  assert.ok(readyListener < bootstrapAppend);
  assert.ok(buttonCreatedListener < bootstrapAppend);
});

test("clears any browser-restored Messaging session before enabling scenarios", async () => {
  const app = await readFile(resolve(simulatorDirectory, "app.js"), "utf8");
  assert.match(app, /async function prepareInitialSessionBoundary\(\)/);
  assert.match(app, /await lifecycle\.reset\(\)/);
  assert.match(app, /initialSessionPrepared = true/);
  assert.match(app, /clearing any Salesforce conversation restored by this browser/i);
});

test("uses a Salesforce-compatible referrer policy and distinguishes Builder Preview", async () => {
  const page = await readFile(resolve(simulatorDirectory, "index.html"), "utf8");
  assert.match(page, /<meta name="referrer" content="origin"/);
  assert.doesNotMatch(page, /content="no-referrer"/);
  assert.match(page, /Do not switch to Agentforce Builder Preview/);
});
