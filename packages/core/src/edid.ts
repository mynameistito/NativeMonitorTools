import { Effect } from "effect";

import { InvalidEdid } from "./errors";

/** The byte length of an EDID base block. */
export const EDID_BASE_BLOCK_LENGTH = 128;

/** The decoded physical dimensions reported by an EDID base block. */
export interface EdidPhysicalSize {
  /** The physical width in centimetres, or zero when the source omits it. */
  readonly widthCm: number;
  /** The physical height in centimetres, or zero when the source omits it. */
  readonly heightCm: number;
}

/** A preferred detailed timing decoded from an EDID base block. */
export interface EdidPreferredTiming {
  /** The pixel clock in kilohertz. */
  readonly pixelClockKHz: number;
  /** The number of active horizontal pixels. */
  readonly horizontalActive: number;
  /** The number of horizontal blanking pixels. */
  readonly horizontalBlanking: number;
  /** The number of active vertical lines. */
  readonly verticalActive: number;
  /** The number of vertical blanking lines. */
  readonly verticalBlanking: number;
  /** The calculated refresh rate in hertz. */
  readonly refreshRateHz: number;
  /** The horizontal sync offset in pixels. */
  readonly horizontalSyncOffset: number;
  /** The horizontal sync pulse width in pixels. */
  readonly horizontalSyncWidth: number;
  /** The vertical sync offset in lines. */
  readonly verticalSyncOffset: number;
  /** The vertical sync pulse width in lines. */
  readonly verticalSyncWidth: number;
  /** The physical image width in millimetres. */
  readonly horizontalImageSizeMm: number;
  /** The physical image height in millimetres. */
  readonly verticalImageSizeMm: number;
  /** The horizontal border size in pixels. */
  readonly horizontalBorder: number;
  /** The vertical border size in lines. */
  readonly verticalBorder: number;
  /** Whether the timing is interlaced. */
  readonly interlaced: boolean;
}

/** The useful identity and display properties decoded from an EDID base block. */
export interface EdidBaseBlock {
  /** The three-letter EISA manufacturer identifier. */
  readonly manufacturer: string;
  /** The manufacturer-assigned product code. */
  readonly productCode: number;
  /** The manufacturer-assigned serial number. */
  readonly serialNumber: number;
  /** The optional monitor name from a display-name descriptor. */
  readonly displayName?: string;
  /** The physical size reported by the base block. */
  readonly physicalSize: EdidPhysicalSize;
  /** The first usable detailed timing, when one is present. */
  readonly preferredTiming?: EdidPreferredTiming;
}

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
const DETAILED_DESCRIPTOR_OFFSETS = [54, 72, 90, 108];

interface ParsedDescriptors {
  displayName?: string;
  preferredTiming?: EdidPreferredTiming;
}

const invalidEdid = (
  inputLength: number,
  reason: string,
  offset?: number
): Effect.Effect<never, InvalidEdid> => {
  const details =
    offset === undefined
      ? { inputLength, reason }
      : { inputLength, offset, reason };
  return Effect.fail(new InvalidEdid(details));
};

const parseManufacturer = (
  view: DataView,
  inputLength: number
): Effect.Effect<string, InvalidEdid> => {
  const first = view.getUint8(8);
  const second = view.getUint8(9);
  const codes = [
    Math.floor(first / 4) % 32,
    (first % 4) * 8 + Math.floor(second / 32),
    second % 32,
  ];

  const hasInvalidCode = codes.some((code) => code < 1 || code > 26);
  if (first >= 128 || hasInvalidCode) {
    return invalidEdid(
      inputLength,
      "EDID manufacturer identifier is invalid",
      8
    );
  }

  return Effect.succeed(
    codes.map((code) => String.fromCodePoint(64 + code)).join("")
  );
};

const parseDisplayName = (
  view: DataView,
  descriptorOffset: number,
  inputLength: number
): Effect.Effect<string | undefined, InvalidEdid> => {
  const characters: string[] = [];
  for (let index = 5; index < 18; index += 1) {
    const value = view.getUint8(descriptorOffset + index);
    if (value === 0x00 || value === 0x0a) {
      break;
    }
    if (value < 0x20 || value > 0x7e) {
      return invalidEdid(
        inputLength,
        "EDID display name contains a non-ASCII character",
        descriptorOffset + index
      );
    }
    characters.push(String.fromCodePoint(value));
  }

  const name = characters.join("").trim();
  return Effect.succeed(name.length === 0 ? undefined : name);
};

