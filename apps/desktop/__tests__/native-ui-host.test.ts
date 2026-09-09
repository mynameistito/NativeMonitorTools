import { describe, expect, it } from "vitest";

import {
  decodeNativeUiArgument,
  encodeNativeUiArgument,
  runNativeUiRequest,
} from "../src/native-ui-host";

describe("Native SDK UI host framing", () => {
  it("decodes the bounded hexadecimal service argument", () => {
    expect(decodeNativeUiArgument("01010000")).toEqual(
      new Uint8Array([1, 1, 0, 0])
    );
    expect(decodeNativeUiArgument("01010")).toBeNull();
    expect(decodeNativeUiArgument("0101zz00")).toBeNull();
  });

  it("round-trips every byte through the text-only response carrier", () => {
    const frame = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(decodeNativeUiArgument(encodeNativeUiArgument(frame))).toEqual(
      frame
    );
  });

  it("rejects malformed requests without touching platform services", async () => {
    const response = await runNativeUiRequest(new Uint8Array([1, 1, 0]));
    const message = new TextEncoder().encode(
      "Native UI request is not a valid protocol v1 frame."
    );
    const high = Math.trunc(message.length / 256);
    expect(response).toEqual(
      new Uint8Array([1, 255, 0, message.length - high * 256, high, ...message])
    );
  });
});
