# Native Monitor Tools UI

The Native SDK shell for Native Monitor Tools is authored in TypeScript and declarative Native markup. `src/core.ts` owns the model and message loop; `src/app.native` owns the native-rendered view. The shell intentionally does not import the Bun desktop runtime, Effect, or the shared backend package.

The core sends versioned requests through the generated `backend.request` service. That service launches the Bun/Effect desktop backend using its bounded Native UI frame protocol; until the backend is available, the UI stays honest with loading, empty, unsupported, and error states rather than fabricating monitor data.

The service and backend use bounded binary frames:

- display list: `[version:u8, kind:1, count:u16]`, then each display's length-prefixed UTF-8 stable monitor `id`, `primary:u8`, `name`, `resolution`, and `position`, followed by `colorSupported:u8` and `windowToolsSupported:u8`;
- profile list: `[version:u8, kind:2, count:u16]`, then each profile's length-prefixed UTF-8 stable profile id and `name`, followed by `summary` and `monitorCount:u16`;
- requests use `[version:u8, operation:u8, nameLength:u16, name:utf8]`; operation 1 lists displays, 2 lists profiles, and 3 previews a named profile;
- error frames use kind `255`, followed by the operation and a length-prefixed UTF-8 diagnostic.

The decoder is deliberately isolated in `src/core.ts`. The service launches `native-monitor-tools-backend.exe --native-ui <hex-frame>` and returns the backend frame as the generated service result. The backend executable is built with `bun run backend:build` and must be discoverable through `PATH`.

## Commands

```sh
native dev --core
native check
native test
```

The Native SDK CLI materializes and refreshes `node_modules/@native-sdk/core` for editor support and validation. It is not part of the shipped binary.
