/* oxlint-disable no-await-in-loop, anti-slop/no-runtime-typeof -- Stream readers must consume chunks serially at this untrusted byte boundary. */

import { Data } from "effect";

import { MAX_IPC_MESSAGE_BYTES } from "./protocol";

/** One raw chunk supplied by an IPC transport. */
export type IpcChunk = string | Uint8Array;

/** A writable endpoint accepted by the stdio adapter and test seams. */
export interface IpcWritable {
  readonly write: (chunk: string) => boolean | PromiseLike<boolean>;
}

/** Transport boundary shared by the JSON-lines server and client. */
export interface IpcTransport {
  readonly readChunks: () => AsyncIterable<IpcChunk>;
  readonly writeLine: (line: string) => Promise<void>;
}

/** Transport framing failure before a complete JSON-lines message exists. */
export class IpcTransportError extends Data.TaggedError("IpcTransportError")<{
  readonly code: "INVALID_UTF8" | "MESSAGE_TOO_LARGE";
  readonly reason: string;
}> {}

/** Options for the stdio transport seam. */
export interface StdioTransportOptions {
  readonly input?: ReadableStream<Uint8Array>;
  readonly output?: IpcWritable;
}

const textEncoder = new TextEncoder();
const messageTooLargeReason = "IPC message exceeds the configured size limit";

const readStream = async function* readStream(
  input: ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array> {
  const reader = input.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }
      if (next.value !== undefined) {
        yield next.value;
      }
    }
  } finally {
    reader.releaseLock();
  }
};

/**
 * Split raw transport chunks into bounded UTF-8 JSON-lines records.
 *
 * The final unterminated record is accepted at EOF, which makes the seam easy
 * to use with hosts that close stdin after one request.
 *
 * @param chunks - Raw chunks received from a transport.
 * @param maxMessageBytes - Maximum UTF-8 bytes for one record.
 * @returns An async iterable of complete lines without line terminators.
 * @yields {string} Complete JSON-lines records without line terminators.
 */
export const readJsonLines = async function* readJsonLines(
  chunks: AsyncIterable<IpcChunk>,
  maxMessageBytes: number = MAX_IPC_MESSAGE_BYTES
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";

  for await (const chunk of chunks) {
    let text: string;
    try {
      text =
        typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });
    } catch {
      throw new IpcTransportError({
        code: "INVALID_UTF8",
        reason: "IPC input is not valid UTF-8",
      });
    }
    buffer += text;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (textEncoder.encode(line).byteLength > maxMessageBytes) {
        throw new IpcTransportError({
          code: "MESSAGE_TOO_LARGE",
          reason: messageTooLargeReason,
        });
      }
      yield line;
      newline = buffer.indexOf("\n");
    }
    if (textEncoder.encode(buffer).byteLength > maxMessageBytes) {
      throw new IpcTransportError({
        code: "MESSAGE_TOO_LARGE",
        reason: messageTooLargeReason,
      });
    }
  }

  try {
    buffer += decoder.decode();
  } catch {
    throw new IpcTransportError({
      code: "INVALID_UTF8",
      reason: "IPC input is not valid UTF-8",
    });
  }
  if (buffer.length > 0) {
    if (textEncoder.encode(buffer).byteLength > maxMessageBytes) {
      throw new IpcTransportError({
        code: "MESSAGE_TOO_LARGE",
        reason: messageTooLargeReason,
      });
    }
    yield buffer;
  }
};

/**
 * Construct a JSON-lines transport over Bun's stdin and stdout.
 *
 * This is intentionally a stdio transport. Bun does not expose a stable
 * named-pipe server API here, so this boundary makes no named-pipe claim.
 *
 * @param options - Optional readable and writable seams for hosts and tests.
 * @returns A transport backed by stdio or the supplied seams.
 */
export const makeStdioTransport = (
  options: StdioTransportOptions = {}
): IpcTransport => {
  const input = options.input ?? Bun.stdin.stream();
  const output = options.output ?? process.stdout;
  return {
    readChunks: () => readStream(input),
    writeLine: async (line) => {
      await output.write(`${line}\n`);
    },
  };
};
