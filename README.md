# Native Monitor Tools

Native Monitor Tools is a Bun workspace for a desktop runtime and shared code.

## License and attribution

Native Monitor Tools is licensed under the GNU General Public License version 3 (GPLv3) and incorporates GPLv3-compatible behavior and code from Dual Monitor Tools r555/2.13. See [`COPYING.txt`](COPYING.txt) and [`NOTICE.md`](NOTICE.md) for the full license and attribution details.

## Workspace layout

- `apps/desktop` — the Bun desktop runtime entry point
- `apps/native-ui` — the Native SDK native-rendered Windows UI
- `apps/site` — a dependency-free placeholder for a future site
- `packages/core` — shared core package, ready for future monitor logic

To install dependencies:

```sh
bun install
```

To run the desktop app:

```sh
bun run dev
```

To validate or run the native UI (requires the Native SDK CLI and Zig for a full build):

```sh
bun run ui:check
bun run ui:dev
```

The Native SDK UI is a separate native-rendered app. It communicates with the Bun/Effect desktop backend through a versioned IPC boundary; it does not embed a JavaScript runtime or import backend services directly.

Useful checks:

```sh
bun run typecheck
bun run lint
bun run test
```

The desktop runtime currently contains only the original Bun starter entry point; monitor features will be added through the shared core package.