const parsePreferredTiming = (
  view: DataView,
  descriptorOffset: number,
  inputLength: number
): Effect.Effect<EdidPreferredTiming, InvalidEdid> => {
  const pixelClock10KHz = view.getUint16(descriptorOffset, true);
  const horizontalActive =
    view.getUint8(descriptorOffset + 2) +
    Math.floor(view.getUint8(descriptorOffset + 4) / 16) * 256;
  const horizontalBlanking =
    view.getUint8(descriptorOffset + 3) +
    (view.getUint8(descriptorOffset + 4) % 16) * 256;
  const verticalActive =
    view.getUint8(descriptorOffset + 5) +
    Math.floor(view.getUint8(descriptorOffset + 7) / 16) * 256;
  const verticalBlanking =
    view.getUint8(descriptorOffset + 6) +
    (view.getUint8(descriptorOffset + 7) % 16) * 256;

  const hasInvalidDimensions =
    pixelClock10KHz === 0 || horizontalActive === 0 || verticalActive === 0;
  const hasInvalidTotals =
    horizontalActive + horizontalBlanking === 0 ||
    verticalActive + verticalBlanking === 0;
  if (hasInvalidDimensions || hasInvalidTotals) {
    return invalidEdid(
      inputLength,
      "EDID detailed timing has invalid dimensions",
      descriptorOffset
    );
  }

  const syncHighBits = view.getUint8(descriptorOffset + 10);
  const syncLowBits = view.getUint8(descriptorOffset + 11);
  const horizontalSyncOffset =
    view.getUint8(descriptorOffset + 8) + Math.floor(syncHighBits / 64) * 256;
  const horizontalSyncWidth =
    view.getUint8(descriptorOffset + 9) +
    (Math.floor(syncHighBits / 16) % 4) * 256;
  const verticalSyncOffset =
    Math.floor(syncLowBits / 16) + (Math.floor(syncHighBits / 4) % 4) * 16;
  const verticalSyncWidth = (syncLowBits % 16) + (syncHighBits % 4) * 16;
  const horizontalImageSizeMm =
    view.getUint8(descriptorOffset + 12) +
    Math.floor(view.getUint8(descriptorOffset + 14) / 16) * 256;
  const verticalImageSizeMm =
    view.getUint8(descriptorOffset + 13) +
    (view.getUint8(descriptorOffset + 14) % 16) * 256;
  const horizontalTotal = horizontalActive + horizontalBlanking;
  const verticalTotal = verticalActive + verticalBlanking;

  return Effect.succeed({
    horizontalActive,
    horizontalBlanking,
    horizontalBorder: view.getUint8(descriptorOffset + 15),
    horizontalImageSizeMm,
    horizontalSyncOffset,
    horizontalSyncWidth,
    interlaced: view.getUint8(descriptorOffset + 17) >= 128,
    pixelClockKHz: pixelClock10KHz * 10,
    refreshRateHz:
      (pixelClock10KHz * 10_000) / (horizontalTotal * verticalTotal),
    verticalActive,
    verticalBlanking,
    verticalBorder: view.getUint8(descriptorOffset + 16),
    verticalImageSizeMm,
    verticalSyncOffset,
    verticalSyncWidth,
  });
};

const parseDescriptors = (
  view: DataView,
  inputLength: number
): Effect.Effect<ParsedDescriptors, InvalidEdid> =>
  Effect.gen(function* parseDescriptorsEffect() {
    let displayName: string | undefined;
    let preferredTiming: EdidPreferredTiming | undefined;
    const hasPreferredTiming = Math.floor(view.getUint8(24) / 2) % 2 === 1;

    for (const descriptorOffset of DETAILED_DESCRIPTOR_OFFSETS) {
      const pixelClock = view.getUint16(descriptorOffset, true);
      if (
        pixelClock !== 0 &&
        preferredTiming === undefined &&
        hasPreferredTiming
      ) {
        preferredTiming = yield* parsePreferredTiming(
          view,
          descriptorOffset,
          inputLength
        );
        continue;
      }

      if (
        pixelClock === 0 &&
        view.getUint8(descriptorOffset + 1) === 0 &&
        view.getUint8(descriptorOffset + 2) === 0 &&
        view.getUint8(descriptorOffset + 3) === 0xfc
      ) {
        const name = yield* parseDisplayName(
          view,
          descriptorOffset,
          inputLength
        );
        if (name !== undefined && displayName === undefined) {
          displayName = name;
        }
      }
    }

    if (displayName === undefined) {
      return preferredTiming === undefined ? {} : { preferredTiming };
    }
    return preferredTiming === undefined
      ? { displayName }
      : { displayName, preferredTiming };
  });

/**
 * Parse the bounded 128-byte base block of an EDID.
 *
 * Additional bytes, such as EDID extension blocks, are ignored. The parser
 * checks the base header and checksum before decoding fields, and reports
 * malformed data as `InvalidEdid` rather than throwing.
 *
 * @param input - Raw EDID bytes supplied by a platform adapter.
 * @returns An Effect containing the decoded base block or a typed parse error.
 */
export const parseEdidBaseBlock = (
  input: Uint8Array
): Effect.Effect<EdidBaseBlock, InvalidEdid> => {
  if (input.length < EDID_BASE_BLOCK_LENGTH) {
    return invalidEdid(
      input.length,
      `EDID base block must contain at least ${EDID_BASE_BLOCK_LENGTH} bytes`
    );
  }

  const block = input.subarray(0, EDID_BASE_BLOCK_LENGTH);
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);

  for (let offset = 0; offset < EDID_HEADER.length; offset += 1) {
    if (view.getUint8(offset) !== EDID_HEADER[offset]) {
      return invalidEdid(input.length, "EDID header is invalid", offset);
    }
  }

  let checksum = 0;
  for (let offset = 0; offset < EDID_BASE_BLOCK_LENGTH; offset += 1) {
    checksum = (checksum + view.getUint8(offset)) % 256;
  }
  if (checksum !== 0) {
    return invalidEdid(
      input.length,
      "EDID base block checksum is invalid",
      127
    );
  }

  return Effect.gen(function* parseEdidEffect() {
    const manufacturer = yield* parseManufacturer(view, input.length);
    const descriptors = yield* parseDescriptors(view, input.length);

    const identity = {
      manufacturer,
      physicalSize: {
        heightCm: view.getUint8(22),
        widthCm: view.getUint8(21),
      },
      productCode: view.getUint16(10, true),
      serialNumber: view.getUint32(12, true),
    };
    if (descriptors.displayName === undefined) {
      return descriptors.preferredTiming === undefined
        ? identity
        : { ...identity, preferredTiming: descriptors.preferredTiming };
    }
    return descriptors.preferredTiming === undefined
      ? { ...identity, displayName: descriptors.displayName }
      : {
          ...identity,
          displayName: descriptors.displayName,
          preferredTiming: descriptors.preferredTiming,
        };
  });
};
