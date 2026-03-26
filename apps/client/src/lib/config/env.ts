const DEFAULT_SOCKET_PATH = "/ws";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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

const buildSameOriginSocketUrl = (location: SocketLocationLike, socketPath: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${socketPath}`;
};

export const isLocalHostname = (hostname: string): boolean => LOCAL_HOSTNAMES.has(hostname);

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

export const SERVER_URL = resolveServerUrl();
