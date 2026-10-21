import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  cli,
  cliEnvironment,
  githubRepository,
  loadConfig,
  localDirectory,
  validateChecks,
  validateService
} from "./config.mjs";

const command = process.argv[2];
const target = process.argv[3] || process.env.TARGET;
const commit = process.argv[4] || process.env.COMMIT || "origin/main";
const run = (program, args) =>
  execFileSync(program, args, {
    encoding: "utf8",
    env: cliEnvironment,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024
  }).trim();
const renderJson = (args) => JSON.parse(run(cli, [...args, "--output", "json"]));

function selectedNames() {
  if (!["frontend", "server", "all"].includes(target)) {
    throw new Error(
      "Set TARGET=frontend, TARGET=server, or TARGET=all. Example: make deploy-plan TARGET=frontend"
    );
  }
  return target === "all" ? ["server", "frontend"] : [target];
}

function inspectServices(config) {
  if (renderJson(["workspace", "current"]).id !== config.workspaceId) {
    throw new Error(
      "Render workspace mismatch. Run make deploy-login to select the configured workspace."
    );
  }
  const services = renderJson(["services"]).flatMap((entry) =>
    entry.service ? [entry.service] : []
  );
  for (const name of ["frontend", "server"]) {
    validateService(
      services.find((service) => service.id === config[name].serviceId),
      name,
      config
    );
  }
}

function releaseCommit(config) {
  if (
    githubRepository(run("git", ["config", "--get", "remote.origin.url"])) !== config.repository
  ) {
    throw new Error("The local origin repository differs from the deployment configuration.");
  }
  if (commit.startsWith("-") || !/^[\w./-]+$/.test(commit))
    throw new Error("Supply a Git commit or ref in COMMIT.");
  run("git", ["fetch", "origin", "main"]);
  const sha = run("git", ["rev-parse", "--verify", `${commit}^{commit}`]);
  try {
    run("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  } catch {
    throw new Error("The selected commit must be merged into origin/main before deployment.");
  }
  return sha;
}

function checkCompatibility(config, names, sha) {
  if (names.length !== 1) return;
  const other = names[0] === "frontend" ? "server" : "frontend";
  const live = renderJson(["deploys", "list", config[other].serviceId]).find(
    (item) => item.status === "live"
  );
  if (!/^[a-f0-9]{40}$/.test(live?.commit?.id))
    throw new Error("Cannot verify the other service's live commit.");
  const paths = ["packages/game-engine", "packages/shared", "package.json", "package-lock.json"];
  if (names[0] === "frontend") paths.push("apps/server");
  try {
    run("git", ["diff", "--quiet", live.commit.id, sha, "--", ...paths]);
  } catch {
    throw new Error(
      "Server, shared code or dependencies changed. Use TARGET=all for a coordinated release."
    );
  }
}

async function health(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(70_000), redirect: "error" });
  if (!response.ok) throw new Error(`Health check failed (${response.status}): ${url}`);
  const result = await response.json();
  if (result.status !== expected) throw new Error(`Unexpected health response: ${url}`);
  return result;
}

async function status(config) {
  inspectServices(config);
  for (const name of ["server", "frontend"]) {
    const deployments = renderJson(["deploys", "list", config[name].serviceId]);
    const live = deployments.find((deploy) => deploy.status === "live");
    console.log(
      `${name}: ${config[name].url} live=${live?.commit?.id || "unknown"} latest=${deployments[0]?.status || "none"}`
    );
  }
  await health(`${config.server.url}/ready`, "ready");
  const rooms = await health(`${config.frontend.url}/api/health`, "ok");
  console.log(`Health passed; rooms ${rooms.activeRooms}/${rooms.maxRooms}.`);
}

function trigger(serviceId, sha) {
  return new Promise((fulfill, reject) => {
    const child = spawn(
      cli,
      ["deploys", "create", serviceId, "--commit", sha, "--wait", "--confirm", "--output", "json"],
      {
        env: cliEnvironment,
        stdio: "inherit"
      }
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? fulfill()
        : reject(
            new Error(
              `Render deployment failed (${signal || code}); remaining services were not deployed.`
            )
          )
    );
  });
}

async function deploy(config, names, sha) {
  if (run("git", ["status", "--porcelain"]))
    throw new Error("Commit or remove local changes before deploying.");
  validateChecks(
    JSON.parse(
      run("gh", ["api", `repos/${config.repository}/commits/${sha}/check-runs?per_page=100`])
    ).check_runs
  );
  if (names.includes("server")) {
    const rooms = await health(`${config.frontend.url}/api/health`, "ok");
    if (!Number.isInteger(rooms.activeRooms) || rooms.activeRooms !== 0) {
      throw new Error(
        "Server deployment requires a verified empty lobby; retry when no rooms are active."
      );
    }
  }
  for (const name of names) {
    console.log(`Deploying ${name} at ${sha}; waiting for Render to finish.`);
    await trigger(config[name].serviceId, sha);
    await health(
      name === "server" ? `${config.server.url}/ready` : `${config.frontend.url}/api/health`,
      name === "server" ? "ready" : "ok"
    );
    const live = renderJson(["deploys", "list", config[name].serviceId]).find(
      (item) => item.status === "live"
    );
    if (live?.commit?.id !== sha)
      throw new Error(`${name} did not report the requested commit live.`);
    console.log(`${name} verified live at ${sha}.`);
  }
}

async function main() {
  if (command === "login") {
    await new Promise((fulfill, reject) => {
      const child = spawn(cli, ["login"], { env: cliEnvironment, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? fulfill() : reject(new Error("Render login failed."))
      );
    });
    if (existsSync(resolve(localDirectory, "config.json"))) {
      renderJson(["workspace", "set", loadConfig().workspaceId, "--confirm"]);
    }
    return;
  }
  const config = loadConfig();
  if (command === "status") return status(config);
  if (!["plan", "deploy"].includes(command))
    throw new Error("Use make deploy-login, deploy-status, deploy-plan, or deploy.");
  const names = selectedNames();
  const sha = releaseCommit(config);
  inspectServices(config);
  checkCompatibility(config, names, sha);
  console.log(`Workspace: ${config.workspaceId}\nRepository: ${config.repository}\nCommit: ${sha}`);
  for (const name of names) console.log(`${name}: ${config[name].serviceId} ${config[name].url}`);
  if (command === "plan") console.log("Plan only. No deployment requested.");
  else await deploy(config, names, sha);
}

main().catch((error) => {
  console.error(`Deployment stopped: ${error.message}`);
  process.exitCode = 1;
});
