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
});

test("never uses a wildcard postMessage target origin", async () => {
  const files = await Promise.all(
    ["app.js", "agent-host.js"].map((name) =>
      readFile(resolve(simulatorDirectory, name), "utf8")
    )
  );
  for (const source of files) {
    assert.doesNotMatch(source, /postMessage\s*\([^)]*,\s*["']\*["']/s);
  }
});

test("references only local simulator assets in the static HTML", async () => {
  const pages = await Promise.all(
    ["index.html", "agent-host.html"].map((name) =>
      readFile(resolve(simulatorDirectory, name), "utf8")
    )
  );
  for (const page of pages) {
    assert.doesNotMatch(page, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
  }
});

test("waits for Salesforce readiness and clears sessions between scenarios", async () => {
  const [host, parent] = await Promise.all(
    ["agent-host.js", "app.js"].map((name) =>
      readFile(resolve(simulatorDirectory, name), "utf8")
    )
  );

  assert.match(host, /onEmbeddedMessagingReady[\s\S]*announceReady\(\)/);
  assert.match(host, /activeScenarioId/);
  assert.match(host, /clearSession\(\{ shouldEndSession: true \}\)/);
  assert.match(parent, /resetEventId/);
  assert.match(parent, /Scenario changed; clearing the previous conversation automatically/);
});

test("opens the embedded website chat and distinguishes it from Builder Preview", async () => {
  const [host, page] = await Promise.all(
    ["agent-host.js", "index.html"].map((name) =>
      readFile(resolve(simulatorDirectory, name), "utf8")
    )
  );

  assert.match(host, /launchChat\(\{ shouldStartNewConversation: true \}\)/);
  assert.match(host, /Agentforce Builder Preview is a separate session/);
  assert.match(page, /Do not switch to Agentforce Builder Preview/);
});
