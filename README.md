# YouTube Transcript Fetcher

Vite + React frontend with an Express API for fetching YouTube captions and optional OpenAI-based sermon boundary detection.

## Project Layout

- `artifacts/youtube-transcript`: React/Vite web app.
- `artifacts/api-server`: Express API routes and transcript logic.
- `api/healthz.ts`: Vercel health-check function.
- `api/transcript.ts`: Vercel transcript function.
- `vercel.json`: Vercel build, output, function, and rewrite configuration.

## Requirements

- Node.js 20 or newer.
- pnpm 10.
- `OPENAI_KEY_ENCRYPTION_SECRET` for user-saved OpenAI API keys.
- `OPENAI_API_KEY` only if you want one shared server-side fallback key.

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
- API functions: `api/healthz.ts`, `api/openai-key.ts`, and `api/transcript.ts`

Add `OPENAI_KEY_ENCRYPTION_SECRET` in Vercel Project Settings before users save their own OpenAI API keys. Use a long random value. `OPENAI_API_KEY` is optional and acts only as a shared fallback key when a user has not saved one.
