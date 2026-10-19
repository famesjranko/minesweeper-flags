import type { IncomingMessage } from "node:http";

export const readJsonBody = async (
  request: IncomingMessage,
  maxPayloadBytes: number
): Promise<unknown> => {
  const contentLengthHeader = request.headers["content-length"];
  const contentLengthValue = Array.isArray(contentLengthHeader)
    ? contentLengthHeader[0]
    : contentLengthHeader;

  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);

    if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      throw new Error("payload-too-large");
    }
  }

  let bodyBytes = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyBytes += chunkBuffer.byteLength;

    if (bodyBytes > maxPayloadBytes) {
      throw new Error("payload-too-large");
    }

    chunks.push(chunkBuffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid-json");
  }
};
