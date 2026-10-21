import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const localDirectory = resolve(process.env.DEPLOY_DIR || ".deploy");
export const cli =
  process.env.RENDER_CLI ||
  (existsSync(resolve(localDirectory, "bin/render"))
    ? resolve(localDirectory, "bin/render")
    : "render");
export const cliEnvironment = {
  ...process.env,
  DO_NOT_TRACK: "1",
  RENDER_CLI_CONFIG_DIR: resolve(localDirectory, "auth")
};

export function loadConfig() {
  const file = resolve(localDirectory, "config.json");
  if (!existsSync(file))
    throw new Error("Create .deploy/config.json from deploy/render/config.example.json first.");
  if (statSync(file).mode & 0o077)
    throw new Error("Keep deployment settings private: chmod 600 .deploy/config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (
    !/^tea-[a-z0-9]+$/.test(config.workspaceId) ||
    !/^[\w.-]+\/[\w.-]+$/.test(config.repository)
  ) {
    throw new Error("Set workspaceId and repository in .deploy/config.json.");
  }
  for (const name of ["frontend", "server"]) {
    const service = config[name];
    const url = new URL(service?.url);
    if (
      !/^srv-[a-z0-9]+$/.test(service?.serviceId) ||
      url.protocol !== "https:" ||
      url.origin !== service.url ||
      url.username ||
      url.password ||
      url.hostname.endsWith(".invalid")
    ) {
      throw new Error(`Configure the ${name} service ID and HTTPS origin in .deploy/config.json.`);
    }
  }
  if (config.frontend.serviceId === config.server.serviceId)
    throw new Error("Frontend and server must use different service IDs.");
  return config;
}

export function githubRepository(url) {
  const match = url.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/
  );
  if (!match) throw new Error("The source must be a GitHub repository URL.");
  return match[1];
}

export function validateService(service, name, config) {
  const details = service?.serviceDetails;
  if (
    !service ||
    service.ownerId !== config.workspaceId ||
    service.type !== (name === "frontend" ? "static_site" : "web_service") ||
    githubRepository(service.repo) !== config.repository ||
    service.branch !== "main" ||
    service.autoDeployTrigger !== "off" ||
    service.suspended !== "not_suspended" ||
    details.url !== config[name].url ||
    details.previews?.generation !== "off" ||
    (name === "server" && details.plan !== "free")
  ) {
    throw new Error(
      `${name} settings do not match the configured workspace, repository, URLs and free manual deployment policy.`
    );
  }
}

export function validateChecks(checks) {
  for (const name of ["check", "images"]) {
    const latest = checks
      .filter((check) => check.name === name && check.app?.slug === "github-actions")
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status !== "completed" || latest.conclusion !== "success") {
      throw new Error(
        `GitHub Actions ${name} must pass for the selected commit before deployment.`
      );
    }
  }
}
