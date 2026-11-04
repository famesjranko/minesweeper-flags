import { inviteTokenSchema } from "@minesweeper-flags/shared";

const INVITE_PATH_PREFIX = "/invite/";
// Some messaging apps copy a link without its scheme.
const INVITE_LINK = /^(?:https?:\/\/)?[^/\s]+\/invite\/([^/?#\s]+)\/?(?:[?#]\S*)?$/i;

export const buildInvitePath = (inviteToken: string): string =>
  `${INVITE_PATH_PREFIX}${inviteToken}`;

export const extractInviteToken = (value: string): string | null => {
  const trimmedValue = value.trim();
  const candidate = INVITE_LINK.exec(trimmedValue)?.[1] ?? trimmedValue;
  const token = inviteTokenSchema.safeParse(candidate);

  return token.success ? token.data : null;
};
