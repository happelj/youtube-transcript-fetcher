import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useGetTranscript } from "@workspace/api-client-react";
import { TranscriptResult } from "@/components/TranscriptResult";
import { SermonCard } from "@/components/SermonCard";

type TranscriptUnavailableResult = {
  unavailable?: boolean;
  message?: string;
};

type OpenAiKeyStatus = {
  configured: boolean;
  source: "user" | "server" | "none";
  storageAvailable: boolean;
};

type OpenAiKeyMessage = {
  type: "success" | "error";
  text: string;
} | null;

const defaultOpenAiKeyStatus: OpenAiKeyStatus = {
  configured: false,
  source: "none",
  storageAvailable: false,
};

async function fetchOpenAiKeyStatus(): Promise<OpenAiKeyStatus> {
  const response = await fetch("/api/openai-key", {
    method: "GET",
  });

  if (!response.ok) {
    return defaultOpenAiKeyStatus;
  }

  return (await response.json()) as OpenAiKeyStatus;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [sermonMode, setSermonMode] = useState(false);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [showOpenAiApiKey, setShowOpenAiApiKey] = useState(false);
  const [openAiKeyStatus, setOpenAiKeyStatus] = useState<OpenAiKeyStatus>(
    defaultOpenAiKeyStatus,
  );
  const [openAiKeyPending, setOpenAiKeyPending] = useState(false);
  const [openAiKeyMessage, setOpenAiKeyMessage] =
    useState<OpenAiKeyMessage>(null);
  const { mutate: fetchTranscript, isPending, data, error, reset } = useGetTranscript();

  useEffect(() => {
    let canceled = false;

    fetchOpenAiKeyStatus().then((status) => {
      if (!canceled) {
        setOpenAiKeyStatus(status);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    if (sermonMode && !openAiKeyStatus.configured) {
      setOpenAiKeyMessage({
        type: "error",
        text: "Save an OpenAI API key first.",
      });
      return;
    }
    fetchTranscript({ data: { url, sermonMode } });
  };

  // Retry sermon detection only — re-submit the same URL with sermonMode on
  const handleRetrySermon = () => {
    if (!url.trim()) return;
    if (!openAiKeyStatus.configured) {
      setOpenAiKeyMessage({
        type: "error",
        text: "Save an OpenAI API key first.",
      });
      return;
    }
    fetchTranscript({ data: { url, sermonMode: true } });
  };

  const handleSaveOpenAiKey = async () => {
    const apiKey = openAiApiKey.trim();
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
      setOpenAiKeyMessage({
        type: "error",
        text: "Enter a valid OpenAI API key.",
      });
      return;
    }

    setOpenAiKeyPending(true);
    setOpenAiKeyMessage(null);

    try {
      const response = await fetch("/api/openai-key", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ apiKey }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Could not save the OpenAI API key.");
      }

      setOpenAiKeyStatus(payload as OpenAiKeyStatus);
      setOpenAiApiKey("");
      setShowOpenAiApiKey(false);
      setOpenAiKeyMessage({
        type: "success",
        text: "OpenAI API key saved.",
      });
    } catch (err: unknown) {
      setOpenAiKeyMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Could not save the OpenAI API key.",
      });
    } finally {
      setOpenAiKeyPending(false);
    }
  };

  const handleDeleteOpenAiKey = async () => {
    setOpenAiKeyPending(true);
    setOpenAiKeyMessage(null);

    try {
      const response = await fetch("/api/openai-key", {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete the OpenAI API key.");
      }

      setOpenAiKeyStatus(payload as OpenAiKeyStatus);
      setOpenAiApiKey("");
      setShowOpenAiApiKey(false);
      setOpenAiKeyMessage({
        type: "success",
        text: "OpenAI API key deleted.",
      });
    } catch (err: unknown) {
      setOpenAiKeyMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Could not delete the OpenAI API key.",
      });
    } finally {
      setOpenAiKeyPending(false);
    }
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
  const openAiStatusLabel =
    openAiKeyStatus.source === "user"
      ? "Saved"
      : openAiKeyStatus.source === "server"
        ? "Server key"
        : "Not saved";
  const openAiKeyRequired = sermonMode && !openAiKeyStatus.configured;

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
              disabled={isPending || !url.trim() || openAiKeyRequired}
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

          <AnimatePresence>
            {sermonMode && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -6 }}
                className="mt-3 overflow-hidden"
              >
                <div className="rounded-xl border border-border/80 bg-card/35 backdrop-blur-md p-3 shadow-lg">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <KeyRound className="h-4 w-4 text-primary" />
                      <span>OpenAI API Key</span>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${
                        openAiKeyStatus.configured
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-background/40 text-muted-foreground"
                      }`}
                    >
                      {openAiStatusLabel}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <input
                        type={showOpenAiApiKey ? "text" : "password"}
                        value={openAiApiKey}
                        onChange={(e) => setOpenAiApiKey(e.target.value)}
                        placeholder={
                          openAiKeyStatus.source === "user"
                            ? "Replace saved key"
                            : "sk-..."
                        }
                        autoComplete="off"
                        spellCheck={false}
                        disabled={openAiKeyPending || isPending}
                        className="h-11 w-full rounded-lg border border-border/80 bg-background/40 px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        title={showOpenAiApiKey ? "Hide key" : "Show key"}
                        onClick={() => setShowOpenAiApiKey((value) => !value)}
                        disabled={!openAiApiKey || openAiKeyPending || isPending}
                        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {showOpenAiApiKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveOpenAiKey}
                      disabled={openAiKeyPending || isPending || !openAiApiKey.trim()}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {openAiKeyPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span>Save</span>
                    </button>

                    {openAiKeyStatus.source === "user" && (
                      <button
                        type="button"
                        onClick={handleDeleteOpenAiKey}
                        disabled={openAiKeyPending || isPending}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border/80 bg-background/30 px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>

                  {openAiKeyMessage && (
                    <div
                      className={`mt-2 flex items-center gap-2 text-xs ${
                        openAiKeyMessage.type === "success"
                          ? "text-primary"
                          : "text-destructive"
                      }`}
                    >
                      {openAiKeyMessage.type === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      <span>{openAiKeyMessage.text}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
