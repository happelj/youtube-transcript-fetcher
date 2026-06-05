/// <reference types="node" />

/**
 * AI-based Sermon Boundary Detection
 *
 * Uses the OpenAI API to identify where the sermon proper starts and ends
 * within a timestamped church service transcript.
 *
 * Detection approach:
 *  - For transcripts that fit in a single prompt, a one-pass call is made.
 *  - For longer transcripts, a two-pass approach is used:
 *      Pass 1: Send a condensed/sampled transcript to get rough region estimates.
 *      Pass 2: Send focused windows around those estimates for precise timestamps.
 *
 * No heuristic fallback is used. If the OpenAI call fails for any reason,
 * an error result is returned and the caller shows a clean failure message.
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  text: string;
  offset: number;   // milliseconds from video start
  duration: number;
}

export interface SermonBoundaryPoint {
  timestamp: string;  // formatted as mm:ss or h:mm:ss
  text: string;       // exact snippet from transcript
  offsetMs: number;
}

export interface SermonBoundariesResult {
  method: "openai";
  start?: SermonBoundaryPoint;
  end?: SermonBoundaryPoint;
  confidence?: string;
  reasoningSummary?: string;
  error: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

function getOpenAIClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Convert milliseconds to mm:ss or h:mm:ss */
function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Convert formatted timestamp (mm:ss or h:mm:ss) back to milliseconds */
function timestampToMs(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) {
    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
  }
  return ((parts[0] * 60) + parts[1]) * 1000;
}

/** Build a readable timestamped transcript string for the prompt */
function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => `[${formatMs(seg.offset)}] ${seg.text.replace(/\n/g, " ").trim()}`)
    .join("\n");
}

/**
 * Find the transcript segment whose offset is closest to the target timestamp.
 * This ensures we always return a real segment, never an invented one.
 */
