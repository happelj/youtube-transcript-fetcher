/// <reference lib="dom" />

import type {
  TranscriptResponse as YoutubeTranscriptSegment,
} from "youtube-transcript";
import { getOpenAiApiKeyForRequest } from "./lib/openai-key.js";

type TranscriptSegment = {
  text: string;
  offset: number;
  duration: number;
};

type TranscriptUnavailableResponse = {
  videoId: string;
  url: string;
  fullText: "";
  segments: [];
  unavailable: true;
  message: string;
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

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
};

type PlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
};

type TranscriptServiceAuth = {
  token: string;
  expiresAt: number;
};

type TranscriptServiceSegment = {
  text: string;
  offset: number;
  duration?: number;
};

let fetchYoutubeTranscriptPromise:
  | Promise<FetchYoutubeTranscript>
  | undefined;
let transcriptServiceAuth: TranscriptServiceAuth | undefined;
let transcriptServiceAuthPromise: Promise<TranscriptServiceAuth> | undefined;

const transcriptServiceApiKey = "AIzaSyC02AJ8YNuHAUKTf8e8u8orfZwTrLmqBeo";
const transcriptServiceRequestChannel = "9527-c";

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

function transcriptUnavailableResponse(
  videoId: string,
  url: string,
): TranscriptUnavailableResponse {
  return {
    videoId,
    url,
    fullText: "",
    segments: [],
    unavailable: true,
    message:
      "No public transcript is available for this video. YouTube may not expose captions for it from this server.",
  };
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseFiniteNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
  );
}

async function requestTranscriptServiceAuth(): Promise<TranscriptServiceAuth> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${transcriptServiceApiKey}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    throw new TranscriptError(
      "The fallback transcript service could not be reached.",
      "unknown",
    );
  }

  const payload = asRecord(await response.json());
  const token = payload?.["idToken"];
  const expiresInSeconds = parseFiniteNumber(payload?.["expiresIn"]) ?? 3600;

  if (typeof token !== "string" || token.length === 0) {
    throw new TranscriptError(
      "The fallback transcript service returned invalid auth data.",
      "unknown",
    );
  }

  return {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
}

async function getTranscriptServiceAuth(): Promise<TranscriptServiceAuth> {
  if (transcriptServiceAuth && transcriptServiceAuth.expiresAt > Date.now() + 60_000) {
    return transcriptServiceAuth;
  }

  transcriptServiceAuthPromise ??= requestTranscriptServiceAuth();

  try {
    transcriptServiceAuth = await transcriptServiceAuthPromise;
    return transcriptServiceAuth;
  } finally {
    transcriptServiceAuthPromise = undefined;
  }
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

function parseCaptionXml(xml: string): YoutubeTranscriptSegment[] {
  const srv3Segments: YoutubeTranscriptSegment[] = [];
  const srv3Pattern = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let srv3Match: RegExpExecArray | null;

  while ((srv3Match = srv3Pattern.exec(xml)) !== null) {
    const body = srv3Match[3];
    const sentencePattern = /<s[^>]*>([^<]*)<\/s>/g;
    let sentenceMatch: RegExpExecArray | null;
    let text = "";

    while ((sentenceMatch = sentencePattern.exec(body)) !== null) {
      text += sentenceMatch[1];
    }

    text ||= body.replace(/<[^>]+>/g, "");
    text = decodeHtmlEntities(text).trim();

    if (text) {
      srv3Segments.push({
        text,
        offset: Number.parseInt(srv3Match[1], 10),
        duration: Number.parseInt(srv3Match[2], 10),
      });
    }
  }

  if (srv3Segments.length > 0) {
    return srv3Segments;
  }

  return [...xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)]
    .map((match) => ({
      text: decodeHtmlEntities(match[3]).trim(),
      offset: Number.parseFloat(match[1]),
      duration: Number.parseFloat(match[2]),
    }))
    .filter((segment) => segment.text);
}

