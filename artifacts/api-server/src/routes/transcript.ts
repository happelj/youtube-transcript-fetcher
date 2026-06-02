/**
 * Transcript route: POST /transcript
 *
 * Accepts a YouTube video URL, extracts the video ID, fetches the transcript
 * using YouTube's public caption API, and returns structured transcript data.
 *
 * When `sermonMode: true` is included in the request body, the response also
 * includes AI-based sermon boundary detection in the `sermon` field.
 * Detection is performed exclusively via the OpenAI API (see lib/openaiSermonDetector.ts).
 * No heuristic fallback is used — if OpenAI detection fails, sermon.error is true.
 */

import { Router, type Request, type Response } from "express";
import { extractVideoId, fetchTranscript, TranscriptError } from "../lib/youtube.js";
import { GetTranscriptBody, GetTranscriptResponse } from "@workspace/api-zod";
import { detectSermonBoundariesWithAI } from "../lib/openaiSermonDetector.js";

const router = Router();

router.post("/transcript", async (req: Request, res: Response): Promise<void> => {
  // Validate request body using generated Zod schema
  const parsed = GetTranscriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Please provide a YouTube URL." });
    return;
  }

  const { url, sermonMode } = parsed.data;

  // Extract video ID from the provided URL
  const videoId = extractVideoId(url);
  if (!videoId) {
    res.status(400).json({
      error:
        "Could not find a valid video ID in the URL. Please use a standard YouTube link (e.g. https://www.youtube.com/watch?v=...) or a youtu.be short link.",
    });
    return;
  }

  try {
    // Fetch transcript segments from YouTube's public caption API
    const segments = await fetchTranscript(videoId);

    // Build full plain-text transcript by joining all segment texts
    const fullText = segments.map((s) => s.text).join(" ");

    // Optionally run AI sermon boundary detection (OpenAI only, no heuristic fallback)
    let sermon: Record<string, unknown> | undefined;
    if (sermonMode) {
      const result = await detectSermonBoundariesWithAI(segments);
      sermon = result as unknown as Record<string, unknown>;
    }

    // Return structured transcript data validated against the Zod schema
    const responseData = GetTranscriptResponse.parse({
      videoId,
      url,
      fullText,
      segments,
      sermon,
    });

    res.json(responseData);
  } catch (err: unknown) {
    if (err instanceof TranscriptError) {
      // Map known error reasons to appropriate HTTP status codes and messages
      switch (err.reason) {
        case "disabled":
          res.status(404).json({
            error:
              "Transcripts are disabled or unavailable for this video. The creator may have turned off captions.",
          });
          return;
        case "not_found":
          res.status(404).json({
            error: "This video could not be found. Please check the URL and try again.",
          });
          return;
        case "too_many_requests":
          res.status(429).json({
            error: "Too many requests to YouTube. Please wait a moment and try again.",
          });
          return;
        case "parse_error":
          res.status(500).json({
            error: "Could not parse the transcript data. Please try again later.",
          });
          return;
        default:
          res.status(500).json({ error: err.message });
          return;
      }
    }

    // Unexpected error fallback
    console.error("Transcript fetch error:", err);
    res.status(500).json({
      error:
        "An unexpected error occurred while fetching the transcript. Please try again in a moment.",
    });
  }
});

export default router;
