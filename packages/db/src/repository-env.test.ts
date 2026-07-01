import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readEffectiveRuntimeEnv } from "./repository-env.ts";

test("readEffectiveRuntimeEnv lets runtime env override repository .env when disabled", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-repository-env-"));
  const previous = {
    AGENT_SPACE_APP_URL: process.env.AGENT_SPACE_APP_URL,
    AGENT_SPACE_REPOSITORY_ENV_OVERRIDE: process.env.AGENT_SPACE_REPOSITORY_ENV_OVERRIDE,
    AGENT_SPACE_REPOSITORY_ROOT: process.env.AGENT_SPACE_REPOSITORY_ROOT,
  };

  try {
    writeFileSync(join(tempRoot, "Target.md"), "# test\n");
    writeFileSync(join(tempRoot, ".env"), "AGENT_SPACE_APP_URL=https://production.test\n", "utf8");

    process.env.AGENT_SPACE_REPOSITORY_ROOT = tempRoot;
    process.env.AGENT_SPACE_APP_URL = "https://runtime.test";
    process.env.AGENT_SPACE_REPOSITORY_ENV_OVERRIDE = "0";

    assert.equal(readEffectiveRuntimeEnv().AGENT_SPACE_APP_URL, "https://runtime.test");
  } finally {
    restoreEnv("AGENT_SPACE_APP_URL", previous.AGENT_SPACE_APP_URL);
    restoreEnv("AGENT_SPACE_REPOSITORY_ENV_OVERRIDE", previous.AGENT_SPACE_REPOSITORY_ENV_OVERRIDE);
    restoreEnv("AGENT_SPACE_REPOSITORY_ROOT", previous.AGENT_SPACE_REPOSITORY_ROOT);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
