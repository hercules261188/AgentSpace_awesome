import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  didKeyFromPublicKey,
  employeeToPersona,
  slugifyPersonaId,
  verifyPersonaSignature,
} from "./openagent-persona.ts";
import type { ActiveEmployee } from "./workspace.ts";

const employee: ActiveEmployee = {
  name: "Atlas",
  role: "Research Lead",
  remarkName: "阿特拉斯",
  ownerUserId: "user-42",
  origin: "手动创建",
  summary: "Digs through papers and surfaces the load-bearing claims.",
  traits: ["rigorous", "curious"],
  fit: "Deep-dive research and synthesis.",
  skillIds: [],
  channels: ["research"],
  status: "active",
  instructions: "Cite sources. Flag uncertainty explicitly.",
};

const skills = ["literature-review", "citation-check"];

test("employeeToPersona maps required OpenAgent v0.2 fields", () => {
  const { persona } = employeeToPersona(employee, skills);

  assert.equal(persona.openagent, "0.2");
  assert.equal(persona.id, "atlas");
  assert.match(persona.id, /^[a-z0-9-]+$/);
  assert.equal(persona.name, "Atlas");
  assert.equal(persona.role, "Research Lead (阿特拉斯)");
  assert.equal(persona.org?.name, "AgentSpace (user-42)");

  // Required v0.2 fields must all be present and non-empty.
  assert.ok(persona.behavior.length > 0);
  assert.ok(persona.face.ref.length > 0);
  assert.match(persona.face.anchor, /^#[0-9a-f]{6}$/);
  assert.ok((persona.voice.written?.rules.length ?? 0) >= 1);
  assert.ok((persona.voice.written?.sample.length ?? 0) > 0);

  // Traits + resolved skills flow into posts_about (deduped).
  assert.deepEqual(persona.posts_about, ["rigorous", "curious", "literature-review", "citation-check"]);
});

test("slugifyPersonaId always yields a schema-valid id", () => {
  assert.equal(slugifyPersonaId("Nova Prime!"), "nova-prime");
  assert.equal(slugifyPersonaId("阿特拉斯"), "agent");
  assert.match(slugifyPersonaId("  --Weird__Name-- "), /^[a-z0-9-]+$/);
});

test("employeeToPersona without --sign carries no provenance", () => {
  const { persona, didKey } = employeeToPersona(employee, skills, { sign: false });
  assert.equal(persona.provenance, undefined);
  assert.equal(didKey, undefined);
});

test("signed export mints a did:key and a self-verifying provenance block", () => {
  const keyPair = generateKeyPairSync("ed25519");
  const { persona, didKey } = employeeToPersona(employee, skills, {
    sign: true,
    now: "2026-07-03T00:00:00.000Z",
    keyPair,
  });

  assert.ok(persona.provenance);
  assert.equal(persona.provenance?.signed_at, "2026-07-03T00:00:00.000Z");
  assert.ok(persona.provenance?.created_by.key.includes("BEGIN PUBLIC KEY"));
  assert.ok(persona.provenance?.signature);

  assert.equal(didKey, didKeyFromPublicKey(keyPair.publicKey));
  assert.match(didKey ?? "", /^did:key:z6Mk/);

  // The signature verifies against created_by.key, exactly as @5dive/openagent does.
  assert.equal(verifyPersonaSignature(persona), true);
});

test("tampering with a signed persona breaks verification", () => {
  const { persona } = employeeToPersona(employee, skills, { sign: true });
  persona.behavior = `${persona.behavior} (tampered)`;
  assert.equal(verifyPersonaSignature(persona), false);
});