function findNearestSegment(
  segments: TranscriptSegment[],
  targetMs: number,
): TranscriptSegment {
  let best = segments[0];
  let bestDiff = Math.abs(segments[0].offset - targetMs);
  for (const seg of segments) {
    const diff = Math.abs(seg.offset - targetMs);
    if (diff < bestDiff) {
      best = seg;
      bestDiff = diff;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * PROMPT DESIGN NOTES
 *
 * The key challenge: Reformed/Presbyterian services commonly follow this order:
 *   announcements → call to worship → singing → OT reading (+brief comments)
 *   → NT reading (+brief comments) → sermon proper → closing prayer → benediction
 *
 * The OT and NT reading sections often include the pastor briefly commenting on
 * what was just read. These comments are NOT the sermon — they are liturgical
 * scripture exposition. The sermon proper is a separate, sustained, formally
 * introduced preaching event that comes AFTER all readings are complete.
 *
 * To handle this correctly, the prompt uses a two-step chain-of-thought approach:
 *   Step 1 — map every section of the service
 *   Step 2 — use that map to identify the sermon proper
 *
 * This forces the model to explicitly identify OT/NT readings as separate sections
 * before it names the sermon, greatly reducing false positives.
 */

const SYSTEM_PROMPT = `You are a careful analyst of church service transcripts.

Your task has TWO steps. Work through both steps before producing JSON output.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — MAP THE SERVICE STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify every distinct section of the service in order. Common sections include:
  • Prelude / music
  • Announcements / welcome / greetings
  • Call to worship (responsive or read)
  • Psalm singing or congregational singing / hymns
  • Opening prayer / invocation
  • Old Testament reading (the pastor reads a passage and may briefly comment)
  • New Testament reading (the pastor reads a passage and may briefly comment)
  • Sacrament administration — Baptism or Lord's Supper (can be lengthy)
  • Pastoral prayer / prayer of intercession (often long, ends with "Amen")
  • Sermon proper (see definition below)
  • Closing prayer / prayer of application
  • Benediction
  • Doxology / closing song / postlude

In your internal reasoning, note the approximate timestamp where each section begins.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — IDENTIFY THE SERMON PROPER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE SERMON PROPER is:
  The single main sustained preaching section that typically occurs after all
  liturgical elements are complete — after readings, sacraments, and the
  pastoral prayer. It consists of sustained exposition, points, illustrations,
  and application, usually lasting 30–60+ minutes.

HOW TO FIND THE SERMON START — look for these signals in order:

  SIGNAL A (strongest): The pastoral/pre-sermon prayer ends with "Amen" and
    then the congregation sits ("you may be seated"). The very next sustained
    speaking is the sermon. The preacher may immediately read the sermon text
    aloud ("Turn with me to…", "Open your Bibles to…") — that reading IS part
    of the sermon opening, not a separate liturgical reading.

  SIGNAL B: Explicit sermon-opening language: "Today we come to…", "This
    morning I want to preach from…", "Our text today is…", "I'll be reading
    from…" followed by sustained exposition.

  SIGNAL C: The preacher introduces the sermon passage, reads it aloud, then
    transitions directly into exposition ("The grass withers and the flower
    fades, but the word of God stands forever" is a common Reformed reading
    response, after which the sermon begins).

CRITICAL DISTINCTIONS — these are NOT the sermon:

  ✗ OT READING with brief pastoral comment: Happens early in the service.
    Even if the pastor explains the passage briefly, this is liturgy, NOT the
    sermon. Look for it to end within a few minutes.
  ✗ NT READING with brief pastoral comment: Same — liturgy, not the sermon.
  ✗ BAPTISM / LORD'S SUPPER: Can be extended, but is a sacrament, not the sermon.
  ✗ PASTORAL PRAYER: Long, interceding for the congregation, world, and church.
    Ends with "Amen". NOT the sermon.
  ✗ REFERENCES TO SCRIPTURE WITHIN THE SERMON: Once the sermon has begun, the
    preacher will cite many scripture passages. Do NOT treat these as separate
    readings that reset the sermon start. They are part of the sermon.
  ✗ CLOSING PRAYER after the sermon ends.
  ✗ BENEDICTION.

THE SERMON ENDS when:
  The preacher concludes the final point, application, or appeal — just before
  the closing prayer begins. The last line of actual preaching content
  (not the closing "Let us pray…" or the prayer itself).

RULES:
1. Use only timestamps that actually appear in the transcript data
2. Use only text that actually appears in the transcript data
3. The sermon start is the FIRST moment of sustained exposition after all liturgical
   elements (readings, sacrament, pastoral prayer) are complete — do NOT skip ahead
4. Once you identify a candidate sermon start, confirm it is followed by many minutes
   of continuous preaching before accepting it
5. In-sermon scripture citations do NOT mean the sermon has not yet started
6. If you are uncertain, lower the confidence score accordingly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON — no other text before or after:
{
  "sermonStart": {
    "timestamp": "MM:SS or H:MM:SS",
    "text": "exact transcript text from that timestamp"
  },
  "sermonEnd": {
    "timestamp": "MM:SS or H:MM:SS",
    "text": "exact transcript text from that timestamp"
  },
  "confidence": "high|medium|low",
  "reasoningSummary": "1-2 sentences: name every service section you identified before the sermon, and explain what specific signal marked the sermon start"
}`;

// ---------------------------------------------------------------------------
// One-pass detection (for transcripts that fit comfortably in the context)
// ---------------------------------------------------------------------------

async function detectOnePass(
  client: OpenAI,
  segments: TranscriptSegment[],
): Promise<SermonBoundariesResult> {
  const transcriptText = buildTranscriptText(segments);

  const userPrompt = `Here is the full timestamped church service transcript:\n\n${transcriptText}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "";
  return parseAndValidateResponse(raw, segments);
}

// ---------------------------------------------------------------------------
// Two-pass detection (for long transcripts)
// ---------------------------------------------------------------------------

/**
 * Pass 1: Send a condensed version (every Nth segment) to get rough region estimates.
 * Pass 2: Send focused windows around those estimates for precise timestamps.
 */
async function detectTwoPass(
  client: OpenAI,
  segments: TranscriptSegment[],
): Promise<SermonBoundariesResult> {
  // ── Pass 1: condense to roughly every 5th segment to stay within context
  const step = Math.ceil(segments.length / 200);
  const condensed = segments.filter((_, i) => i % step === 0);
  const condensedText = buildTranscriptText(condensed);

  const pass1Response = await client.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 512,
    messages: [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          "\n\nNOTE: This is a condensed transcript. Give approximate timestamps only — they will be refined in the next step.",
      },
      {
        role: "user",
        content: `Here is a condensed timestamped church service transcript:\n\n${condensedText}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  // Parse rough estimates
  let startMs = 0;
  let endMs = segments[segments.length - 1].offset;
  try {
    const rough = JSON.parse(pass1Response.choices[0]?.message?.content ?? "{}");
    if (rough.sermonStart?.timestamp) {
      startMs = timestampToMs(rough.sermonStart.timestamp);
    }
    if (rough.sermonEnd?.timestamp) {
      endMs = timestampToMs(rough.sermonEnd.timestamp);
    }
  } catch {
    // If parse fails, we fall back to full windows
  }

  // ── Pass 2: extract focused windows (±5 minutes around each estimate)
  const WINDOW_MS = 5 * 60 * 1000;

  const startWindowSegs = segments.filter(
    (s) => s.offset >= Math.max(0, startMs - WINDOW_MS) && s.offset <= startMs + WINDOW_MS,
  );
  const endWindowSegs = segments.filter(
    (s) => s.offset >= Math.max(0, endMs - WINDOW_MS) && s.offset <= endMs + WINDOW_MS,
  );

  // Deduplicate: if windows overlap, use a combined range
  const allWindowSegs = Array.from(
    new Map(
      [...startWindowSegs, ...endWindowSegs].map((s) => [s.offset, s]),
    ).values(),
  ).sort((a, b) => a.offset - b.offset);

  const windowText = buildTranscriptText(allWindowSegs);

  const pass2Response = await client.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 1024,
    messages: [
      {
        role: "system",
        content:
          SYSTEM_PROMPT +
          "\n\nNOTE: This is a focused excerpt around the likely sermon boundaries. Give precise timestamps.",
      },
      {
        role: "user",
        content: `Here is the focused transcript excerpt around the likely sermon boundaries:\n\n${windowText}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = pass2Response.choices[0]?.message?.content ?? "";
  return parseAndValidateResponse(raw, segments);
}

// ---------------------------------------------------------------------------
// Response parsing and validation
// ---------------------------------------------------------------------------

function parseAndValidateResponse(
  raw: string,
  segments: TranscriptSegment[],
): SermonBoundariesResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[openaiSermonDetector] Failed to parse OpenAI JSON response:", raw);
    return {
      method: "openai",
      error: true,
      message: "Sermon boundaries could not be determined. The AI returned an unreadable response.",
    };
  }

  // Validate required fields
  if (!parsed.sermonStart || !parsed.sermonEnd) {
    console.error("[openaiSermonDetector] Missing sermonStart or sermonEnd in response:", parsed);
    return {
      method: "openai",
      error: true,
      message: "Sermon boundaries could not be determined from this transcript.",
    };
  }

  const rawStart = parsed.sermonStart as Record<string, string>;
  const rawEnd = parsed.sermonEnd as Record<string, string>;

  if (!rawStart.timestamp || !rawEnd.timestamp) {
    return {
      method: "openai",
      error: true,
      message: "Sermon boundaries could not be determined. Timestamps were missing from the AI response.",
    };
  }

  // Map timestamps to nearest real segments (ensures we never return invented data)
  const startMs = timestampToMs(rawStart.timestamp);
  const endMs = timestampToMs(rawEnd.timestamp);

  const startSeg = findNearestSegment(segments, startMs);
  const endSeg = findNearestSegment(segments, endMs);

  // Prefer the AI's text if it looks valid, otherwise use the actual segment text
  const startText = (typeof rawStart.text === "string" && rawStart.text.trim().length > 0)
    ? rawStart.text.trim()
    : startSeg.text.trim();
  const endText = (typeof rawEnd.text === "string" && rawEnd.text.trim().length > 0)
    ? rawEnd.text.trim()
    : endSeg.text.trim();

  const confidence = ["high", "medium", "low"].includes(String(parsed.confidence))
    ? (parsed.confidence as string)
    : "low";

  const reasoningSummary = typeof parsed.reasoningSummary === "string"
    ? parsed.reasoningSummary.trim()
    : "";

  return {
    method: "openai",
    error: false,
    start: {
      timestamp: formatMs(startSeg.offset),
      text: startText,
      offsetMs: startSeg.offset,
    },
    end: {
      timestamp: formatMs(endSeg.offset),
      text: endText,
      offsetMs: endSeg.offset,
    },
    confidence,
    reasoningSummary,
  };
}

// ---------------------------------------------------------------------------
// Rough token estimate (4 chars ≈ 1 token)
// ---------------------------------------------------------------------------

// gpt-4o supports 128k token context. At ~4 chars/token and leaving room for
// the system prompt (~3k tokens) and completion (~1k tokens), we can safely
// fit ~120k tokens = ~480k chars of transcript in a single call.
// One-pass is strongly preferred: the condensed two-pass view drops subtle
// transition cues (e.g. "Amen. You may be seated." → sermon opening) that the
// model needs to correctly identify service structure.
const ONE_PASS_CHAR_LIMIT = 450_000; // ~112k tokens — safe for gpt-4o 128k context

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect sermon start and end boundaries using the OpenAI API.
 *
 * Automatically chooses one-pass or two-pass strategy based on transcript length.
 * Never uses heuristic detection. If detection fails, returns error: true.
 */
export async function detectSermonBoundariesWithAI(
  segments: TranscriptSegment[],
  apiKey?: string,
): Promise<SermonBoundariesResult> {
  // Guard: need at least a few segments
  if (segments.length < 5) {
    return {
      method: "openai",
      error: true,
      message:
        "The transcript is too short for sermon boundary detection.",
    };
  }

  let client: OpenAI;
  try {
    client = getOpenAIClient(apiKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[openaiSermonDetector] OpenAI client init failed:", msg);
    return {
      method: "openai",
      error: true,
      message: "Sermon boundary detection is unavailable: OpenAI API key is not configured.",
    };
  }

  try {
    const transcriptCharCount = segments.reduce((n, s) => n + s.text.length + 10, 0);

    if (transcriptCharCount <= ONE_PASS_CHAR_LIMIT) {
      console.log("[openaiSermonDetector] Using one-pass detection");
      return await detectOnePass(client, segments);
    } else {
      console.log("[openaiSermonDetector] Using two-pass detection (long transcript)");
      return await detectTwoPass(client, segments);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[openaiSermonDetector] Detection failed:", msg);
    return {
      method: "openai",
      error: true,
      message: "Sermon boundary detection was unavailable for this transcript.",
    };
  }
}
