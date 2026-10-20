# Contributing to ASCII Render

Thanks for wanting to help! Bug reports, presets, effects and docs are all welcome.

## Setup

```bash
npm install
npm run dev          # editor at http://localhost:5173
npm run build:mcp    # MCP server (needs ffmpeg for testing)
```

## Before opening a PR

```bash
npm run build                    # type-checks and builds the editor
npx tsc -p mcp/tsconfig.json     # type-checks the MCP server
npm run mcp:test -- some.mp4 /tmp  # optional: smoke-test the MCP tools
```

## Where things live

- **Renderer** — [`src/ascii.ts`](src/ascii.ts). It runs in the browser *and* in Node, so only use APIs that exist in both Canvas 2D and Skia, and create canvases through `platform.createCanvas()`.
- **Time-based effects** must be deterministic (use `hash01`, not `Math.random`), so preview and export match.
- **Presets** — [`src/presets.ts`](src/presets.ts). A new preset is just a `Partial<Settings>`; add a label to `LABELS` in [`scripts/make-assets.ts`](scripts/make-assets.ts) if it should appear in the README gallery.
- **MCP tools** — [`mcp/server.ts`](mcp/server.ts). Describe new settings in `SETTINGS_DOC` so models know how to use them.

## Regenerating README media

`npm run assets` rebuilds the logo, demo reel (MP4 + GIF), preset gallery, social preview and `public/demo.mp4` from procedural scenes in [`scripts/scenes.ts`](scripts/scenes.ts). Please don't commit third-party footage.

## Style

TypeScript strict, 2-space indent, small focused functions, comments that explain *why*. Match the code around you.
