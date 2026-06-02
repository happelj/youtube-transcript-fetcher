import 'dotenv/config'
import app from "./app";

const rawPort = process.env["PORT"];
const portValue = rawPort ?? (process.env.NODE_ENV === "development" ? "3001" : undefined);

if (!portValue) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(portValue);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${portValue}"`);
}

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Allow up to 3 minutes for long-running AI requests (sermon detection on a
// full 2+ hour transcript can take 60-90 seconds with gpt-4o).
server.setTimeout(180_000);
server.keepAliveTimeout = 180_000;
server.headersTimeout = 185_000;
