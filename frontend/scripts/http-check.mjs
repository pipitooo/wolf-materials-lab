import assert from "node:assert/strict";

const base = "http://127.0.0.1:8084";
const post = (path, body, { origin = base, cookie = null } = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const evidence = (body, opts) => post("/api/evidence/", body, opts);

assert.equal(
  (await evidence({ action: "tick" }, { origin: "https://untrusted.example" }))
    .status,
  403,
);
assert.equal((await evidence({ action: "tick" })).status, 200);
assert.equal(
  (await evidence({ action: "deliver", market: "XK", version: "v2" })).status,
  409,
);
assert.equal(
  (await evidence({ action: "approve", findingId: "missing" })).status,
  401,
);

const signIn = await post("/api/auth/sign-in/", {
  email: "buyer@demo.local",
  password: "wolf-demo",
});
assert.equal(signIn.status, 200);
const cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
assert.ok(cookie.startsWith("wolf_session="));

assert.equal(
  (await evidence({ action: "approve", findingId: "missing" }, { cookie }))
    .status,
  409,
);

const me = await fetch(`${base}/api/auth/me/`, {
  headers: { Cookie: cookie },
});
assert.equal(me.status, 200);
assert.equal((await me.json()).user.email, "buyer@demo.local");

const response = await fetch(`${base}/api/evidence/`);
assert.equal(response.status, 200);
const state = await response.json();
assert.ok(Array.isArray(state.records));
assert.ok(
  state.events.every((e) => e.sources.every((s) => !Object.hasOwn(s, "text"))),
);
for (const route of [
  "/dashboard/",
  "/dashboard/nullmessung/",
  "/dashboard/evidence/",
  "/auth/sign-in",
])
  assert.equal((await fetch(base + route)).status, 200);

// Sourcing model: deterministic, and the AI agent must never modify values.
const supply1 = await (await fetch(`${base}/api/evidence/supply?product=WLF-1008`)).json();
assert.ok(supply1.markets.length === 29);
assert.ok(supply1.recommendations.length === 5);
const supply2 = await (await fetch(`${base}/api/evidence/supply?product=WLF-1008`)).json();
assert.deepEqual(supply1.markets, supply2.markets);
const evidenceBefore = await (
  await fetch(`${base}/api/evidence/`)
).json();
await post("/api/evidence/agent/", { findingId: "missing" }).catch(() => {});
const evidenceAfter = await (await fetch(`${base}/api/evidence/`)).json();
assert.deepEqual(evidenceAfter.records, evidenceBefore.records);

console.log(
  "PASS: same-origin writes, hostile origin rejection, typed API rejection, sign-in, unauthenticated approval guard, missing approval guard, snapshot redaction, auth/me, dashboard routes, deterministic sourcing model and AI no-write guarantee.",
);
