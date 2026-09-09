# Native Monitor Tools UI

The Native SDK shell for Native Monitor Tools is authored in TypeScript and
declarative Native markup. `src/core.ts` owns the model and message loop;
`src/app.native` owns the native-rendered view. The shell intentionally does
not import the Bun desktop runtime, Effect, or the shared backend package.

The core sends versioned host commands under `monitor-tools.ipc.v1.*` through
`Cmd.request`. The backend adapter is expected to implement those commands;
until it does, the UI stays honest with loading, empty, unsupported, and error
states rather than fabricating monitor data.

The temporary response adapter uses bounded binary frames:

- display list: `[version:u8, kind:1, count:u16]`, then each display's
  `id:u32`, `primary:u8`, length-prefixed UTF-8 `name`, `resolution`, and
  `position`, followed by `colorSupported:u8` and `windowToolsSupported:u8`;
- profile list: `[version:u8, kind:2, count:u16]`, then each profile's
  `id:u32`, length-prefixed UTF-8 `name` and `summary`, and `monitorCount:u16`;
- profile apply requests use the SDK host-record payload `{ profileId }`.

This decoder is deliberately isolated in `src/core.ts`; replace it with the
shared versioned IPC codec when that backend contract is available.

## Commands

```sh
native dev --core
native check
native test
```

The Native SDK CLI materializes and refreshes `node_modules/@native-sdk/core`
for editor support and validation. It is not part of the shipped binary.
