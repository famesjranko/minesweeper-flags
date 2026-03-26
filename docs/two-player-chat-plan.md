# Two-Player Chat Feature Plan

This document defines a complete implementation plan for adding room-scoped chat to Minesweeper Flags.
The intent is to ship a polished feature that fits the current lobby and match UI, works with the existing WebSocket architecture, and remains compatible with the repo's current single-instance deployment posture.

## Summary

Add a lightweight text chat tied to a room session.
The host can start chatting as soon as the room exists, the guest receives recent history on join, and the conversation continues through the live match and rematch flow.

The chat feature should:

- feel native to the current "classic competitive Minesweeper" presentation
- preserve recent messages across reconnects
- persist across server restarts when `STATE_BACKEND=redis`
- stay room-scoped and strictly two-player
- avoid interfering with board input, reconnect, or rematch behavior

## Goals

- Let the two room participants exchange short text messages before, during, and after a match.
- Show recent room chat history to players when they join or reconnect.
- Persist recent chat history in both memory and Redis-backed environments.
- Fit the current visual language in [styles.css](/home/andy/minesweeper-flags/apps/client/src/styles.css), [RoomPage.tsx](/home/andy/minesweeper-flags/apps/client/src/pages/RoomPage.tsx), and [MatchView.tsx](/home/andy/minesweeper-flags/apps/client/src/features/match/MatchView.tsx).
- Keep the implementation ready for future cross-instance fanout work without requiring that fanout now.

## Non-Goals

- Spectator chat
- Global lobby chat
- Attachments, emoji pickers, markdown, or rich text
- Push notifications or background notifications
- Message editing or deletion
- Presence beyond the existing connected/disconnected player state
- Solving cross-instance live event fanout in this feature

## Product Behavior

### Room Scope

- Chat is attached to a room, not to a specific match round.
- Messages sent while waiting for the second player stay with the room and appear when the guest joins.
- Messages remain visible during the live match and in the finished-match rematch state.
- Leaving the room clears local chat state for that browser session.
- Server-side chat history is removed when the room is cleaned up or explicitly deleted.

### Message Rules

- Messages are plain text only.
- Trim leading and trailing whitespace before validation.
- Reject empty messages after trimming.
- Default max length: `200` characters.
- Preserve line breaks only if the UI uses a textarea; otherwise keep the composer single-line and send on `Enter`.
- Do not support links, HTML, markdown, or custom formatting.

### History Rules

- Default history size: latest `25` messages per room.
- History is returned oldest-to-newest so the client can render naturally and scroll to the latest item.
- The client should deduplicate by `messageId` so reconnect and late history loads do not create duplicates.

## UX Plan

### Waiting Room

The waiting view in [RoomPage.tsx](/home/andy/minesweeper-flags/apps/client/src/pages/RoomPage.tsx) should gain a "Room Chat" card inside the existing control area.

Behavior:

- The host can type immediately after creating a room.
- If no opponent is connected yet, show helper copy such as "Messages sent now will appear when your opponent joins."
- The card uses the same rounded panel treatment as the current lobby action cards.
- The input stays available while the socket is connected.
- If the socket is reconnecting, disable send and show a compact inline status.

### Live Match

The live match view in [MatchView.tsx](/home/andy/minesweeper-flags/apps/client/src/features/match/MatchView.tsx) should gain a dedicated chat rail.

Desktop layout:

- Expand `.classic-match-shell` from a two-column layout to a three-column layout.
- Keep the existing left player sidebar and center board unchanged in hierarchy.
- Add a right-side chat frame sized roughly `240px` to `280px` wide.
- Style the chat frame with the same beveled, glossy, arcade-like treatment used by the board frame and sidebar.

Mobile layout:

- On narrow screens, move chat below the board instead of squeezing the board width.
- Keep the board as the priority surface.
- The chat panel becomes a full-width block below the board and above the rematch panel.

### Visual Direction

The chat UI should match the current design language rather than introducing a modern flat messenger aesthetic.

Design requirements:

- Use the existing type stack from [styles.css](/home/andy/minesweeper-flags/apps/client/src/styles.css).
- Reuse the blue and warm orange-red accents already used for player identity.
- Use neutral metallic backgrounds, subtle bevels, and glossy highlights consistent with the current match window.
- Keep message bubbles compact and readable.
- Use blue-accent treatment for self messages and amber/red-accent treatment for opponent messages.
- Use a subdued neutral style for system hints and empty states.

### Chat Panel Anatomy

The chat panel should contain:

- a header with `Room Chat` and a small room-code or connection badge
- a scrollable message list
- an empty state when no messages exist yet
- a composer row with text input and send button
- an inline error/status area for chat-specific issues

### Interaction Details

