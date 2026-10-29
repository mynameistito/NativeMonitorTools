import { spawnSync } from "node:child_process";

const BACKEND_TIMEOUT_MS = 30_000;
const HEX_DIGITS = "0123456789abcdef";

const hexDigit = (value: number): string => HEX_DIGITS[value] ?? "0";

const hexValue = (value: string): number =>
  HEX_DIGITS.indexOf(value.toLowerCase());

const decodeHex = (value: string): Uint8Array => {
  if (value.length === 0 || value.length % 2 !== 0) {
    // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
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
      // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
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
// oxlint-disable-next-line eslint/func-style -- Native SDK service discovery requires a named function export.
export function request(input: Uint8Array): Uint8Array {
  const command = "native-monitor-tools-backend.exe";
  let frame = "";
  for (const byte of input) {
    frame += hexDigit(Math.floor(byte / 16)) + hexDigit(byte % 16);
  }
  // oxlint-disable-next-line sonarjs/no-os-command-from-path -- The Native SDK contract discovers the sibling backend from PATH in development and packaged environments.
  const result = spawnSync(command, ["--native-ui", frame], {
    encoding: "utf-8",
    timeout: BACKEND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    if (result.status === null && result.signal !== null) {
      // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
      throw {
        kind: "backend_timeout",
        message: "The desktop backend did not answer before the timeout.",
      };
    }
    // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
    throw {
      kind: "backend_spawn",
      message: "The desktop backend could not be started.",
    };
  }
  if (result.status !== 0) {
    // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
    throw {
      kind: "backend_exit",
      message: "The desktop backend exited before answering.",
    };
  }
  if (result.stdout.length > 128 * 1024) {
    // oxlint-disable-next-line eslint/no-throw-literal -- Native SDK service contracts require inline { kind, message } errors at this boundary.
    throw {
      kind: "backend_output",
      message: "The desktop backend response was too large.",
    };
  }
  return decodeHex(result.stdout);
}
