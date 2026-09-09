import { spawnSync } from "node:child_process";

const hexDigit = (value: number): string => {
  switch (value) {
    case 0: {
      return "0";
    }
    case 1: {
      return "1";
    }
    case 2: {
      return "2";
    }
    case 3: {
      return "3";
    }
    case 4: {
      return "4";
    }
    case 5: {
      return "5";
    }
    case 6: {
      return "6";
    }
    case 7: {
      return "7";
    }
    case 8: {
      return "8";
    }
    case 9: {
      return "9";
    }
    case 10: {
      return "a";
    }
    case 11: {
      return "b";
    }
    case 12: {
      return "c";
    }
    case 13: {
      return "d";
    }
    case 14: {
      return "e";
    }
    case 15: {
      return "f";
    }
  }
  return "0";
};

const hexValue = (value: string): number => {
  switch (value) {
    case "0": {
      return 0;
    }
    case "1": {
      return 1;
    }
    case "2": {
      return 2;
    }
    case "3": {
      return 3;
    }
    case "4": {
      return 4;
    }
    case "5": {
      return 5;
    }
    case "6": {
      return 6;
    }
    case "7": {
      return 7;
    }
    case "8": {
      return 8;
    }
    case "9": {
      return 9;
    }
    case "a":
    case "A": {
      return 10;
    }
    case "b":
    case "B": {
      return 11;
    }
    case "c":
    case "C": {
      return 12;
    }
    case "d":
    case "D": {
      return 13;
    }
    case "e":
    case "E": {
      return 14;
    }
    case "f":
    case "F": {
      return 15;
    }
    default: {
      return -1;
    }
  }
};

const decodeHex = (value: string): Uint8Array => {
  if (value.length === 0 || value.length % 2 !== 0) {
    throw {
      kind: "backend_output",
      message: "The desktop backend returned an invalid response.",
    };
  }
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const high = hexValue(value.slice(index * 2, index * 2 + 1));
    const low = hexValue(value.slice(index * 2 + 1, index * 2 + 2));
    if (high < 0 || low < 0) {
      throw {
        kind: "backend_output",
        message: "The desktop backend returned an invalid response.",
      };
    }
    output[index] = high * 16 + low;
  }
  return output;
};

/**
 * Forward one bounded binary request to the Bun/Effect desktop backend.
 *
 * The executable is intentionally discovered through PATH so development can
 * prepend the workspace's build directory and installed packages can place the
 * backend beside the Native SDK executable without changing the UI core.
 */
export function request(input: Uint8Array): Uint8Array {
  const command = "native-monitor-tools-backend.exe";
  let frame = "";
  for (const byte of input) {
    frame += hexDigit(byte >>> 4) + hexDigit(byte & 15);
  }
  const result = spawnSync(command, ["--native-ui", frame], {
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw {
      kind: "backend_spawn",
      message: "The desktop backend could not be started.",
    };
  }
  if (result.status !== 0) {
    throw {
      kind: "backend_exit",
      message: "The desktop backend exited before answering.",
    };
  }
  if (result.stdout.length > 128 * 1024) {
    throw {
      kind: "backend_output",
      message: "The desktop backend response was too large.",
    };
  }
  return decodeHex(result.stdout);
}
