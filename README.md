# YouTube Transcript Fetcher

Vite + React frontend with an Express API for fetching YouTube captions and optional OpenAI-based sermon boundary detection.

## Project Layout

- `artifacts/youtube-transcript`: React/Vite web app.
- `artifacts/api-server`: Express API routes and transcript logic.
- `api/index.ts`: Vercel Function entrypoint for the Express API.
- `vercel.json`: Vercel build, output, function, and rewrite configuration.

## Requirements

- Node.js 20 or newer.
- pnpm 10.
- `OPENAI_API_KEY` only if sermon boundary detection is enabled in the UI.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the API:

```bash
pnpm run dev:api
```

Run the frontend in a second terminal:

```bash
pnpm run dev
```

The frontend dev server proxies `/api` requests to `http://localhost:3001`.

## Build

```bash
pnpm run build
```

This typechecks the workspace libraries, the API, and the frontend, then builds the Vite app into `artifacts/youtube-transcript/dist/public`.

## Vercel Deployment

Import the GitHub repository into Vercel from the repository root. The checked-in `vercel.json` sets:

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm run build`
- Output directory: `artifacts/youtube-transcript/dist/public`
- API function: `api/index.ts`

Add `OPENAI_API_KEY` in Vercel Project Settings only if you want sermon mode to work.
