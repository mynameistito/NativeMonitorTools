import { Effect } from "effect";

import { makeNativeUiApplicationLayer } from "../desktop/src/application/composition";
import { NativeUiApplication } from "../desktop/src/application/native-ui";
import { serveNativeUiIpc } from "../desktop/src/ipc/server";
import { makeStdioTransport } from "../desktop/src/ipc/transport";
import {
  parseDesktopPlatform,
  resolveDesktopPaths,
} from "../desktop/src/storage/configuration";

const run = async (): Promise<void> => {
  const paths = resolveDesktopPaths(
    process.env,
    parseDesktopPlatform(process.platform),
    process.env.USERPROFILE ?? process.env.HOME ?? "."
  );
  const application = await Effect.runPromise(
    Effect.provide(
      NativeUiApplication,
      makeNativeUiApplicationLayer(paths, process.platform)
    )
  );
  await serveNativeUiIpc(makeStdioTransport(), application);
};

if (import.meta.main) {
  try {
    await run();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backend IPC failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
