import { Effect } from "effect";

import {
  makeNativeUiApplicationLayer,
  NativeUiApplication,
} from "../desktop/src/application";
import { makeStdioTransport, serveNativeUiIpc } from "../desktop/src/ipc";
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
  run().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Backend IPC failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
