import { Data } from "effect";

/** Failure raised by the typed IPC client seam. */
export class NativeUiIpcClientError extends Data.TaggedError(
  "NativeUiIpcClientError"
)<{
  readonly code: "CLOSED" | "RESPONSE_ID_MISMATCH";
  readonly reason: string;
}> {}
