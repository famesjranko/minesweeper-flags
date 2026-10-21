import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const DEMO_HOSTS = new Set([
  "minesweeper-flags-demo.onrender.com",
  "minesweeper-flags-api.onrender.com"
]);

function origin(value, protocol, allowPlaceholders) {
  const url = new URL(value);
  if (
    url.protocol !== protocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    DEMO_HOSTS.has(url.hostname) ||
    (!allowPlaceholders && (url.hostname.endsWith(".invalid") || url.hostname === "localhost"))
  )
    throw new Error("Configure your own HTTPS frontend and server URLs in render.yaml.");
  return url;
}

export function validateTemplate(source, { allowPlaceholders = false } = {}) {
  const blueprint = parse(source);
  const frontend = blueprint.services.find((service) => service.runtime === "static");
  const server = blueprint.services.find((service) => service.runtime === "docker");
  const env = (service, key) => service.envVars.find((entry) => entry.key === key)?.value;
  const allowed = origin(env(server, "WEBSOCKET_ALLOWED_ORIGINS"), "https:", allowPlaceholders);
  const socket = origin(env(frontend, "VITE_SOCKET_URL"), "wss:", allowPlaceholders);
  const health = origin(
    frontend.routes.find((route) => route.source === "/api/health")?.destination,
    "https:",
    allowPlaceholders
  );
  const csp = frontend.headers.find((header) => header.name === "Content-Security-Policy")?.value;
  const connections = csp
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "))
    ?.split(/\s+/)
    .slice(1);
  const expected = ["'self'", health.origin, socket.origin].sort();
  if (
    allowed.pathname !== "/" ||
    socket.pathname !== "/ws" ||
    health.pathname !== "/health" ||
    socket.host !== health.host ||
    JSON.stringify(connections?.sort()) !== JSON.stringify(expected)
  )
    throw new Error(
      "The origin allowlist, socket URL, health rewrite and CSP must match your hosts."
    );
  return { frontendOrigin: allowed.origin, serverOrigin: health.origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateTemplate(readFileSync("render.yaml", "utf8"), {
      allowPlaceholders: process.argv.includes("--example")
    });
    console.log(
      process.argv.includes("--example")
        ? "Public template structure is valid."
        : "Deployment URLs are configured."
    );
  } catch (error) {
    console.error(`Render configuration rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