- Pressing `Enter` sends the message.
- If a textarea is used, `Shift+Enter` inserts a newline.
- Do not optimistically render outgoing messages before the server accepts them.
- After a successful send, clear the draft and scroll to bottom if the user was already near the bottom.
- If the user has scrolled upward, do not forcibly snap them to the bottom on every incoming message.

## Shared Protocol Changes

Add a dedicated chat DTO and event set in `packages/shared`.

### New DTO

Recommended `ChatMessageDto` shape:

```ts
interface ChatMessageDto {
  messageId: string;
  playerId: string;
  displayName: string;
  text: string;
  sentAt: number;
}
```

### New Client Event

```ts
type "chat:send"
```

Payload:

```ts
{
  roomCode: string;
  sessionToken: string;
  text: string;
}
```

### New Server Events

```ts
type "chat:history"
type "chat:message"
type "chat:message-rejected"
```

Payloads:

```ts
{
  type: "chat:history";
  payload: {
    roomCode: string;
    messages: ChatMessageDto[];
  };
}

{
  type: "chat:message";
  payload: {
    roomCode: string;
    message: ChatMessageDto;
  };
}

{
  type: "chat:message-rejected";
  payload: {
    roomCode: string;
    message: string;
  };
}
```

### Protocol Handling Rules

- `chat:history` is sent only to the requesting socket after room create, room join, or reconnect completes.
- `chat:message` is broadcast to both room participants after validation and persistence succeed.
- `chat:message-rejected` is sent only to the sending client for chat-specific validation or rate-limit failures.
- The client should treat chat events as room-scoped and ignore them for non-active rooms.

## Server Architecture

### New Server Module

Add a dedicated chat module under `apps/server/src/modules/chat`.

Recommended files:

- `chat.types.ts`
- `chat.repository.ts`
- `chat.service.ts`
- `chat.handlers.ts`

Responsibilities:

- repository: persistence and retrieval
- service: validation, append, trimming, history reads
- handlers: wire chat send and chat history delivery into realtime flows

### Realtime Server Integration

Update [realtime.server.ts](/home/andy/minesweeper-flags/apps/server/src/app/realtime/realtime.server.ts) to:

- create the chat service from the state store bundle
- route `chat:send` through `requireAttachedSession(...)`
- send chat history after successful room create, room join, and reconnect attach paths
- include chat-specific rejection handling without polluting the general match error flow

### Persistence Interface

Add a `ChatRepository` to the state-store seam in [state-store.ts](/home/andy/minesweeper-flags/apps/server/src/app/state/state-store.ts).

Recommended interface:

```ts
interface ChatRepository {
  append(roomCode: string, message: ChatMessageRecord): Promise<void>;
  listRecent(roomCode: string, limit: number): Promise<ChatMessageRecord[]>;
  deleteByRoomCode(roomCode: string): Promise<void>;
}
```

### In-Memory Implementation

- Use a `Map<string, ChatMessageRecord[]>` keyed by `roomCode`.
- Append new messages and trim to the configured history limit.
- Return a shallow copy for reads so the service does not leak mutable state.

### Redis Implementation

Use a Redis list per room.

Recommended behavior:

- `RPUSH` serialized messages to `chat:rooms:<ROOM_CODE>`
- `LTRIM` to the latest history limit immediately after append
- `LRANGE` for reads
- `DEL` on room cleanup

This keeps storage simple and ordered.

### Cleanup Integration

Extend [inactive-room-cleanup.ts](/home/andy/minesweeper-flags/apps/server/src/app/realtime/inactive-room-cleanup.ts) so room cleanup also deletes room chat history.

That prevents stale chat records from outliving the room after:

- inactivity-based cleanup
- explicit room deletion paths

## Abuse Prevention And Safety

Chat needs its own throttling path separate from move handling.

### Validation Rules

- trim whitespace before validation
- reject empty strings
- reject messages above the configured max length
- store and render as plain text only
- never log full message content in structured logs

### Rate Limiting

Recommended defaults:

- `CHAT_MESSAGE_RATE_LIMIT_MAX=8`
- `CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS=10000`

Recommended key:

- rate limit per attached `playerId`

This avoids false positives from players sharing a proxy or public IP while still constraining spam in the room.

### Config Additions

Add these env vars to [env.ts](/home/andy/minesweeper-flags/apps/server/src/app/config/env.ts) and document them in [config-reference.md](/home/andy/minesweeper-flags/docs/config-reference.md):

- `CHAT_MESSAGE_MAX_LENGTH`
- `CHAT_HISTORY_LIMIT`
- `CHAT_MESSAGE_RATE_LIMIT_MAX`
- `CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS`

Update:

- `apps/server/.env.example`
- `docker-compose.yml` only if non-default overrides are needed

## Client Architecture

### Provider State

Extend [GameClientProvider.tsx](/home/andy/minesweeper-flags/apps/client/src/app/providers/GameClientProvider.tsx) with chat state and actions.

