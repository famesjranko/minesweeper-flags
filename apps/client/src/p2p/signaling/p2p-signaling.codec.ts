import {
  guestAnswerPayloadSchema,
  hostOfferPayloadSchema,
  P2P_SIGNALING_PROTOCOL_VERSION,
  type GuestAnswerPayload,
  type HostOfferPayload
} from "@minesweeper-flags/shared";
import type { ZodType } from "zod";

const EMPTY_PAYLOAD_MESSAGE = "P2P signaling payload is empty.";
const INVALID_ENCODED_PAYLOAD_MESSAGE = "P2P signaling payload is not valid encoded JSON.";

const encodePayload = <TPayload>(schema: ZodType<TPayload>, payload: TPayload, label: string): string => {
  const result = schema.safeParse(payload);

  if (!result.success) {
    throw new Error(`Invalid ${label} signaling payload.`);
  }

  return encodeURIComponent(JSON.stringify(result.data));
};

const decodePayload = <TPayload>(schema: ZodType<TPayload>, encodedPayload: string, label: string): TPayload => {
  const trimmedPayload = encodedPayload.trim();

  if (!trimmedPayload) {
    throw new Error(EMPTY_PAYLOAD_MESSAGE);
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(decodeURIComponent(trimmedPayload));
  } catch {
    throw new Error(INVALID_ENCODED_PAYLOAD_MESSAGE);
  }

  if (
    typeof decoded === "object" &&
    decoded !== null &&
    "protocolVersion" in decoded &&
    decoded.protocolVersion !== P2P_SIGNALING_PROTOCOL_VERSION
  ) {
    throw new Error(`Unsupported P2P signaling protocol version: ${String(decoded.protocolVersion)}.`);
  }

  const result = schema.safeParse(decoded);

  if (!result.success) {
    throw new Error(`Invalid ${label} signaling payload.`);
  }

  return result.data;
};

export const encodeHostOfferPayload = (payload: HostOfferPayload): string =>
  encodePayload(hostOfferPayloadSchema, payload, "host offer");

export const decodeHostOfferPayload = (encodedPayload: string): HostOfferPayload =>
  decodePayload(hostOfferPayloadSchema, encodedPayload, "host offer");

export const encodeGuestAnswerPayload = (payload: GuestAnswerPayload): string =>
  encodePayload(guestAnswerPayloadSchema, payload, "guest answer");

export const decodeGuestAnswerPayload = (encodedPayload: string): GuestAnswerPayload =>
  decodePayload(guestAnswerPayloadSchema, encodedPayload, "guest answer");
