import {
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import type { ActiveEmployee } from "./workspace.ts";

/**
 * Map an AgentSpace Digital Employee onto an OpenAgent persona-card and
 * optionally sign it. OpenAgent (spec at github.com/5dive-ai/openagent) is an
 * identity/persona layer: it describes who an agent IS (name, role, face, voice,
 * behavior) and carries a self-verifying ed25519 provenance block. AgentSpace
 * already models the "who" as an ActiveEmployee, so the two compose — this is a
 * pure, dependency-free mapper plus a self-contained signer built on node:crypto.
 *
 * The emitted document validates against the OpenAgent v0.2 persona schema and
 * verifies with `npx @5dive/openagent validate` / provenance verify: the
 * canonicalisation, ed25519 signature and did:key derivation below mirror that
 * tool exactly, so no dependency on the (CommonJS CLI) package is required.
 */

export interface OpenAgentPersonaOrg {
  name: string;
  url?: string;
}

export interface OpenAgentPersonaFaceRecipe {
  provider?: string;
  model: string;
  prompt: string;
  seed?: number | string;
}

export interface OpenAgentPersonaFace {
  ref: string;
  anchor: string;
  recipe?: OpenAgentPersonaFaceRecipe;
}

export interface OpenAgentPersonaVoiceWritten {
  rules: string[];
  sample: string;
}

export interface OpenAgentPersonaVoice {
  written?: OpenAgentPersonaVoiceWritten;
}

export interface OpenAgentPersonaProvenanceAuthor {
  name?: string;
  key: string;
  url?: string;
}

export interface OpenAgentPersonaProvenance {
  created_by: OpenAgentPersonaProvenanceAuthor;
  signed_at: string;
  signature?: string;
}

export interface OpenAgentPersona {
  openagent: string;
  id: string;
  name: string;
  role: string;
  org?: OpenAgentPersonaOrg;
  behavior: string;
  posts_about?: string[];
  face: OpenAgentPersonaFace;
  voice: OpenAgentPersonaVoice;
  provenance?: OpenAgentPersonaProvenance;
}

export interface ExportPersonaOptions {
  /** Mint an ed25519 key at export and attach a signed provenance block. */
  sign?: boolean;
  /** Fixed timestamp (ISO 8601) for the provenance block; defaults to now. */
  now?: string;
  /** Deterministic keypair injection for tests. */
  keyPair?: { publicKey: KeyObject; privateKey: KeyObject };
}

export interface ExportPersonaResult {
  persona: OpenAgentPersona;
  /** The agent's canonical public address, e.g. "did:key:z6Mk…". Present when signed. */
  didKey?: string;
}

// ---- id slug ---------------------------------------------------------------

/** Slugify a display name to the persona `id` pattern ^[a-z0-9-]+$. */
export function slugifyPersonaId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

// ---- deterministic anchor colour -------------------------------------------

// A stable 6-hex-digit accent derived from the name — the card's anchor colour.
// FNV-1a keeps it dependency-free and reproducible across runs.
function anchorColor(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
  return `#${hex}`;
}

// ---- canonicalisation (mirrors @5dive/openagent lib/provenance.js) ----------

// Deterministic JSON: object keys sorted recursively, primitives via JSON.stringify.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The exact bytes a signature covers: the whole persona with
// provenance.signature removed. Round-trips through JSON to drop undefined.
function canonicalBytes(persona: OpenAgentPersona): Buffer {
  const clone = JSON.parse(JSON.stringify(persona)) as OpenAgentPersona;
  if (clone.provenance) {
    delete clone.provenance.signature;
  }
  return Buffer.from(stableStringify(clone), "utf8");
}

// ---- did:key address (multicodec ed25519-pub + base58btc) -------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcEncode(bytes: Buffer): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  const digits: number[] = [];
  for (let index = zeros; index < bytes.length; index += 1) {
    let carry = bytes[index];
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
      carry += digits[digitIndex] << 8;
      digits[digitIndex] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    out += BASE58_ALPHABET[digits[index]];
  }
  return out;
}

