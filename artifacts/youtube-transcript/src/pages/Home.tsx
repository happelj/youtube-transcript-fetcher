import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useGetTranscript } from "@workspace/api-client-react";
import { TranscriptResult } from "@/components/TranscriptResult";
import { SermonCard } from "@/components/SermonCard";

type TranscriptUnavailableResult = {
  unavailable?: boolean;
  message?: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [sermonMode, setSermonMode] = useState(false);
  const { mutate: fetchTranscript, isPending, data, error, reset } = useGetTranscript();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    fetchTranscript({ data: { url, sermonMode } });
  };

  // Retry sermon detection only — re-submit the same URL with sermonMode on
  const handleRetrySermon = () => {
    if (!url.trim()) return;
    fetchTranscript({ data: { url, sermonMode: true } });
  };

  const getErrorMessage = () => {
    if (!error) return null;
    const errObj = error as any;
    return errObj?.data?.error
      || errObj?.response?.data?.error
      || errObj?.message
      || "An unexpected error occurred while fetching the transcript.";
  };

  const errorMessage = getErrorMessage();
  const unavailableResult = data as
    | (TranscriptUnavailableResult & typeof data)
    | undefined;
  const unavailableMessage =
    unavailableResult?.unavailable
      ? unavailableResult.message ||
        "No public transcript is available for this video."
      : null;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 relative z-10">

      {/* Subtle decorative background overlay */}
      <img
        src={`${import.meta.env.BASE_URL}images/ambient-bg.png`}
        alt=""
        className="fixed inset-0 w-full h-full object-cover opacity-[0.03] pointer-events-none mix-blend-screen"
      />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-3xl flex flex-col items-center"
      >
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-2xl mb-6 shadow-inner shadow-primary/20 border border-primary/20 backdrop-blur-md">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
            YouTube{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-violet-400">
              Transcript
            </span>{" "}
            Fetcher
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto font-sans">
            Instantly extract and download clean, timestamped captions from any public YouTube video.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full relative group">
          <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row items-center gap-3 bg-card/40 backdrop-blur-md p-2 rounded-2xl border border-border/80 shadow-xl focus-within:border-primary/50 transition-all duration-300">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="url"
                required
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isPending}
                className="w-full bg-transparent border-none pl-12 pr-4 py-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={isPending || !url.trim()}
              className="w-full sm:w-auto px-8 py-4 bg-foreground text-background hover:bg-white rounded-xl font-medium tracking-wide shadow-lg hover:shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{sermonMode ? "Analyzing…" : "Extracting…"}</span>
                </>
              ) : (
                <span>Get Transcript</span>
              )}
            </button>
          </div>

          {/* Sermon mode checkbox */}
          <div className="mt-3 flex items-center justify-center">
            <label className="flex items-center gap-2.5 cursor-pointer select-none group/cb">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={sermonMode}
                  onChange={(e) => setSermonMode(e.target.checked)}
                  disabled={isPending}
                  className="peer sr-only"
                />
                <div className="w-5 h-5 rounded-md border-2 border-border peer-checked:border-primary peer-checked:bg-primary/20 bg-card/40 transition-all flex items-center justify-center">
                  {sermonMode && (
                    <svg
                      className="w-3 h-3 text-primary"
                      fill="none"
                      viewBox="0 0 12 12"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-muted-foreground group-hover/cb:text-foreground transition-colors font-medium">
                Sermon
              </span>
              <span className="text-xs text-muted-foreground/60 hidden sm:inline">
                — detect where the sermon starts and ends
              </span>
            </label>
          </div>
        </form>

        {/* Error State */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              className="w-full mt-4"
            >
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-3 backdrop-blur-sm">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-destructive">Extraction Failed</h3>
                  <p className="text-sm opacity-90 mt-1">{errorMessage}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transcript unavailable state */}
        <AnimatePresence>
          {unavailableMessage && !isPending && !error && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              className="w-full mt-4"
            >
              <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl flex items-start gap-3 backdrop-blur-sm">
                <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-foreground">Transcript Unavailable</h3>
                  <p className="text-sm text-muted-foreground mt-1">{unavailableMessage}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        {data && !unavailableMessage && !isPending && !error && (
          <>
            {/* Sermon boundary card — only when sermon mode was requested */}
            {data.sermon && (
              <SermonCard sermon={data.sermon} onRetry={handleRetrySermon} />
            )}
            <TranscriptResult data={data} />
          </>
        )}
      </motion.div>
    </div>
  );
}
