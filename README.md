# Native Monitor Tools

Native Monitor Tools is a Bun workspace for a desktop runtime and shared code.

## License and attribution

Native Monitor Tools is licensed under the GNU General Public License version 3 (GPLv3) and incorporates GPLv3-compatible behavior and code from Dual Monitor Tools r555/2.13. See [`COPYING.txt`](COPYING.txt) and [`NOTICE.md`](NOTICE.md) for the full license and attribution details.

## Workspace layout

- `apps/desktop` — the Bun desktop runtime entry point
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

Useful checks:

```sh
bun run typecheck
bun run lint
bun run test
```

The desktop runtime currently contains only the original Bun starter entry point; monitor features will be added through the shared core package.