function extractJsonObjectAfter(source: string, needle: string): unknown {
  const needleIndex = source.indexOf(needle);
  if (needleIndex === -1) {
    return undefined;
  }

  const start = source.indexOf("{", needleIndex + needle.length);
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

function getCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const response = playerResponse as PlayerResponse | undefined;
  const tracks =
    response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  return Array.isArray(tracks) ? tracks : [];
}

async function fetchPlayerResponseFromInnerTube(
  videoId: string,
): Promise<PlayerResponse | undefined> {
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
          },
        },
        videoId,
      }),
    },
  );

  if (!response.ok) {
    return undefined;
  }

  return (await response.json()) as PlayerResponse;
}

async function fetchPlayerResponseFromWatchPage(
  videoId: string,
): Promise<PlayerResponse | undefined> {
  const response = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`,
    {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+917",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    },
  );

  if (!response.ok) {
    return undefined;
  }

  const html = await response.text();
  return extractJsonObjectAfter(html, "ytInitialPlayerResponse") as
    | PlayerResponse
    | undefined;
}

function selectCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  return (
    tracks.find((track) => track.languageCode === "en") ??
    tracks.find((track) => track.languageCode?.startsWith("en")) ??
    tracks.find((track) => track.kind !== "asr") ??
    tracks[0]
  );
}

async function fetchTranscriptFromCaptionTracks(
  videoId: string,
): Promise<TranscriptSegment[]> {
  const responses = await Promise.allSettled([
    fetchPlayerResponseFromInnerTube(videoId),
    fetchPlayerResponseFromWatchPage(videoId),
  ]);

  for (const result of responses) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const tracks = getCaptionTracks(result.value);
    const track = selectCaptionTrack(tracks);

    if (!track?.baseUrl) {
      continue;
    }

    const captionUrl = new URL(track.baseUrl);
    if (!captionUrl.hostname.endsWith(".youtube.com")) {
      continue;
    }

    const response = await fetch(captionUrl, {
      headers: {
        "accept-language": track.languageCode ?? "en",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      continue;
    }

    const segments = parseCaptionXml(await response.text());
    if (segments.length > 0) {
      return normalizeTranscriptTiming(segments);
    }
  }

  throw new TranscriptError(
    "No transcript segments found for this video.",
    "disabled",
  );
}

function getTranscriptServiceItem(payload: unknown): Record<string, unknown> {
  const payloadRecord = asRecord(payload);
  const success = payloadRecord?.["success"];
  const failed = payloadRecord?.["failed"];

  if (Array.isArray(success) && success.length > 0) {
    const item = asRecord(success[0]);
    if (item) {
      return item;
    }
  }

  if (Array.isArray(failed) && failed.length > 0) {
    const failedItem = asRecord(failed[0]);
    const failedReason = failedItem?.["failedReason"];
    const playabilityStatus = asRecord(failedItem?.["playabilityStatus"]);
    const reason =
      (typeof playabilityStatus?.["reason"] === "string"
        ? playabilityStatus["reason"]
        : undefined) ??
      (typeof failedReason === "string" ? failedReason : undefined) ??
      "Transcript not available";

    throw new TranscriptError(reason, "disabled");
  }

  throw new TranscriptError(
    "No transcript data was returned by the fallback service.",
    "disabled",
  );
}

function selectTranscriptServiceTrack(
  tracks: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(tracks)) {
    return undefined;
  }

  const trackRecords = tracks
    .map((track) => asRecord(track))
    .filter((track): track is Record<string, unknown> => Boolean(track));

  return (
    trackRecords.find((track) => track["languageCode"] === "en") ??
    trackRecords.find((track) => track["language"] === "en") ??
    trackRecords.find((track) => {
      const language = track["language"];
      return typeof language === "string" && language.toLowerCase().includes("english");
    }) ??
    trackRecords[0]
  );
}

function normalizeTranscriptServiceSegments(
  transcript: unknown,
): TranscriptSegment[] {
  if (!Array.isArray(transcript)) {
    return [];
  }

  const rawSegments: TranscriptServiceSegment[] = [];

  for (const value of transcript) {
    const segment = asRecord(value);
    const text = typeof segment?.["text"] === "string" ? segment["text"].trim() : "";
    const startSeconds = parseFiniteNumber(segment?.["start"]);

    if (!text || startSeconds === undefined) {
      continue;
    }

    const durationSeconds =
      parseFiniteNumber(segment?.["dur"]) ?? parseFiniteNumber(segment?.["duration"]);

    rawSegments.push({
      text: text.replace(/\s+/g, " "),
      offset: Math.round(startSeconds * 1000),
      duration:
        durationSeconds === undefined
          ? undefined
          : Math.max(0, Math.round(durationSeconds * 1000)),
    });
  }

  return rawSegments.map((segment, index) => {
    const nextSegment = rawSegments[index + 1];
    const inferredDuration =
      nextSegment && nextSegment.offset > segment.offset
        ? nextSegment.offset - segment.offset
        : 1000;

    return {
      text: segment.text,
      offset: segment.offset,
      duration: segment.duration ?? inferredDuration,
    };
  });
}

async function fetchTranscriptFromTranscriptService(
  videoId: string,
): Promise<TranscriptSegment[]> {
  const auth = await getTranscriptServiceAuth();
  const response = await fetch(
    "https://www.youtube-transcript.io/api/transcripts/v2",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
        "x-request-channel": transcriptServiceRequestChannel,
      },
      body: JSON.stringify({
        ids: [videoId],
        source: "video",
      }),
    },
  );

  if (response.status === 401) {
    transcriptServiceAuth = undefined;
    throw new TranscriptError(
      "The fallback transcript service rejected the auth token.",
      "unknown",
    );
  }

  if (response.status === 402 || response.status === 429) {
    throw new TranscriptError(
      "The fallback transcript service is rate limiting requests. Please try again later.",
      "too_many_requests",
    );
  }

  if (!response.ok) {
    throw new TranscriptError(
      "The fallback transcript service could not fetch this transcript.",
      "disabled",
    );
  }

  const item = getTranscriptServiceItem(await response.json());
  const track = selectTranscriptServiceTrack(item["tracks"]);
  const segments = normalizeTranscriptServiceSegments(track?.["transcript"]);

  if (segments.length === 0) {
    throw new TranscriptError(
      "No transcript segments found for this video.",
      "disabled",
    );
  }

  return segments;
}

async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const fetchYoutubeTranscript = await getYoutubeTranscriptFetcher();
    let libraryError: unknown;

    for (const config of [{ lang: "en" }, undefined]) {
      try {
        const segments = await fetchYoutubeTranscript(videoId, config);
        if (segments.length > 0) {
          return normalizeTranscriptTiming(segments);
        }
      } catch (err: unknown) {
        libraryError = err;
      }
    }

    try {
      const segments = await fetchTranscriptFromCaptionTracks(videoId);
      return segments;
    } catch (err: unknown) {
      try {
        return await fetchTranscriptFromTranscriptService(videoId);
      } catch (serviceErr: unknown) {
        if (
          serviceErr instanceof TranscriptError &&
          serviceErr.reason !== "disabled"
        ) {
          throw serviceErr;
        }

        if (err instanceof TranscriptError) {
          throw err;
        }

        if (libraryError) {
          throw mapTranscriptLibraryError(libraryError);
        }
        throw err;
      }
    }
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

    let segments: TranscriptSegment[];

    try {
      segments = await fetchTranscript(videoId);
    } catch (err: unknown) {
      if (err instanceof TranscriptError && err.reason === "disabled") {
        return jsonResponse(200, transcriptUnavailableResponse(videoId, url));
      }
      throw err;
    }

    const fullText = segments.map((segment) => segment.text).join(" ");
    let sermon: Record<string, unknown> | undefined;

    if (sermonMode) {
      const { detectSermonBoundariesWithAI } = await import(
        "../artifacts/api-server/src/lib/openaiSermonDetector.js"
      );
      const result = await detectSermonBoundariesWithAI(
        segments,
        await getOpenAiApiKeyForRequest(request),
      );
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
