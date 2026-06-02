/**
 * SermonCard
 *
 * Displays the AI-detected sermon boundary results above the transcript.
 * All detection is performed by OpenAI — no heuristics are used.
 *
 * States handled:
 *  - Successful detection: shows Sermon Start, Sermon End, confidence, and
 *    an optional collapsible reasoning summary.
 *  - Failed detection (error: true): shows a friendly failure message.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, AlertTriangle, Clock, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { SermonBoundaries, SermonBoundaryPoint } from "@workspace/api-client-react";

interface SermonCardProps {
  sermon: SermonBoundaries;
  onRetry?: () => void;
}

// Confidence badge color
function confidenceClass(confidence: string | undefined) {
  switch (confidence) {
    case "high":   return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "medium": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    default:       return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  }
}

function confidenceLabel(confidence: string | undefined) {
  if (!confidence) return "Unknown";
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

// Individual boundary row (Start or End)
function BoundaryRow({
  label,
  point,
  color,
}: {
  label: string;
  point: SermonBoundaryPoint;
  color: "start" | "end";
}) {
  const isStart = color === "start";
  const accent = isStart
    ? "border-emerald-500/30 bg-emerald-500/10"
    : "border-rose-500/30 bg-rose-500/10";
  const timestampColor = isStart ? "text-emerald-400" : "text-rose-400";
  const labelColor = isStart ? "text-emerald-400" : "text-rose-400";

  return (
    <div className={`flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-xl border ${accent}`}>
      <div className="flex items-center gap-2 shrink-0">
        <Clock className={`w-4 h-4 ${timestampColor}`} />
        <div>
          <p className={`text-xs font-semibold uppercase tracking-widest ${labelColor}`}>
            {label}
          </p>
          <p className="text-lg font-mono font-bold text-foreground mt-0.5">
            {point.timestamp}
          </p>
        </div>
      </div>
      <div className="sm:border-l sm:border-border sm:pl-4 flex-1">
        <p className="text-sm text-muted-foreground leading-relaxed italic">
          &ldquo;{point.text}&rdquo;
        </p>
      </div>
    </div>
  );
}

export function SermonCard({ sermon, onRetry }: SermonCardProps) {
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full mt-6 bg-card/60 backdrop-blur-xl border border-primary/20 rounded-2xl overflow-hidden shadow-lg shadow-black/40"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Sermon Boundaries</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Sparkles className="w-3 h-3 text-primary/60" />
              <p className="text-xs text-muted-foreground">Detected by AI</p>
            </div>
          </div>
        </div>

        {/* Confidence badge (only on success) */}
        {!sermon.error && sermon.confidence && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${confidenceClass(sermon.confidence)}`}>
            {confidenceLabel(sermon.confidence)} confidence
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5 flex flex-col gap-3">
        {sermon.error ? (
          /* ── Failure state ── */
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-300 leading-relaxed">
                {sermon.message || "Sermon boundary detection was unavailable for this transcript."}
              </p>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="mt-3 text-xs font-medium text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
                >
                  Retry AI Detection
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ── Success state ── */
          <>
            {sermon.start && (
              <BoundaryRow label="Sermon Start" point={sermon.start} color="start" />
            )}
            {sermon.end && (
              <BoundaryRow label="Sermon End" point={sermon.end} color="end" />
            )}

            {/* Collapsible reasoning summary */}
            {sermon.reasoningSummary && (
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <button
                  onClick={() => setShowReasoning((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    AI reasoning
                  </span>
                  {showReasoning
                    ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  }
                </button>
                {showReasoning && (
                  <div className="px-4 pb-3 text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-2">
                    {sermon.reasoningSummary}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border bg-background/20">
        <p className="text-xs text-muted-foreground/60">
          Powered by OpenAI. Results reflect the AI&rsquo;s interpretation of the transcript
          and may not be exact.
        </p>
      </div>
    </motion.div>
  );
}
