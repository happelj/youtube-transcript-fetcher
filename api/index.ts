import type { IncomingMessage, ServerResponse } from "node:http";

type ApiRequest = IncomingMessage & {
  body?: unknown;
};

type JsonResponse = Record<string, unknown>;

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: JsonResponse,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function setCommonHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

async function readJsonBody(req: ApiRequest): Promise<unknown> {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(
  req: ApiRequest,
  res: ServerResponse,
): Promise<void> {
  setCommonHeaders(res);

  const method = req.method?.toUpperCase() ?? "GET";

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const [{ GetTranscriptBody, GetTranscriptResponse }, youtube] =
    await Promise.all([
      import("../lib/api-zod/src/index.js"),
      import("../artifacts/api-server/src/lib/youtube.js"),
    ]);

  try {
    const body = await readJsonBody(req);
    const parsed = GetTranscriptBody.safeParse(body);

    if (!parsed.success) {
      sendJson(res, 400, {
        error: "Invalid request. Please provide a YouTube URL.",
      });
      return;
    }

    const { url, sermonMode } = parsed.data;
    const videoId = youtube.extractVideoId(url);

    if (!videoId) {
      sendJson(res, 400, {
        error:
          "Could not find a valid video ID in the URL. Please use a standard YouTube link (e.g. https://www.youtube.com/watch?v=...) or a youtu.be short link.",
      });
      return;
    }

    const segments = await youtube.fetchTranscript(videoId);
    const fullText = segments.map((segment) => segment.text).join(" ");

    let sermon: Record<string, unknown> | undefined;
    if (sermonMode) {
      const { detectSermonBoundariesWithAI } = await import(
        "../artifacts/api-server/src/lib/openaiSermonDetector.js"
      );
      const result = await detectSermonBoundariesWithAI(segments);
      sermon = result as unknown as Record<string, unknown>;
    }

    const responseData = GetTranscriptResponse.parse({
      videoId,
      url,
      fullText,
      segments,
      sermon,
    }) as JsonResponse;

    sendJson(res, 200, responseData);
  } catch (err: unknown) {
    if (err instanceof youtube.TranscriptError) {
      switch (err.reason) {
        case "disabled":
          sendJson(res, 404, {
            error:
              "Transcripts are disabled or unavailable for this video. The creator may have turned off captions.",
          });
          return;
        case "not_found":
          sendJson(res, 404, {
            error: "This video could not be found. Please check the URL and try again.",
          });
          return;
        case "too_many_requests":
          sendJson(res, 429, {
            error: "Too many requests to YouTube. Please wait a moment and try again.",
          });
          return;
        case "parse_error":
          sendJson(res, 500, {
            error: "Could not parse the transcript data. Please try again later.",
          });
          return;
        default:
          sendJson(res, 500, { error: err.message });
          return;
      }
    }

    console.error("Transcript API error:", err);
    sendJson(res, 500, {
      error:
        "An unexpected error occurred while fetching the transcript. Please try again in a moment.",
    });
  }
}
