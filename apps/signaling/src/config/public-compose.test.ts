import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicP2pComposePath = resolve(
  import.meta.dirname,
  "../../../../deploy/container/docker-compose.public.p2p.yml"
);

describe("public p2p compose defaults", () => {
  it("requires explicit public-facing signaling values instead of localhost fallbacks", () => {
    const compose = readFileSync(publicP2pComposePath, "utf8");

    expect(compose).toContain("SIGNALING_ALLOWED_ORIGINS: ${SIGNALING_ALLOWED_ORIGINS:?");
    expect(compose).toContain("VITE_P2P_SIGNALING_URL: ${VITE_P2P_SIGNALING_URL:?");
    expect(compose).toContain("CSP_CONNECT_SRC: ${CSP_CONNECT_SRC:?");
    expect(compose).not.toContain("SIGNALING_ALLOWED_ORIGINS: ${SIGNALING_ALLOWED_ORIGINS:-http://localhost:8080}");
    expect(compose).not.toContain("VITE_P2P_SIGNALING_URL: ${VITE_P2P_SIGNALING_URL:-http://localhost:3002}");
    expect(compose).not.toContain("CSP_CONNECT_SRC: ${CSP_CONNECT_SRC:-http://localhost:3002}");
  });
});
