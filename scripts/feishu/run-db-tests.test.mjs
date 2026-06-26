import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const scriptPath = join(repositoryRoot, "scripts", "feishu", "run-db-tests.mjs");

test("Feishu DB test runner dry-run reuses an explicit isolated test database without printing the URL", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-db-runner-"));
  try {
    const result = await runScript(["--dry-run"], {
      AGENT_SPACE_E2E_FORCE_NEON_BRANCH: "0",
      AGENT_SPACE_FEISHU_DB_TEST_RECORD_PATH: join(tempRoot, "active-neon-branch.json"),
      AGENT_SPACE_TEST_DATABASE_URL: "postgres://test-user:secret@127.0.0.1:5432/agent_space_test",
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Using Feishu DB test database: existing-test-database/);
    assert.doesNotMatch(result.stdout, /postgres:|secret|agent_space_test/);
    assert.doesNotMatch(result.stderr, /postgres:|secret|agent_space_test/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Feishu DB test runner cleanup-stale deletes the recorded Neon branch", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-db-cleanup-"));
  const recordPath = join(tempRoot, "active-neon-branch.json");
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      authorization: request.headers.authorization,
      method: request.method,
      url: request.url,
    });
    response.writeHead(204);
    response.end();
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    writeFileSync(recordPath, `${JSON.stringify({
      branchId: "br-stale-feishu-db",
      branchName: "e2e-stale-feishu-db",
      pid: 0,
      projectId: "project-feishu-db",
    }, null, 2)}\n`, "utf8");

    const result = await runScript(["--cleanup-stale"], {
      AGENT_SPACE_FEISHU_DB_TEST_RECORD_PATH: recordPath,
      NEON_API_HOST: `http://127.0.0.1:${address.port}`,
      NEON_API_KEY: "test-neon-api-key",
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Deleted recorded Neon test branch: e2e-stale-feishu-db/);
    assert.equal(existsSync(recordPath), false);
    assert.deepEqual(requests, [{
      authorization: "Bearer test-neon-api-key",
      method: "DELETE",
      url: "/projects/project-feishu-db/branches/br-stale-feishu-db",
    }]);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function runScript(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolvePromise({
        code: code ?? 1,
        stderr,
        stdout,
      });
    });
    child.once("error", (error) => {
      resolvePromise({
        code: 1,
        stderr: error instanceof Error ? error.message : String(error),
        stdout,
      });
    });
  });
}
