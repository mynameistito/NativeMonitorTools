import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import { InvalidEdid, parseEdidBaseBlock } from "../src/index";

const run = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);

const setChecksum = (block: Uint8Array): void => {
  let checksum = 0;
  for (let index = 0; index < 127; index += 1) {
    checksum = (checksum + (block[index] ?? 0)) % 256;
  }
  block[127] = (256 - checksum) % 256;
};

const failure = <A, E>(effect: Effect.Effect<A, E>): E => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected an EDID parse failure");
  }
  const found = Cause.findError(exit.cause);
  if (!Result.isSuccess(found)) {
    throw new Error("Expected a typed EDID parse failure");
  }
  return found.success;
};

const makeEdid = (): Uint8Array => {
  const block = new Uint8Array(128);
  block.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00], 0);

  // EISA manufacturer code "DEL".
  block[8] = 16;
  block[9] = 172;
  block[10] = 0x34;
  block[11] = 0x12;
  block[12] = 0x12;
  block[13] = 0x34;
  block[14] = 0x56;
  block[15] = 0x78;
  block[21] = 52;
  block[22] = 32;
  block[24] = 0x02;

  const nameDescriptor = 54;
  block[nameDescriptor + 3] = 0xfc;
  for (const [index, character] of [..."DELL U2720Q\n"].entries()) {
    block[nameDescriptor + 5 + index] = character.codePointAt(0) ?? 0;
  }

  const timing = 72;
  block[timing] = 0x56;
  // 241.5 MHz, in 10 kHz units.
  block[timing + 1] = 0x5e;
  block[timing + 2] = 0x00;
  block[timing + 3] = 0xa0;
  // 2560 active, 160 blanking.
  block[timing + 4] = 0xa0;
  block[timing + 5] = 0xa0;
  block[timing + 6] = 0x29;
  // 1440 active, 41 blanking.
  block[timing + 7] = 0x50;
  block[timing + 8] = 48;
  block[timing + 9] = 32;
  block[timing + 10] = 0x00;
  block[timing + 11] = 0x35;
  block[timing + 12] = 0x55;
  block[timing + 13] = 0x50;
  block[timing + 14] = 0x21;
  block[timing + 15] = 0;
  block[timing + 16] = 0;
  block[timing + 17] = 0x1a;

  setChecksum(block);
  return block;
};

describe("EDID base block parser", () => {
  it("decodes identity, name, physical size, and preferred timing", () => {
    const parsed = run(parseEdidBaseBlock(makeEdid()));

    expect(parsed.manufacturer).toBe("DEL");
    expect(parsed.productCode).toBe(0x12_34);
    expect(parsed.serialNumber).toBe(0x78_56_34_12);
    expect(parsed.displayName).toBe("DELL U2720Q");
    expect(parsed.physicalSize).toEqual({ heightCm: 32, widthCm: 52 });
    expect(parsed.preferredTiming).toMatchObject({
      horizontalActive: 2560,
      horizontalBlanking: 160,
      horizontalSyncOffset: 48,
      horizontalSyncWidth: 32,
      interlaced: false,
      pixelClockKHz: 241_500,
      verticalActive: 1440,
      verticalBlanking: 41,
      verticalSyncOffset: 3,
      verticalSyncWidth: 5,
    });
    expect(parsed.preferredTiming?.refreshRateHz).toBeCloseTo(59.95, 1);
  });

  it("parses only the bounded base block when extension bytes follow it", () => {
    const base = makeEdid();
    const withExtension = new Uint8Array(256);
    withExtension.set(base);
    withExtension[128] = 0x70;
    withExtension[255] = 0x42;

    expect(run(parseEdidBaseBlock(withExtension))).toEqual(
      run(parseEdidBaseBlock(base))
    );
  });

  it("returns a typed error for short, bad-header, and bad-checksum input", () => {
    const short = failure(parseEdidBaseBlock(new Uint8Array(127)));
    expect(short).toBeInstanceOf(InvalidEdid);
    expect(short._tag).toBe("InvalidEdid");
    expect(short.inputLength).toBe(127);

    const badHeader = makeEdid();
    badHeader[1] = 0;
    const headerError = failure(parseEdidBaseBlock(badHeader));
    expect(headerError._tag).toBe("InvalidEdid");
    expect(headerError.offset).toBe(1);

    const badChecksum = makeEdid();
    badChecksum[20] = (badChecksum[20] ?? 0) === 0 ? 1 : 0;
    const checksumError = failure(parseEdidBaseBlock(badChecksum));
    expect(checksumError._tag).toBe("InvalidEdid");
    expect(checksumError.offset).toBe(127);
  });

  it("rejects invalid manufacturer encodings and malformed display names", () => {
    const invalidManufacturer = makeEdid();
    invalidManufacturer[8] = 0;
    invalidManufacturer[9] = 0;
    setChecksum(invalidManufacturer);
    const manufacturerError = failure(parseEdidBaseBlock(invalidManufacturer));
    expect(manufacturerError.reason).toContain("manufacturer");

    const invalidName = makeEdid();
    invalidName[54 + 5] = 0x01;
    setChecksum(invalidName);
    const nameError = failure(parseEdidBaseBlock(invalidName));
    expect(nameError.reason).toContain("display name");
  });

  it("omits optional fields when the base block has no name or detailed timing", () => {
    const block = makeEdid();
    block.fill(0, 54, 126);
    block.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00], 0);
    block[8] = 16;
    block[9] = 172;
    setChecksum(block);

    const parsed = run(parseEdidBaseBlock(block));
    expect(parsed.displayName).toBeUndefined();
    expect(parsed.preferredTiming).toBeUndefined();
  });

  it("does not label a detailed timing as preferred when the feature flag is clear", () => {
    const block = makeEdid();
    block[24] = 0;
    setChecksum(block);

    expect(run(parseEdidBaseBlock(block)).preferredTiming).toBeUndefined();
  });
});
