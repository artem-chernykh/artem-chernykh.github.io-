const scenario = (definition) => Object.freeze(definition);

export const DEMO_SCENARIOS = Object.freeze({
  guest: scenario({
    id: "guest",
    label: "Guest",
    shortLabel: "Guest",
    demoToken: "demo_ctx_2cf1659a_45c4_4d7a_9bf7_55ee3b0bb201",
    summary: "A visitor has no active Mall login.",
    expected: "Accepted for server-side Guest resolution.",
    expectedResult: "accepted"
  }),
  "standard-known": scenario({
    id: "standard-known",
    label: "Authenticated · standard user · known",
    shortLabel: "Standard known",
    demoToken: "demo_ctx_3bd61469_c2de_478e_a7d5_8ad6c15205a2",
    summary: "A fixed fake standard-user profile is selected by the demo bridge.",
    expected: "Accepted; identity and permissions must be resolved server-side.",
    expectedResult: "accepted"
  }),
  "partner-known": scenario({
    id: "partner-known",
    label: "Authenticated · partner user · known",
    shortLabel: "Partner known",
    demoToken: "demo_ctx_a94c47b1_7bc5_444b_a51d_14a192974a13",
    summary: "A fixed fake partner profile is selected by the demo bridge.",
    expected: "Accepted; no Partner role is asserted by the browser.",
    expectedResult: "accepted"
  }),
  "authenticated-unknown": scenario({
    id: "authenticated-unknown",
    label: "Authenticated · unknown Mall identifier",
    shortLabel: "Unknown ID",
    demoToken: "demo_ctx_885e779c_909b_4972_9495_9962386f0f24",
    summary: "Authentication succeeds, but customer matching is expected to return no match.",
    expected: "Accepted; authentication and customer matching remain separate.",
    expectedResult: "accepted"
  }),
  "quote-denied": scenario({
    id: "quote-denied",
    label: "Authenticated · quote authorization denied",
    shortLabel: "Quote denied",
    demoToken: "demo_ctx_f6c3c1d9_2703_44dc_a75c_c8b1e2f18835",
    summary: "A fixed server-side profile exercises the denied Quote decision.",
    expected: "Accepted; the denial decision is never supplied by this page.",
    expectedResult: "accepted"
  }),
  "multi-role": scenario({
    id: "multi-role",
    label: "Authenticated · multiple roles",
    shortLabel: "Multi-role",
    demoToken: "demo_ctx_506870bc_86ba_46e5_a422_f38b532e3cb6",
    summary: "The bridge returns multiple fixed fake roles for normalization in Salesforce.",
    expected: "Accepted; role precedence must come from approved configuration.",
    expectedResult: "accepted"
  }),
  stale: scenario({
    id: "stale",
    label: "Negative test · stale payload",
    shortLabel: "Stale",
    demoToken: "demo_ctx_11a77123_d0cb_4323_84a1_2fc51b2905c7",
    summary: "The timestamp is deliberately older than the receiver freshness window.",
    expected: "Rejected before any bridge or Salesforce call.",
    expectedResult: "rejected",
    staleByMilliseconds: 10 * 60 * 1000
  }),
  malformed: scenario({
    id: "malformed",
    label: "Negative test · forbidden trust flag",
    shortLabel: "Malformed",
    demoToken: "demo_ctx_bb345e41_a8c5_4215_885c_d49beb456908",
    summary: "The event deliberately includes a browser-supplied trust flag.",
    expected: "Rejected because the schema contains an unexpected field.",
    expectedResult: "rejected",
    forbiddenField: Object.freeze({ MallContextTrusted: true })
  }),
  logout: scenario({
    id: "logout",
    label: "Logout",
    shortLabel: "Logout",
    demoToken: "demo_ctx_08f02415_a304_4807_af4b_dd6629ea25f9",
    summary: "Ends the verified conversation and clears its browser session.",
    expected: "Accepted; the host clears the session instead of downgrading it in place.",
    expectedResult: "accepted"
  })
});

export const SCENARIO_LIST = Object.freeze(Object.values(DEMO_SCENARIOS));
