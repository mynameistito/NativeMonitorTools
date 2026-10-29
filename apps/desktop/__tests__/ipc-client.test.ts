/* oxlint-disable no-await-in-loop, promise/avoid-new -- The in-memory transport queue models one serial reader without module mocks. */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  NativeUiAdapterError,
  NativeUiIpcClient,
  serveNativeUiIpc,
} from "../src";
import type {
  IpcChunk,
  IpcTransport,
  NativeUiApplicationApi,
  NativeUiApplicationError,
} from "../src";

const makeQueue = () => {
  const values: IpcChunk[] = [];
  const waiters: ((result: IteratorResult<IpcChunk, null>) => void)[] = [];
  let closed = false;

  return {
    close: () => {
      closed = true;
      for (const resolve of waiters.splice(0)) {
        resolve({ done: true, value: null });
      }
    },
    push: (value: IpcChunk) => {
      const resolve = waiters.shift();
      if (resolve === undefined) {
        values.push(value);
        return;
      }
      resolve({ done: false, value });
    },
    read: async function* read(): AsyncGenerator<IpcChunk, null> {
      while (true) {
        const value = values.shift();
        if (value !== undefined) {
          yield value;
          continue;
        }
        if (closed) {
          return null;
        }
        const next = await new Promise<IteratorResult<IpcChunk, null>>(
          (resolve) => {
            waiters.push(resolve);
          }
        );
        if (next.done) {
          return null;
        }
        yield next.value;
      }
    },
  };
};

const unavailable = <T>(): Effect.Effect<T, NativeUiApplicationError> =>
  Effect.fail(
    new NativeUiAdapterError({
      kind: "unsupported",
      operation: "discover",
      reason: "Not used by this client test",
    })
  );

const makeApplication = (): NativeUiApplicationApi => ({
  capabilitySnapshot: () => ({
    capabilities: {
      color: { available: true },
      monitorDiscovery: { available: true },
      profileApplyPreview: { available: true },
      profileDiff: { available: true },
      profileList: { available: true },
      profileSave: { available: true },
      profileShow: { available: true },
      windowTools: { available: true },
    },
    version: 1,
  }),
  diffProfile: () => unavailable(),
  discoverMonitors: () => unavailable(),
  listColor: () => Effect.succeed([]),
  listProfiles: () => unavailable(),
  listWindowAreas: () => Effect.succeed([]),
  previewProfileApply: () => unavailable(),
  saveProfile: () => unavailable(),
  setColor: () => unavailable(),
  showProfile: () => unavailable(),
  snapForegroundWindow: () => unavailable(),
});

const makePair = () => {
  const requests = makeQueue();
  const responses = makeQueue();
  const client: IpcTransport = {
    readChunks: responses.read,
    writeLine: (line) => {
      requests.push(`${line}\n`);
      return Promise.resolve();
    },
  };
  const server: IpcTransport = {
    readChunks: requests.read,
    writeLine: (line) => {
      responses.push(`${line}\n`);
      return Promise.resolve();
    },
  };
  return { client, requests, server };
};

describe("Native SDK UI IPC client", () => {
  it("generates mandatory request IDs and pairs responses through an in-memory transport", async () => {
    const pair = makePair();
    const serverTask = serveNativeUiIpc(pair.server, makeApplication());
    const client = new NativeUiIpcClient(pair.client);

    const response = await client.call({ method: "capabilities.get" });

    expect(response).toMatchObject({ id: "native-ui-1", ok: true, version: 1 });
    if (response.ok) {
      expect(response.result).toMatchObject({ version: 1 });
    }
    pair.requests.close();
    await serverTask;
  });
});
