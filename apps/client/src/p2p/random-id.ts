// These ids include secrets (host secret, session tokens), so they must come
// from a secure random source. crypto.randomUUID exists only in secure contexts
// (https or localhost); a plain-HTTP LAN origin lacks it but still has
// crypto.getRandomValues.
export const createRandomId = (): string => {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  throw new Error("Secure random numbers are unavailable in this browser.");
};
