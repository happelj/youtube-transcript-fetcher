/**
 * YouTube utility functions for transcript fetching and URL parsing.
 * Uses a Node transcript library so the API can run in serverless runtimes
 * without shelling out to Python.
 */

import {
  fetchTranscript as fetchYoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptResponse as YoutubeTranscriptSegment,
} from "youtube-transcript";

/**
 * Extracts the YouTube video ID from various URL formats.
 * Supports:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://youtube.com/shorts/VIDEO_ID
 *
 * @param url - The YouTube URL to parse
 * @returns The video ID string, or null if not found
 */
export function extractVideoId(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  const trimmed = url.trim();

  // If the input looks like just a video ID (11 alphanumeric chars + dashes/underscores)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);

    // Handle youtu.be short links: https://youtu.be/VIDEO_ID
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.slice(1).split("?")[0];
      if (isValidVideoId(id)) return id;
    }

    // Handle youtube.com variants
    if (
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "m.youtube.com"
    ) {
      // Standard watch URL: ?v=VIDEO_ID
      const v = parsed.searchParams.get("v");
      if (v && isValidVideoId(v)) return v;

      // Embed URL: /embed/VIDEO_ID
      const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch && isValidVideoId(embedMatch[1])) return embedMatch[1];

      // Shorts URL: /shorts/VIDEO_ID
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch && isValidVideoId(shortsMatch[1])) return shortsMatch[1];

      // Live URL: /live/VIDEO_ID
      const liveMatch = parsed.pathname.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch && isValidVideoId(liveMatch[1])) return liveMatch[1];
    }
  } catch {
    return null;
  }

  return null;
}

/** Validates that a string looks like a YouTube video ID (11 chars: [A-Za-z0-9_-]). */
function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/** A single transcript segment with text and timing information. */
export interface TranscriptSegment {
  text: string;
  offset: number;   // Start time in milliseconds
  duration: number; // Duration in milliseconds
}

/** Known error types from transcript fetching. */
export type TranscriptErrorReason =
  | "disabled"
  | "not_found"
  | "too_many_requests"
  | "parse_error"
  | "unknown";

export class TranscriptError extends Error {
  constructor(
    message: string,
    public readonly reason: TranscriptErrorReason = "unknown"
  ) {
    super(message);
    this.name = "TranscriptError";
  }
}

function mapTranscriptLibraryError(err: unknown): TranscriptError {
  if (err instanceof YoutubeTranscriptDisabledError) {
    return new TranscriptError(
      "Transcripts are disabled for this video. The creator may have turned off captions.",
      "disabled",
    );
  }

  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return new TranscriptError(
      "This video is unavailable or does not exist. Please check the URL.",
      "not_found",
    );
  }

  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return new TranscriptError(
      "YouTube is rate limiting transcript requests from this server. Please try again later.",
      "too_many_requests",
    );
  }

  if (
    err instanceof YoutubeTranscriptNotAvailableError ||
    err instanceof YoutubeTranscriptNotAvailableLanguageError
  ) {
    return new TranscriptError(
      "No transcript found for this video. It may not have captions available.",
      "disabled",
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();

  if (normalized.includes("too many") || normalized.includes("captcha")) {
    return new TranscriptError(
      "YouTube is rate limiting transcript requests from this server. Please try again later.",
      "too_many_requests",
    );
  }

  if (normalized.includes("unavailable") || normalized.includes("invalid video")) {
    return new TranscriptError(
      "This video is unavailable or does not exist. Please check the URL.",
      "not_found",
    );
  }

  if (
    normalized.includes("disabled") ||
    normalized.includes("no transcripts") ||
    normalized.includes("not available")
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

/**
 * Fetches the transcript for a given YouTube video ID using Python's
 * youtube-transcript-api library.
 *
 * @param videoId - The 11-character YouTube video ID
 * @returns Array of transcript segments with text and timing data (offset/duration in ms)
 * @throws TranscriptError if transcripts are unavailable or cannot be fetched
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    let segments: YoutubeTranscriptSegment[];

    try {
      segments = await fetchYoutubeTranscript(videoId, { lang: "en" });
    } catch (err: unknown) {
      if (!(err instanceof YoutubeTranscriptNotAvailableLanguageError)) {
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