// Raw 32-byte ed25519 public key via JWK export (no hand-parsed SPKI offsets).
function rawEd25519PublicKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" }) as { crv?: string; x?: string };
  if (jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("did:key needs an Ed25519 public key");
  }
  const raw = Buffer.from(jwk.x, "base64url");
  if (raw.length !== 32) {
    throw new Error(`unexpected ed25519 key length: ${raw.length}`);
  }
  return raw;
}

/** Derive the did:key public address for an ed25519 public key. */
export function didKeyFromPublicKey(publicKey: KeyObject): string {
  const raw = rawEd25519PublicKey(publicKey);
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw]); // 0xed01 = ed25519-pub
  return `did:key:z${base58btcEncode(prefixed)}`;
}

// ---- mapping ----------------------------------------------------------------

function personaRole(employee: ActiveEmployee): string {
  const remark = employee.remarkName?.trim();
  return remark ? `${employee.role} (${remark})` : employee.role;
}

function personaBehavior(employee: ActiveEmployee): string {
  const parts = [employee.summary, employee.instructions, employee.fit]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(" ") || `${employee.name}, ${employee.role}.`;
}

function voiceRules(employee: ActiveEmployee, skills: string[]): string[] {
  const rules: string[] = [];
  if (employee.traits.length > 0) {
    rules.push(`Embodies: ${employee.traits.join(", ")}.`);
  }
  if (skills.length > 0) {
    rules.push(`Draws on skills: ${skills.join(", ")}.`);
  }
  if (employee.instructions?.trim()) {
    rules.push(employee.instructions.trim());
  }
  if (rules.length === 0) {
    rules.push(`Speaks as ${employee.role}.`);
  }
  return rules;
}

function facePrompt(employee: ActiveEmployee): string {
  const descriptors = employee.traits.length > 0 ? `, ${employee.traits.join(", ")}` : "";
  return `Portrait avatar of ${employee.name}, a ${employee.role}${descriptors}. Clean, friendly, professional character illustration.`;
}

/**
 * Map an ActiveEmployee onto an OpenAgent persona-card. Pure and deterministic
 * (given `opts.now`/`opts.keyPair`); `sign` mints an ed25519 identity and
 * attaches a self-verifying provenance block.
 */
export function employeeToPersona(
  employee: ActiveEmployee,
  skills: string[],
  opts: ExportPersonaOptions = {},
): ExportPersonaResult {
  const id = slugifyPersonaId(employee.name);
  const postsAbout = Array.from(new Set([...employee.traits, ...skills])).filter(Boolean);

  const persona: OpenAgentPersona = {
    openagent: "0.2",
    id,
    name: employee.name,
    role: personaRole(employee),
    org: { name: employee.ownerUserId ? `AgentSpace (${employee.ownerUserId})` : "AgentSpace" },
    behavior: personaBehavior(employee),
    face: {
      ref: `agentspace:${id}`,
      anchor: anchorColor(employee.name),
      recipe: { provider: "google-gemini", model: "imagen-4", prompt: facePrompt(employee) },
    },
    voice: {
      written: {
        rules: voiceRules(employee, skills),
        sample: employee.summary?.trim() || `I am ${employee.name}, ${employee.role}.`,
      },
    },
  };

  if (postsAbout.length > 0) {
    persona.posts_about = postsAbout;
  }

  if (!opts.sign) {
    return { persona };
  }

  const { publicKey, privateKey } =
    opts.keyPair ?? generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();

  persona.provenance = {
    created_by: { name: employee.name, key: publicPem, url: "https://github.com/HKUDS/AgentSpace" },
    signed_at: opts.now ?? new Date().toISOString(),
  };

  const signature = edSign(null, canonicalBytes(persona), privateKey).toString("base64");
  persona.provenance.signature = signature;

  return { persona, didKey: didKeyFromPublicKey(publicKey) };
}

/**
 * Verify a signed persona's provenance block the same way `@5dive/openagent`
 * does: recompute the canonical bytes (signature removed) and check the ed25519
 * signature against created_by.key. Exposed for tests and round-trip checks.
 */
export function verifyPersonaSignature(persona: OpenAgentPersona): boolean {
  const sig = persona.provenance?.signature;
  const key = persona.provenance?.created_by?.key;
  if (!sig || !key) {
    return false;
  }
  const publicKey = createPublicKey(key);
  return edVerify(null, canonicalBytes(persona), publicKey, Buffer.from(sig, "base64"));
}
