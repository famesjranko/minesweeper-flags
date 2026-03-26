import { serverEventSchema, type ServerEvent } from "@minesweeper-flags/shared";

export const decodeServerEvent = (raw: unknown): ServerEvent | null => {
  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  const result = serverEventSchema.safeParse(parsed);

  if (!result.success) {
    return null;
  }

  return result.data;
};
