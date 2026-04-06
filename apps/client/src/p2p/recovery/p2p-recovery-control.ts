import { z } from "zod";

export const P2P_RECOVERY_CONTROL_TYPE = "p2p:recovery";

export interface P2PRecoveryControlMessage {
  type: typeof P2P_RECOVERY_CONTROL_TYPE;
  payload: {
    controlSessionId: string;
    guestSecret: string;
  };
}

const p2pRecoveryControlMessageSchema = z
  .object({
    type: z.literal(P2P_RECOVERY_CONTROL_TYPE),
    payload: z
      .object({
        controlSessionId: z.string().trim().min(1),
        guestSecret: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();

export const encodeP2PRecoveryControlMessage = (message: P2PRecoveryControlMessage): string =>
  JSON.stringify(message);

export const decodeP2PRecoveryControlMessage = (raw: unknown): P2PRecoveryControlMessage | null => {
  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  const result = p2pRecoveryControlMessageSchema.safeParse(parsed);

  if (!result.success) {
    return null;
  }

  return result.data;
};
