/// <reference lib="dom" />

import type {
  TranscriptResponse as YoutubeTranscriptSegment,
} from "youtube-transcript";

type TranscriptSegment = {
  text: string;
  offset: number;
  duration: number;
};

type TranscriptErrorReason =
  | "disabled"
  | "not_found"
  | "too_many_requests"
  | "parse_error"
  | "unknown";

class TranscriptError extends Error {
  constructor(
    message: string,
    readonly reason: TranscriptErrorReason = "unknown",
  ) {
    super(message);
    this.name = "TranscriptError";
  }
}

type FetchYoutubeTranscript = (
  videoId: string,
  config?: { lang?: string },
) => Promise<YoutubeTranscriptSegment[]>;

type YoutubeTranscriptModule = {
  fetchTranscript: FetchYoutubeTranscript;
};

let fetchYoutubeTranscriptPromise:
  | Promise<FetchYoutubeTranscript>
  | undefined;

async function getYoutubeTranscriptFetcher(): Promise<FetchYoutubeTranscript> {
  fetchYoutubeTranscriptPromise ??= import(
    "youtube-transcript/dist/youtube-transcript.esm.js" as string
  ).then((module) => (module as YoutubeTranscriptModule).fetchTranscript);
  return fetchYoutubeTranscriptPromise;
}

const responseHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
): Response {
  return Response.json(body, {
    status: statusCode,
    headers: responseHeaders,
  });
}

function isRequestBody(value: unknown): value is {
  url: string;
  sermonMode?: boolean;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const body = value as Record<string, unknown>;

  return (
    typeof body["url"] === "string" &&
    (body["sermonMode"] === undefined || typeof body["sermonMode"] === "boolean")
  );
}

function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function extractVideoId(url: string): string | null {
  const trimmed = url.trim();

  if (isValidVideoId(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1).split("?")[0];
      return isValidVideoId(id) ? id : null;
    }

    if (
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "m.youtube.com"
    ) {
      const watchId = parsed.searchParams.get("v");
      if (watchId && isValidVideoId(watchId)) {
        return watchId;
      }

      const pathMatch = parsed.pathname.match(
        /^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/,
      );
      return pathMatch && isValidVideoId(pathMatch[1]) ? pathMatch[1] : null;
    }
  } catch {
    return null;
  }

  return null;
}

function mapTranscriptLibraryError(err: unknown): TranscriptError {
  const message = err instanceof Error ? err.message : String(err);
  const errorName = err instanceof Error ? err.name : "";
  const normalized = message.toLowerCase();
  const normalizedName = errorName.toLowerCase();

  if (
    normalizedName.includes("toomany") ||
    normalized.includes("too many") ||
    normalized.includes("captcha")
  ) {
    return new TranscriptError(
      "YouTube is rate limiting transcript requests from this server. Please try again later.",
      "too_many_requests",
    );
  }

  if (
    normalizedName.includes("unavailable") ||
    normalized.includes("video is no longer available") ||
    normalized.includes("invalid video")
  ) {
    return new TranscriptError(
      "This video is unavailable or does not exist. Please check the URL.",
      "not_found",
    );
  }

  if (
    normalized.includes("transcript is disabled") ||
    normalized.includes("disabled") ||
    normalized.includes("no transcripts") ||
    normalized.includes("not available") ||
    normalized.includes("available languages")
  ) {
    return new TranscriptError(
      "No transcript found for this video. It may not have captions available.",
      "disabled",
    );
  }

  return new TranscriptError(
    "Failed to fetch transcript data. Please try again.",
    "unknown",
  );
}

function isLanguageUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("available languages") ||
    normalized.includes("no transcripts are available in en") ||
    normalized.includes("no transcripts are available in english")
  );
}

function normalizeTranscriptTiming(
  segments: YoutubeTranscriptSegment[],
): TranscriptSegment[] {
  const maxDuration = Math.max(...segments.map((segment) => segment.duration));
  const scale = maxDuration < 100 ? 1000 : 1;

  return segments.map((segment) => ({
    text: segment.text,
    offset: Math.round(segment.offset * scale),
    duration: Math.round(segment.duration * scale),
  }));
}

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const fetchYoutubeTranscript = await getYoutubeTranscriptFetcher();
    let segments: YoutubeTranscriptSegment[];

    try {
      segments = await fetchYoutubeTranscript(videoId, { lang: "en" });
    } catch (err: unknown) {
      if (!isLanguageUnavailableError(err)) {
        throw err;
      }
      segments = await fetchYoutubeTranscript(videoId);
    }

    if (segments.length === 0) {
      throw new TranscriptError(
        "No transcript segments found for this video.",
        "disabled",
      );
    }

    return normalizeTranscriptTiming(segments);
  } catch (err: unknown) {
    if (err instanceof TranscriptError) {
      throw err;
    }

    throw mapTranscriptLibraryError(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    if (!isRequestBody(body)) {
      return jsonResponse(400, {
        error: "Invalid request. Please provide a YouTube URL.",
      });
    }

    const { url, sermonMode } = body;
    const videoId = extractVideoId(url);

    if (!videoId) {
      return jsonResponse(400, {
        error:
          "Could not find a valid video ID in the URL. Please use a standard YouTube link (e.g. https://www.youtube.com/watch?v=...) or a youtu.be short link.",
      });
    }

    const segments = await fetchTranscript(videoId);
    const fullText = segments.map((segment) => segment.text).join(" ");
    let sermon: Record<string, unknown> | undefined;

    if (sermonMode) {
      const { detectSermonBoundariesWithAI } = await import(
        "../artifacts/api-server/src/lib/openaiSermonDetector.js"
      );
      const result = await detectSermonBoundariesWithAI(segments);
      sermon = result as unknown as Record<string, unknown>;
    }

    return jsonResponse(200, {
      videoId,
      url,
      fullText,
      segments,
      sermon,
    });
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      return jsonResponse(400, {
        error: "Invalid JSON request body.",
      });
    }

    if (err instanceof TranscriptError) {
      switch (err.reason) {
        case "disabled":
          return jsonResponse(404, {
            error:
              "Transcripts are disabled or unavailable for this video. The creator may have turned off captions.",
          });
        case "not_found":
          return jsonResponse(404, {
            error: "This video could not be found. Please check the URL and try again.",
          });
        case "too_many_requests":
          return jsonResponse(429, {
            error: "Too many requests to YouTube. Please wait a moment and try again.",
          });
        case "parse_error":
          return jsonResponse(500, {
            error: "Could not parse the transcript data. Please try again later.",
          });
        default:
          return jsonResponse(500, { error: err.message });
      }
    }

    console.error("Transcript API error:", err);
    return jsonResponse(500, {
      error:
        "An unexpected error occurred while fetching the transcript. Please try again in a moment.",
    });
  }
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
}

export default {
  fetch(request: Request): Promise<Response> | Response {
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return OPTIONS();
    }

    if (method === "POST") {
      return POST(request);
    }

    return jsonResponse(405, { error: "Method not allowed." });
  },
};
