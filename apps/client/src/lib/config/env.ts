const DEFAULT_SOCKET_PATH = "/ws";
const DEFAULT_DEPLOYMENT_MODE = "server";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type DeploymentMode = "server" | "p2p";

interface ResolveDeploymentModeOptions {
  explicitMode?: string | undefined;
}

interface SocketLocationLike {
  host: string;
  hostname: string;
  protocol: string;
}

interface ResolveServerUrlOptions {
  explicitUrl?: string | undefined;
  isDev?: boolean | undefined;
  location?: SocketLocationLike | undefined;
  socketPath?: string | undefined;
}

interface ResolveP2PStunUrlsOptions {
  explicitUrls?: string | undefined;
}

interface ResolveP2PSignalingUrlOptions {
  explicitUrl?: string | undefined;
  deploymentMode?: DeploymentMode | undefined;
}

const buildSameOriginSocketUrl = (location: SocketLocationLike, socketPath: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${socketPath}`;
};

export const isLocalHostname = (hostname: string): boolean => LOCAL_HOSTNAMES.has(hostname);

export const resolveDeploymentMode = ({
  explicitMode = import.meta.env.VITE_DEPLOYMENT_MODE?.trim()
}: ResolveDeploymentModeOptions = {}): DeploymentMode => {
  if (!explicitMode) {
    return DEFAULT_DEPLOYMENT_MODE;
  }

  if (explicitMode === "server" || explicitMode === "p2p") {
    return explicitMode;
  }

  throw new Error(
    `VITE_DEPLOYMENT_MODE must be \"server\" or \"p2p\". Received \"${explicitMode}\".`
  );
};

export const resolveP2PStunUrls = ({
  explicitUrls = import.meta.env.VITE_P2P_STUN_URLS
}: ResolveP2PStunUrlsOptions = {}): string[] => {
  if (!explicitUrls) {
    return [];
  }

  return explicitUrls
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

export const resolveP2PSignalingUrl = ({
  explicitUrl = import.meta.env.VITE_P2P_SIGNALING_URL?.trim(),
  deploymentMode = resolveDeploymentMode()
}: ResolveP2PSignalingUrlOptions = {}): string | undefined => {
  if (deploymentMode !== "p2p") {
    return explicitUrl;
  }

  if (explicitUrl) {
    return explicitUrl;
  }

  throw new Error(
    "VITE_P2P_SIGNALING_URL is required when VITE_DEPLOYMENT_MODE=p2p."
  );
};

export const resolveServerUrl = ({
  explicitUrl = import.meta.env.VITE_SOCKET_URL?.trim(),
  isDev = import.meta.env.DEV,
  location = typeof window === "undefined" ? undefined : window.location,
  socketPath = import.meta.env.VITE_SOCKET_PATH ?? DEFAULT_SOCKET_PATH
}: ResolveServerUrlOptions = {}) => {
  if (explicitUrl) {
    return explicitUrl;
  }

  if (!location) {
    return `ws://localhost:3001${socketPath}`;
  }

  if (isDev || isLocalHostname(location.hostname)) {
    return buildSameOriginSocketUrl(location, socketPath);
  }

  throw new Error(
    "VITE_SOCKET_URL is required for non-local frontend deployments. Build the client with an explicit WebSocket URL such as wss://api.example.com/ws."
  );
};

export const DEPLOYMENT_MODE = resolveDeploymentMode();
export const P2P_STUN_URLS = resolveP2PStunUrls();
export const P2P_SIGNALING_URL = resolveP2PSignalingUrl({ deploymentMode: DEPLOYMENT_MODE });

export const SERVER_HEALTH_URL = "/api/health";
