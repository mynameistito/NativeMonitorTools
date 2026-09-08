# Native Monitor Tools

Native Monitor Tools is a Bun workspace for a desktop runtime and shared code.

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
