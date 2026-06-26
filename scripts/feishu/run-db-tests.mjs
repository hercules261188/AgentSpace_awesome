#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareE2eNeonBranch } from "../../apps/web/scripts/prepare-e2e-neon-branch.mjs";

const DEFAULT_NEON_API_HOST = "https://console.neon.tech/api/v2";
const TEST_FILES = [
  "packages/services/src/integrations/providers/feishu/__tests__/agent-bot-bindings.test.ts",
  "packages/services/src/integrations/providers/feishu/__tests__/inbound.test.ts",
  "packages/services/src/integrations/providers/feishu/__tests__/data-plane-db.test.ts",
  "packages/services/src/integrations/providers/feishu/__tests__/outbound-db.test.ts",
  "packages/services/src/integrations/providers/feishu/__tests__/websocket-worker-db.test.ts",
];

const FEISHU_DB_TEST_ENV = {
  AGENT_SPACE_FEISHU_AGENT_BOT_DB_TESTS: "1",
  AGENT_SPACE_FEISHU_INBOUND_DB_TESTS: "1",
  AGENT_SPACE_FEISHU_DATA_PLANE_DB_TESTS: "1",
  AGENT_SPACE_FEISHU_OUTBOUND_DB_TESTS: "1",
  AGENT_SPACE_FEISHU_WORKER_DB_TESTS: "1",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repositoryRoot = findRepositoryRoot();
  if (args.cleanupStale) {
    await cleanupRecordedBranch({ force: true, repositoryRoot });
    return;
  }
  await cleanupRecordedBranch({ force: false, repositoryRoot });

  const runtime = {
    child: undefined,
    interruptedBy: undefined,
  };
  const handleSignal = (signal) => {
    runtime.interruptedBy = signal;
    if (runtime.child && !runtime.child.killed) {
      runtime.child.kill(signal);
    }
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  let prepared;
  let exitCode = 0;

  try {
    prepared = await prepareE2eNeonBranch({ dryRun: args.dryRun });
    if (prepared.branchCreated) {
      console.log(`Created Neon test branch: ${prepared.branchName} (${prepared.branchId})`);
      writeActiveBranchRecord({ prepared, repositoryRoot });
    } else {
      console.log(`Using Feishu DB test database: ${prepared.branchName}`);
    }

    if (runtime.interruptedBy) {
      exitCode = signalExitCode(runtime.interruptedBy);
      return;
    }

    if (args.dryRun) {
      return;
    }

    const testEnv = {
      ...process.env,
      ...prepared.env,
      ...FEISHU_DB_TEST_ENV,
    };
    for (const file of TEST_FILES) {
      console.log(`Running ${file}`);
      const result = await runTestFile({
        env: testEnv,
        file,
        repositoryRoot,
        runtime,
      });
      if (runtime.interruptedBy) {
        exitCode = signalExitCode(runtime.interruptedBy);
        break;
      }
      if (result !== 0) {
        exitCode = result;
        break;
      }
    }
  } finally {
    if (prepared?.branchCreated) {
      try {
        await deleteNeonBranch({
          branchId: prepared.branchId,
          branchName: prepared.branchName,
          projectId: prepared.projectId,
          repositoryRoot,
        });
        console.log(`Deleted Neon test branch: ${prepared.branchName} (${prepared.branchId})`);
        removeActiveBranchRecord(repositoryRoot);
      } catch (error) {
        console.error(`Failed to delete Neon test branch ${prepared.branchName}: ${errorMessage(error)}`);
        exitCode ||= 1;
      }
    }
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }

  process.exitCode = exitCode;
}

function runTestFile(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "--experimental-strip-types",
      "--test",
      "--test-concurrency=1",
      input.file,
    ], {
      cwd: input.repositoryRoot,
      env: input.env,
      stdio: "inherit",
    });
    input.runtime.child = child;
    child.once("exit", (code, signal) => {
      input.runtime.child = undefined;
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      resolve(signal ? signalExitCode(signal) : 1);
    });
    child.once("error", (error) => {
      input.runtime.child = undefined;
      console.error(errorMessage(error));
      resolve(1);
    });
  });
}

function parseArgs(args) {
  return {
    cleanupStale: args.includes("--cleanup-stale"),
    dryRun: args.includes("--dry-run"),
  };
}

async function cleanupRecordedBranch(input) {
  const record = readActiveBranchRecord(input.repositoryRoot);
  if (!record) {
    if (input.force) {
      console.log("No recorded Feishu DB test branch to clean up.");
    }
    return;
  }
  if (!input.force && isProcessRunning(record.pid)) {
    throw new Error(
      `Refusing to clean active Feishu DB test branch ${record.branchName}: process ${record.pid} is still running.`,
    );
  }
  await deleteNeonBranch({
    branchId: record.branchId,
    branchName: record.branchName,
    projectId: record.projectId,
    repositoryRoot: input.repositoryRoot,
  });
  removeActiveBranchRecord(input.repositoryRoot);
  console.log(`Deleted recorded Neon test branch: ${record.branchName} (${record.branchId})`);
}

function writeActiveBranchRecord(input) {
  const filePath = activeBranchRecordPath(input.repositoryRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    branchId: input.prepared.branchId,
    branchName: input.prepared.branchName,
    createdAt: new Date().toISOString(),
    pid: process.pid,
    projectId: input.prepared.projectId,
  }, null, 2)}\n`, "utf8");
}

function readActiveBranchRecord(repositoryRoot) {
  const filePath = activeBranchRecordPath(repositoryRoot);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (
    typeof value?.branchId !== "string" ||
    typeof value.branchName !== "string" ||
    typeof value.projectId !== "string"
  ) {
    throw new Error(`Invalid Feishu DB test branch cleanup record at ${filePath}.`);
  }
  return {
    branchId: value.branchId,
    branchName: value.branchName,
    pid: typeof value.pid === "number" ? value.pid : undefined,
    projectId: value.projectId,
  };
}

function removeActiveBranchRecord(repositoryRoot) {
  rmSync(activeBranchRecordPath(repositoryRoot), { force: true });
}

function activeBranchRecordPath(repositoryRoot) {
  return process.env.AGENT_SPACE_FEISHU_DB_TEST_RECORD_PATH?.trim()
    || join(repositoryRoot, "runtime-output", "feishu-db-tests", "active-neon-branch.json");
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function deleteNeonBranch(input) {
  const env = {
    ...readEnvFile(join(input.repositoryRoot, ".env")),
    ...readEnvFile(join(input.repositoryRoot, ".env.neon")),
    ...process.env,
  };
  const apiKey = firstValue(env.NEON_API_KEY, env.AGENT_SPACE_NEON_API_KEY);
  const apiHost = firstValue(env.NEON_API_HOST, env.AGENT_SPACE_NEON_API_HOST) || DEFAULT_NEON_API_HOST;
  if (!apiKey) {
    throw new Error("NEON_API_KEY is required to delete the temporary branch.");
  }
  if (!input.projectId) {
    throw new Error("Neon project id is required to delete the temporary branch.");
  }
  const response = await fetch(
    `${apiHost.replace(/\/$/, "")}/projects/${encodeURIComponent(input.projectId)}/branches/${encodeURIComponent(input.branchId)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    },
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Neon API request failed (${response.status}): ${message}`);
  }
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const result = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const rawKey = trimmed.slice(0, separatorIndex).trim();
    const key = rawKey.startsWith("export ") ? rawKey.slice("export ".length).trim() : rawKey;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function findRepositoryRoot() {
  let current = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(current, "Target.md"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    }
    current = parent;
  }
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function signalExitCode(signal) {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return 1;
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