Recommended additions:

- `chatMessages: ChatMessageDto[]`
- `chatError: string | null`
- `chatDraft: string`
- `setChatDraft: (value: string) => void`
- `sendChatMessage: () => void`

Behavior:

- clear chat state when leaving the room
- preserve draft while reconnecting in the same room
- replace history on `chat:history`
- append on `chat:message` if `messageId` is new
- show chat-specific send failures inline instead of reusing the global gameplay error banner

### New Client Components

Recommended files:

- `apps/client/src/features/chat/ChatPanel.tsx`
- `apps/client/src/features/chat/ChatMessageList.tsx`

`ChatPanel` owns layout and composer wiring.
`ChatMessageList` owns rendering, scroll behavior, and empty state presentation.

### RoomPage Integration

Update [RoomPage.tsx](/home/andy/minesweeper-flags/apps/client/src/pages/RoomPage.tsx) so the waiting-room branch includes the chat panel within the right-side control stack.

Expected effect:

- the host can start the conversation before the guest arrives
- the waiting room feels more alive without needing a separate route or modal

### MatchView Integration

Update [MatchView.tsx](/home/andy/minesweeper-flags/apps/client/src/features/match/MatchView.tsx) so the live-match layout includes the chat rail.

Important layout rule:

- the board size and playability take priority over chat width

If the viewport cannot comfortably fit the extra rail, stack chat below the board instead of shrinking the board into an awkward size.

### Styling Work

Implement the visual integration in [styles.css](/home/andy/minesweeper-flags/apps/client/src/styles.css).

Recommended class additions:

- `.classic-chat-frame`
- `.chat-panel-header`
- `.chat-message-list`
- `.chat-message`
- `.chat-message.is-self`
- `.chat-message.is-opponent`
- `.chat-composer`
- `.chat-inline-status`

## Reconnect And Ordering Semantics

- The server remains the source of truth for message ordering.
- The client should not invent timestamps or local temporary IDs.
- Reconnect should request the latest stored history and replace the local list for that room.
- Incoming messages received after history restore should append normally.
- If a player reconnects after a restart with Redis enabled, recent chat should still be present.

## Testing Plan

### Shared Package

Add schema and protocol tests for:

- `chat:send`
- `chat:history`
- `chat:message`
- `chat:message-rejected`

### Server

Add coverage for:

- sending a valid chat message
- rejecting blank or oversized messages
- player-scoped chat rate limiting
- chat history returned on room create, join, and reconnect
- Redis-backed chat persistence and trimming
- cleanup removing room chat history
- chat events ignored for the wrong room

Likely touchpoints:

- [realtime.server.test.ts](/home/andy/minesweeper-flags/apps/server/src/app/realtime/realtime.server.test.ts)
- new chat repository/service tests
- [state-store.test.ts](/home/andy/minesweeper-flags/apps/server/src/app/state/state-store.test.ts)

### Client

Add coverage for:

- provider handling of `chat:history`
- provider append and dedupe behavior for `chat:message`
- chat-specific error handling for `chat:message-rejected`
- send behavior when connected vs reconnecting
- room exit clearing chat state

At minimum this should land in the existing provider-oriented test setup.

## Delivery Sequence

### Phase 1: Shared Types And Protocol

- add chat DTO schema
- add event names
- update protocol tests

### Phase 2: Server Persistence And Handlers

- add chat repository implementations
- extend state-store wiring
- add chat service and realtime handler path
- integrate cleanup deletion
- add server tests

### Phase 3: Client State And UI

- extend provider state and actions
- add chat components
- integrate waiting-room and match layouts
- add responsive styles
- add client tests

### Phase 4: Docs And Verification

- update config docs if env vars are added
- update README if the feature should be highlighted
- run `npm run test`
- run `npm run build`
- verify `make dev` and `make compose-up`

## Deployment Constraint

This feature should be documented as single-instance safe only until cross-instance fanout exists.

Important nuance:

- Redis-backed chat history can survive restarts now
- live chat delivery across multiple active server instances still requires future publish/subscribe fanout

That means the feature is compatible with the current repo posture, but not with true horizontal realtime scaling yet.

## Acceptance Criteria

- A host can send chat messages immediately after creating a room.
- A guest joining the room receives the latest chat history.
- Both players can exchange messages during a live match without affecting board input or rematch controls.
- Recent chat history survives reconnects.
- With `STATE_BACKEND=redis`, recent chat history survives a server restart.
- Room cleanup removes associated chat history.
- Desktop chat fits the current classic match window.
- Mobile chat remains usable without compressing the board into an unusable layout.
- Chat-specific validation and rate-limit failures are shown inline and do not overwrite unrelated gameplay state.
- Automated tests cover shared schemas, server behavior, and client state updates.
