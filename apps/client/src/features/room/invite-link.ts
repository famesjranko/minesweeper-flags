import { inviteTokenSchema } from "@minesweeper-flags/shared";

const INVITE_PATH_PREFIX = "/invite/";

export const buildInvitePath = (inviteToken: string): string => `${INVITE_PATH_PREFIX}${inviteToken}`;

export const extractInviteToken = (value: string): string | null => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const directToken = inviteTokenSchema.safeParse(trimmedValue);

  if (directToken.success) {
    return directToken.data;
  }

  return null;
};
