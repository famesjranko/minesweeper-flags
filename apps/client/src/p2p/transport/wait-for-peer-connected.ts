import type { WebRTCPeerController } from "./webrtc-peer.types.js";

// Resolves once the peer is connected. Rejects if it fails or closes first, or on abort.
export const waitForPeerConnected = (
  peer: WebRTCPeerController,
  signal?: AbortSignal
): Promise<void> => {
  if (peer.getStatus() === "connected") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const abortListener = () => {
      unsubscribe();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const unsubscribe = peer.subscribe({
      onStatusChange: (change) => {
        if (change.status === "connected") {
          cleanup();
          resolve();
          return;
        }

        if (change.status === "failed" || change.status === "closed") {
          cleanup();
          reject(new Error(change.error ?? "Direct connection failed."));
        }
      }
    });
    const cleanup = () => {
      unsubscribe();
      signal?.removeEventListener("abort", abortListener);
    };

    signal?.addEventListener("abort", abortListener, { once: true });
  });
};
