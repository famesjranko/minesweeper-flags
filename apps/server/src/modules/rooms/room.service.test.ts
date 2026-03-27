import { describe, expect, it } from "vitest";
import { InMemoryRoomRepository } from "./room.repository.js";
import { RoomService } from "./room.service.js";

describe("room service", () => {
  it("serializes room joins and activity touches so players are not lost", async () => {
    const roomService = new RoomService(new InMemoryRoomRepository());
    const { room } = await roomService.createRoom("Host");

    const [joinResult] = await Promise.all([
      roomService.joinRoom(room.roomCode, "Guest"),
      roomService.touchRoomActivity(room.roomCode)
    ]);
    const updatedRoom = await roomService.getRoomByCode(room.roomCode);

    expect(updatedRoom.players).toHaveLength(2);
    expect(updatedRoom.players.map((player) => player.displayName)).toEqual([
      "Host",
      joinResult.player.displayName
    ]);
  });

  it("serializes concurrent joins so only one guest can claim the open seat", async () => {
    const roomService = new RoomService(new InMemoryRoomRepository());
    const { room } = await roomService.createRoom("Host");

    const results = await Promise.allSettled([
      roomService.joinRoom(room.roomCode, "Guest A"),
      roomService.joinRoom(room.roomCode, "Guest B")
    ]);
    const updatedRoom = await roomService.getRoomByCode(room.roomCode);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(updatedRoom.players).toHaveLength(2);
    expect(updatedRoom.players[0]?.displayName).toBe("Host");
    expect(["Guest A", "Guest B"]).toContain(updatedRoom.players[1]?.displayName);
  });
});
