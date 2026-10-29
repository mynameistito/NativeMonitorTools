/* oxlint-disable promise/prefer-await-to-then, github/no-then -- The client queue preserves response ordering across concurrent UI calls. */

import { NativeUiIpcClientError } from "./client-error";
import {
  encodeIpcRequest,
  IPC_PROTOCOL_VERSION,
  parseIpcResponse,
  MAX_IPC_MESSAGE_BYTES,
} from "./protocol";
import type { IpcRequest, IpcRequestInput, IpcResponse } from "./protocol";
import { IpcTransportError, readJsonLines } from "./transport";
import type { IpcTransport } from "./transport";

/** Options controlling the client response-size limit. */
export interface IpcClientOptions {
  readonly maxMessageBytes?: number;
}

const safeMaxMessageBytes = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : MAX_IPC_MESSAGE_BYTES;

/**
 * Small sequential client for the versioned Native SDK UI protocol.
 *
 * Calls are serialized so one line-oriented transport can safely be shared by
 * multiple UI actions without allowing responses to be paired with the wrong
 * request.
 */
export class NativeUiIpcClient {
  private readonly lines: AsyncIterator<string>;
  private readonly transport: IpcTransport;
  private readonly maxMessageBytes: number;
  private nextRequestNumber = 1;
  private queue: Promise<null> = Promise.resolve(null);

  /** Construct a client over an existing transport. */
  public constructor(transport: IpcTransport, options: IpcClientOptions = {}) {
    this.transport = transport;
    this.maxMessageBytes = safeMaxMessageBytes(options.maxMessageBytes);
    this.lines = readJsonLines(transport.readChunks(), this.maxMessageBytes)[
      Symbol.asyncIterator
    ]();
  }

  /**
   * Send one typed method call and await its matching response.
   *
   * @param input - A method and already-shaped parameters.
   * @returns The server response, including typed application errors.
   */
  public call(input: IpcRequestInput): Promise<IpcResponse> {
    const operation = this.queue.then(() => this.performCall(input));
    this.queue = operation.then(
      () => null,
      () => null
    );
    return operation;
  }

  private async performCall(input: IpcRequestInput): Promise<IpcResponse> {
    const request: IpcRequest = {
      ...input,
      id: `native-ui-${this.nextRequestNumber}`,
      version: IPC_PROTOCOL_VERSION,
    };
    this.nextRequestNumber += 1;
    await this.transport.writeLine(encodeIpcRequest(request));
    let next: IteratorResult<string>;
    try {
      next = await this.lines.next();
    } catch (error) {
      if (error instanceof IpcTransportError) {
        throw new NativeUiIpcClientError({
          code: "CLOSED",
          reason: error.reason,
        });
      }
      throw error;
    }
    if (next.done) {
      throw new NativeUiIpcClientError({
        code: "CLOSED",
        reason: "IPC transport closed before a response was received",
      });
    }
    const parsed = parseIpcResponse(next.value);
    if (parsed._tag === "Failure") {
      throw parsed.error;
    }
    if (parsed.value.id !== request.id) {
      throw new NativeUiIpcClientError({
        code: "RESPONSE_ID_MISMATCH",
        reason: "IPC response id did not match the pending request",
      });
    }
    return parsed.value;
  }
}
