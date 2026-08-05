# ALFRED 2.0 Mall Context Simulator

This static site simulates the browser boundary between a Flender Mall page and
an ALFRED 2.0 Agentforce host. It is intended for the IBM development sandbox
and client demonstrations. It is not an authentication service.

The simulator deliberately sends only:

- a fixed `scenarioId`;
- an opaque, fake `demoToken`; and
- versioning, event ID and timestamp protocol fields.

It never sends a role, customer identifier, trusted flag or quote authorization
decision. Those values must be resolved by a trusted server and Salesforce.

## Files

| File | Purpose |
| --- | --- |
| `index.html` / `app.js` | Mall simulator, payload validation and direct Enhanced Web Chat adapter |
| `messaging-lifecycle.js` | Deterministic clear, fresh-ready, pre-chat and launch sequencing |
| `agent-host.html` / `agent-host.js` | Unreferenced historical iframe implementation; not part of the current runtime |
| `demo-scenarios.js` | Fixed fake scenario and token allowlist |
| `protocol.js` | Envelope creation and deterministic validation |
| `salesforce-config.js` | Only environment-specific Salesforce configuration file |
| `styles.css` | Shared responsive visual design |
| `tests/*.test.js` | Protocol, direct-embed and session lifecycle regression tests |

## Run locally

Serve the folder over HTTP. Do not open `index.html` through `file://`, because
file pages have an opaque `null` origin and cannot prove the parent origin.

```bash
python3 -m http.server 4173 --directory docs/mall-simulator
```

Then open <http://127.0.0.1:4173/>.

Run the protocol tests with:

```bash
cd docs/mall-simulator
npm test
```

## Fixed scenarios

1. Guest
2. Authenticated standard user with a known fake profile
3. Authenticated partner user with a known fake profile
4. Authenticated user with an unknown fake Mall identifier
5. Authenticated profile whose Quote route is denied server-side
6. Authenticated profile with multiple fake roles
7. Stale payload, expected to be rejected
8. Malformed payload containing a forbidden trust flag, expected to be rejected
9. Logout, which ends and clears a verified session boundary

The browser labels describe the intended test result, but those labels are not
part of the transmitted event. The opaque token is also not a credential; its
fixed values are visible in this public static code.

## Browser context contract

Valid messages contain exactly these fields:

```json
{
  "type": "flender.mall.context.v1",
  "version": 1,
  "eventId": "UUID",
  "issuedAt": "ISO-8601 timestamp",
  "scenarioId": "standard-known",
  "demoToken": "opaque fake value"
}
```

The page validates each locally generated demonstration envelope before any
Salesforce API call. It checks:

- the exact current page origin and source window;
- exact schema with no extra fields;
- protocol type and version;
- UUID and timestamp format;
- a 90-second freshness window and limited future clock skew;
- fixed scenario membership; and
- the matching fixed demo token.

It also rejects an event ID already processed in that page instance. Scenario
submission stays disabled until Salesforce emits both
`onEmbeddedMessagingReady` and `onEmbeddedMessagingButtonCreated`. Before the
button is enabled, the simulator calls `clearSession` once and waits for a fresh
Ready event so a browser-restored conversation cannot remain stuck reconnecting
or reuse old context. The first scenario then applies hidden pre-chat and calls
`launchChat`. Every later scenario repeats the clean session boundary before it
launches. A resolved
`launchChat` call means the client opened; the later Conversation Started event
is recorded as telemetry because a user may spend time in visible pre-chat.

## Current IBM development sandbox connection

`salesforce-config.js` contains only public deployment coordinates for the IBM
development sandbox. Enhanced Web Chat and the sandbox scenario ingress are
enabled. The trusted production bridge remains explicitly disabled.

After an envelope passes the page, schema, freshness, replay and fixed-token
checks, the direct adapter passes only `scenarioId` through hidden pre-chat as
`MallSimulationScenarioId`. The inbound Routing Flow stores that key on the
Messaging Session and routes to the isolated **ALFRED 2.0 Mall Demo** agent.
That agent resolves identity, roles, language and Quote authorization from
sandbox-locked Salesforce Custom Metadata.

Submitting an accepted scenario automatically opens the published Salesforce
chat directly on this page in floating Web v1 mode. Enter the test utterances
there. Agentforce Builder Preview is an
independent preview session: it has no website Messaging Session and cannot
inherit this simulator's hidden pre-chat values.

This direct mode is intentionally simulation-only. A public user can inspect
and replay its fixed keys, so it must never be interpreted as real login proof.

## Replace the simulator with the real Flender Mall

Before production integration:

1. Create or select an Enhanced Web Chat deployment for the sandbox. The current
   demo uses Web v1 floating mode. Upgrade deliberately to Web v2 before enabling
   the v2-only inline display mode.
2. Add the exact GitHub Pages origin to the deployment's approved web origins.
   Add `artem-chernykh.github.io` to the generated ESW site's **Trusted Domains
   for Inline Frames** and `https://artem-chernykh.github.io` to Salesforce
   CORS. Do not use a `*.github.io` wildcard.
3. Copy the real environment's public deployment values from Salesforce's
   generated code snippet into the website adapter.
4. Implement a small trusted bridge or authenticated Mall backend integration
   outside GitHub Pages. It must map only the
   fixed demo scenarios, enforce exact-origin CORS and rate limits, and return a
   short-lived Salesforce identity JWT plus an opaque/signed Mall context token.
5. Replace `MallSimulationScenarioId` with an opaque, signed or server-resolved
   context token mapped through a hidden pre-chat field to a
   Salesforce-side resolver.
6. Expose at most one API-write ingress variable, such as `MallContextToken`.
   Keep `MallContextTrusted`, roles, customer identity and authorization results
   internal. The resolver verifies issuer, audience, expiry, nonce/replay state
   and signature before populating them.
7. Republish the Enhanced Web Chat deployment after configuration changes.

The bridge response contract expected by `app.js` is:

```json
{
  "mode": "verified",
  "identityToken": "short-lived Salesforce user-verification JWT",
  "mallContextToken": "signed or opaque context token"
}
```

For a Guest response, use `"mode": "guest"` and omit `identityToken`.

Never put a private key, connected-app secret, Salesforce password, long-lived
access token or customer data in this repository or in browser JavaScript.

## Logout behavior

Logout calls the Enhanced Web Chat `clearSession` API with session ending
enabled. The simulator never changes an authenticated conversation to Guest in
place, because trusted variables from the old session could survive. Start a
fresh Guest conversation after logout.

## GitHub Pages

The repository already publishes the `docs` folder from `main`. The simulator
lives below `docs/mall-simulator`, so the standard Pages build exposes it at the
project site's `/mall-simulator/` path. The repository workflow runs regression
tests for each simulator change; GitHub's existing Pages build performs the
publication.

GitHub Pages is static hosting. It cannot safely sign JWTs, hold secrets, verify
a Mall login, execute OAuth client credentials, or provide a trusted CORS proxy.
GitHub Actions is also not a request/response runtime backend.

## Production handover

The final Flender Mall integration should replace the fixed `scenarioId` and fake
token with a short-lived token issued by the authenticated Mall backend. If the
Mall shell and chat adapter are separate windows or frames, use a versioned
`postMessage` event with an exact target origin, never `"*"`. If they run in the
same page, pass the opaque token directly to the adapter and retain the same
server-side trust resolution.
