import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { createId } from "../../lib/ids/id.js";
import type { RoomService } from "../rooms/room.service.js";
import type { ChatRepository } from "./chat.repository.js";

interface ChatServiceOptions {
  historyLimit: number;
  messageMaxLength: number;
}

interface ChatAuthor {
  playerId: string;
  displayName: string;
}

const normalizeChatText = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

export class ChatService {
  constructor(
    private readonly roomService: RoomService,
    private readonly chatRepository: ChatRepository,
    private readonly options: ChatServiceOptions
  ) {}

  async listRecentMessages(roomCode: string): Promise<ChatMessageDto[]> {
    await this.roomService.getRoomByCode(roomCode);
    return await this.chatRepository.listRecent(roomCode, this.options.historyLimit);
  }

  async sendMessage(
    roomCode: string,
    author: ChatAuthor,
    text: string,
    sentAt: number
  ): Promise<ChatMessageDto> {
    const room = await this.roomService.getRoomByCode(roomCode);

    if (!room.players.some((player) => player.playerId === author.playerId)) {
      throw new Error("That player is not part of this room.");
    }

    const normalizedText = normalizeChatText(text);

    if (!normalizedText) {
      throw new Error("Type a message before sending.");
    }

    if (normalizedText.length > this.options.messageMaxLength) {
      throw new Error(
        `Chat messages can be at most ${this.options.messageMaxLength} characters.`
      );
    }

    const message: ChatMessageDto = {
      messageId: createId(),
      playerId: author.playerId,
      displayName: author.displayName,
      text: normalizedText,
      sentAt
    };

    await this.chatRepository.append(roomCode, message);

    return message;
  }
}
