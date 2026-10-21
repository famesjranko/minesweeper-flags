import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "./test-fixture.mjs";

const mutations = (f) =>
  f.calls().filter((call) => call[0] === "render" && call[1] === "deploys" && call[2] === "create");

test("planning a release shows its exact commit without triggering deployment", (t) => {
  // Given a clean repository and configured free services in the correct workspace.
  const f = fixture(t);

  // When a frontend release is planned.
  const result = f.run("plan", "frontend");

  // Then the exact commit is shown and neither service is deployed.
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(f.sha));
  assert.match(result.stdout, /Plan only/);
  assert.deepEqual(mutations(f), []);
});

test("a coordinated release deploys and verifies the server before the frontend", (t) => {
  // Given a clean merged commit, green CI and an empty lobby.
  const f = fixture(t);

  // When both services are deployed.
  const result = f.run("deploy");

  // Then both deployments wait for completion at the requested commit in server-first order.
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    mutations(f).map((call) => call[3]),
    ["srv-server", "srv-frontend"]
  );
  for (const call of mutations(f)) {
    assert.equal(call[call.indexOf("--commit") + 1], f.sha);
    assert.ok(call.includes("--wait"));
  }
  const calls = f.calls();
  const readiness = calls.findIndex((call) => call[0] === "fetch" && call[1].endsWith("/ready"));
  const frontend = calls.findIndex((call) => call[3] === "srv-frontend" && call[2] === "create");
  assert.ok(readiness > 0 && readiness < frontend);
});

test("failed CI prevents every deployment", (t) => {
  // Given a selected commit whose image build failed.
  const f = fixture(t);

  // When a coordinated release is requested.
  const result = f.run("deploy", "all", { FAIL_CI: "images" });

  // Then the command fails before either service changes.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /images must pass/);
  assert.deepEqual(mutations(f), []);
});

test("active rooms prevent a server deployment", (t) => {
  // Given a green release while a game room is occupied.
  const f = fixture(t);

  // When both services are requested for deployment.
  const result = f.run("deploy", "all", { ACTIVE_ROOMS: "yes" });

  // Then the deployment stops without interrupting the room.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty lobby/);
  assert.deepEqual(mutations(f), []);
});

test("a failed server deployment leaves the frontend unchanged", (t) => {
  // Given a release whose server deployment will fail on Render.
  const f = fixture(t);

  // When a coordinated release is requested.
  const result = f.run("deploy", "all", { FAIL_SERVICE: "srv-server" });

  // Then the failure is returned and the frontend is never deployed.
  assert.notEqual(result.status, 0);
  assert.deepEqual(
    mutations(f).map((call) => call[3]),
    ["srv-server"]
  );
});

test("a service from another workspace is rejected before deployment", (t) => {
  // Given a configured service ID that resolves to a different owner.
  const f = fixture(t);
  f.services[0].service.ownerId = "tea-other";
  writeFileSync(join(f.directory, "services.json"), JSON.stringify(f.services));

  // When a coordinated release is requested.
  const result = f.run("deploy");

  // Then ownership validation stops the command without changing services.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /settings do not match/);
  assert.deepEqual(mutations(f), []);
});

test("dirty local changes prevent deployment of a misleading release", (t) => {
  // Given a checkout with an uncommitted change.
  const f = fixture(t);
  writeFileSync(join(f.repository, "README.md"), "Uncommitted change\n");

  // When a release is requested.
  const result = f.run("deploy");

  // Then the command reports the dirty checkout and does not deploy.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local changes/);
  assert.deepEqual(mutations(f), []);
});

test("source changes requiring a server release block a frontend-only deployment", (t) => {
  // Given a new merged commit that changes the server's shared dependencies.
  const f = fixture(t);
  writeFileSync(join(f.repository, "package.json"), '{"dependencies":{"example":"2.0.0"}}');
  f.git("add", "package.json");
  f.git("commit", "-m", "Change dependencies");
  f.git("push", "origin", "main");

  // When only the frontend is requested.
  const result = f.run("deploy", "frontend");

  // Then the command requires a coordinated release and does not deploy.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TARGET=all/);
  assert.deepEqual(mutations(f), []);
});

test("an unmerged local commit cannot be deployed", (t) => {
  // Given a clean commit that exists locally but has not reached main on the remote.
  const f = fixture(t);
  writeFileSync(join(f.repository, "README.md"), "Unmerged change\n");
  f.git("add", "README.md");
  f.git("commit", "-m", "Unmerged change");

  // When that commit is requested for deployment.
  const result = f.run("deploy", "all", { COMMIT: "HEAD" });

  // Then the command requires a merge and never starts a deployment.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be merged/);
  assert.deepEqual(mutations(f), []);
});

for (const policy of ["paid server", "automatic deploys"]) {
  test(`${policy} prevents deployment under the free manual policy`, (t) => {
    // Given a service whose current settings violate the configured deployment policy.
    const f = fixture(t);
    if (policy === "paid server") f.services[1].service.serviceDetails.plan = "starter";
    else f.services[0].service.autoDeployTrigger = "commit";
    writeFileSync(join(f.directory, "services.json"), JSON.stringify(f.services));

    // When a coordinated release is requested.
    const result = f.run("deploy");

    // Then the mismatch is reported before either service changes.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /settings do not match/);
    assert.deepEqual(mutations(f), []);
  });
}

test("Git hook environment cannot redirect a fixture into its parent repository", (t) => {
  // Given a disposable parent repository and the repository paths exported by a Git hook.
  const parent = fixture(t);
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = join(parent.repository, ".git");
  process.env.GIT_WORK_TREE = parent.repository;
  let child;

  // When another fixture is created inside that hook environment.
  try {
    child = fixture(t);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  // Then its Git directory is separate and the parent commit and files remain unchanged.
  assert.equal(child.git("rev-parse", "--show-toplevel"), child.repository);
  assert.equal(parent.git("rev-parse", "HEAD"), parent.sha);
  assert.equal(parent.git("status", "--porcelain"), "");
});
