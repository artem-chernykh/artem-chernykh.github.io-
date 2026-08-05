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
| `index.html` / `app.js` | Parent Mall simulator and payload viewer |
| `agent-host.html` / `agent-host.js` | Isolated receiver and optional Enhanced Web Chat adapter |
| `demo-scenarios.js` | Fixed fake scenario and token allowlist |
| `protocol.js` | Envelope creation and deterministic validation |
| `salesforce-config.js` | Only environment-specific Salesforce configuration file |
| `styles.css` | Shared responsive visual design |
| `tests/protocol.test.js` | Protocol security regression tests |

## Run locally

Serve the folder over HTTP. Do not open `index.html` through `file://`, because
file pages have an opaque `null` origin and cannot prove the parent origin.

```bash
python3 -m http.server 4173 --directory mall-simulator
```

Then open <http://127.0.0.1:4173/>.

Run the protocol tests with:

```bash
cd mall-simulator
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

## Browser event contract

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

The child receiver checks:

- exact `event.origin`;
- exact `event.source === window.parent`;
- exact schema with no extra fields;
- protocol type and version;
- UUID and timestamp format;
- a 90-second freshness window and limited future clock skew;
- fixed scenario membership; and
- the matching fixed demo token.

It also rejects an event ID already processed in that host instance.

## Current IBM development sandbox connection

`salesforce-config.js` contains only public deployment coordinates for the IBM
development sandbox. Enhanced Web Chat and the sandbox scenario ingress are
enabled. The trusted production bridge remains explicitly disabled.

After a browser event passes the exact-origin, schema, freshness, replay and
fixed-token checks, the host passes only `scenarioId` through hidden pre-chat as
`MallSimulationScenarioId`. The inbound Routing Flow stores that key on the
Messaging Session and routes to the isolated **ALFRED 2.0 Mall Demo** agent.
That agent resolves identity, roles, language and Quote authorization from
sandbox-locked Salesforce Custom Metadata.

This direct mode is intentionally simulation-only. A public user can inspect
and replay its fixed keys, so it must never be interpreted as real login proof.

## Replace the simulator with the real Flender Mall

Before production integration:

1. Create or select an Enhanced Web Chat v2 deployment for the sandbox.
2. Add the exact GitHub Pages origin to the deployment's approved web origins.
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

The bridge response contract expected by `agent-host.js` is:

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

The repository-level workflow `.github/workflows/mall-simulator-pages.yml`
publishes after simulator changes are merged to `main` and can also be started
manually. Before its first run, configure GitHub Pages to use **GitHub Actions**
as the source and review the target repository's visibility. A private
repository does not automatically make its published site private on every
GitHub plan.

GitHub Pages is static hosting. It cannot safely sign JWTs, hold secrets, verify
a Mall login, execute OAuth client credentials, or provide a trusted CORS proxy.
GitHub Actions is also not a request/response runtime backend.

## Production handover

The final Flender Mall integration should keep the same versioned browser event,
but replace the fixed `scenarioId` and fake token with a short-lived token issued
from the authenticated Mall backend. The preferred `postMessage` approach lets
the Mall shell notify the chat adapter about both login and logout. Use an exact
target origin; never use `"*"`.
