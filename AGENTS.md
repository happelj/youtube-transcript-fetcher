# Codex Notes

- Use `pnpm.cmd` on Windows if PowerShell blocks the `pnpm` shim.
- Build and verify the deployable app with `pnpm.cmd run build`.
- The frontend lives in `artifacts/youtube-transcript`.
- The Express API lives in `artifacts/api-server`.
- Vercel enters the API through `api/index.ts`; keep transcript fetching in Node so the function does not depend on Python.
- Local API development defaults to `http://localhost:3001`; the Vite dev server proxies `/api` to that port.
