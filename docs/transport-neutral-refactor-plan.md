# Transport-Neutral Refactor Plan

## Status

Implemented on March 28, 2026.

This document is kept as the implementation record for the transport-neutral refactor that is now in the codebase. The phased plan below reflects what was executed, not outstanding work.

## Goal

Refactor the app so transport concerns are isolated and the game flow is expressed in transport-neutral commands and room events.

This refactor should:

- keep WebSockets as the live production path
- preserve current UX and protocol behavior
- make `POST + SSE` a later adapter addition, not another rewrite
- avoid changing core room/match/chat business logic

This refactor should not try to solve:

- multi-instance fanout
- distributed locking
- auth/session redesign
- product or UX changes

## Phase 1: Freeze Existing Behavior

Purpose: protect the current app before moving architecture.

### Do

- Add characterization tests for the current client behavior at the provider boundary, using a browserless harness where practical.
- Extend websocket parity tests on the server where behavior is currently implicit.
- Capture the existing reconnect, duplicate-tab, chat draft recovery, and room bootstrap behavior as test fixtures.

### Cover

- create room
- join room
- reconnect from stored session
- stored-session lookup during room route bootstrap
- duplicate-tab or session-replaced handling
- chat draft recovery after disconnect or reconnect
- room-scoped event filtering
- offline queueing for room bootstrap actions
- chat send or reject
- match action or reject
- rematch request or cancel
- disconnect or reconnect side effects

### Result

- Current behavior is locked down before any architectural movement.

## Phase 2: Clarify Shared Contracts

Purpose: separate commands from streamed events conceptually.

### Do

- Keep the current wire schemas and payloads.
- Add shared type aliases or wrapper modules for:
  - inbound commands
  - outbound room stream events
  - direct response or error events
- Stop treating everything as socket events at the naming layer.

### Result

- The shared package expresses application messages without tying them to WebSocket as the only transport.

## Phase 3: Extract Server Command Layer

Purpose: move business orchestration out of websocket-bound handlers.

### Do

- Introduce transport-neutral command executors for:
  - create room
  - join room
  - reconnect player
  - handle disconnect or displaced-session lifecycle
  - send chat
  - apply match action
  - resign
  - request rematch
  - cancel rematch
- Make each command return neutral results such as:
  - optional session to bind
  - direct events to send to the caller
  - room events to broadcast
- Move orchestration logic out of the current room, chat, match, and rematch handlers into this command layer.

### Keep Out Of This Layer

- raw socket writes
- websocket attachment
- upgrade handling
- heartbeat
- abuse prevention

### Result

- Server application flow becomes transport-neutral.

## Phase 4: Turn The WebSocket Server Into An Adapter

Purpose: make the realtime server mostly transport mechanics.

### Do

- Replace the large websocket event switch with dispatch into the command layer.
- Keep websocket-specific responsibilities only:
  - upgrade admission
  - heartbeat
  - connection registry
  - abuse prevention
  - lifecycle or shutdown
  - socket or session binding
  - sending direct events
  - broadcasting room events to connected sockets
- Add small websocket adapter helpers where needed.

### Result

- The websocket server becomes an adapter on top of neutral command execution.

## Phase 5: Extract Client Store

Purpose: separate client state transitions from transport mechanics.

### Do

- Introduce a pure client store or reducer for:
  - session
  - match
  - chat
  - error
  - bomb mode
  - room-scoped event application
- Move current pure helper logic into that store layer.
- Make state application driven by incoming server events rather than direct provider-local mutation.

### Result

- Client state handling becomes transport-neutral and testable without browser sockets.

## Phase 6: Extract Client Controller

Purpose: separate client behavior policy from React and transport.

### Do

- Introduce a controller that owns:
  - create, join, and reconnect commands
  - saved-session lookup and room bootstrap policy
  - reconnect policy
  - duplicate-tab or session-replaced handling
  - bootstrap queue policy
  - chat pending or recovery behavior
- Move orchestration out of the React provider into the controller.
- Keep command construction and event application coordinated here.

### Result

- Client behavior rules are centralized in a neutral controller instead of scattered through the provider.

## Phase 7: Extract Client Transport Adapter

Purpose: isolate WebSocket-specific code on the client.

### Do

- Introduce a transport interface for:
  - connect
  - disconnect
  - send command
  - subscribe to incoming server events
  - connection status changes
- Implement a websocket transport adapter behind that interface.
- Move `new WebSocket(...)`, message parsing, and close or open event wiring out of the provider.

### Result

- The client can swap transports later without rewriting state or control flow.

## Phase 8: Extract Client Persistence Boundary

Purpose: isolate session persistence from transport and controller logic.

### Do

- Move `localStorage` session read, write, and remove operations behind a dedicated persistence module.
- Keep stored-session shape stable for now.
- Make reconnect and bootstrap logic depend on the persistence interface rather than calling storage helpers directly.
- Replace direct page or provider imports of storage helpers with the persistence boundary.

### Result

- Session persistence becomes an infrastructure detail rather than part of transport orchestration.

## Phase 9: Reduce `GameClientProvider` To A Thin Wrapper

Purpose: keep React wiring simple and stable.

### Do

- Make the provider responsible only for:
  - creating the controller and store
  - exposing the existing context API
  - translating controller or store output into React state where needed
- Preserve the public hook and consumer contract.
- Keep page and feature components mostly unchanged.

### Result

- The provider becomes a thin UI boundary instead of the app's transport engine.

## Phase 10: Cleanup And Verification

Purpose: leave the codebase coherent and ready for a second transport.

### Do

- Remove dead websocket-coupled helper paths replaced by the new layers.
- Keep only websocket adapter code in transport-specific modules.
- Verify the existing app still behaves the same from the user's perspective.
- Update lightweight architecture docs if useful.

### Done Means

- Server business orchestration is transport-neutral.
- Client state and behavior orchestration are transport-neutral.
- WebSocket code is isolated to server and client adapter layers.
- `useGameClient()` and the current UI flows still work unchanged.
- The codebase is ready for a future `POST + SSE` transport without another deep rewrite.
