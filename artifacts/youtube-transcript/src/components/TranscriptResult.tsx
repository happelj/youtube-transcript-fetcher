import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Download, FileJson, Check, ExternalLink, Youtube, Search } from "lucide-react";
import { formatTime, downloadFile, cn } from "@/lib/utils";
import type { TranscriptResponse } from "@workspace/api-client-react";

interface TranscriptResultProps {
  data: TranscriptResponse;
}

export function TranscriptResult({ data }: TranscriptResultProps) {
  const [view, setView] = useState<"plain" | "timestamped">("timestamped");
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");

  /**
   * Build transcript text for clipboard / TXT download.
   * When AI sermon boundaries are present, prepend a summary header.
   */
  const buildTextContent = () => {
    const transcriptLines =
      view === "plain"
        ? data.fullText
        : data.segments.map((s) => `[${formatTime(s.offset)}] ${s.text}`).join("\n");

    const s = data.sermon;
    if (s && !s.error && s.start && s.end) {
      const conf = s.confidence ? ` (${s.confidence} confidence)` : "";
      const header = [
        `Sermon Start: ${s.start.timestamp} — "${s.start.text}"`,
        `Sermon End:   ${s.end.timestamp} — "${s.end.text}"`,
        `Method: AI${conf}`,
        "",
        "---",
        "",
      ].join("\n");
      return header + transcriptLines;
    }

    return transcriptLines;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildTextContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    downloadFile(
      `youtube-transcript-${data.videoId}.txt`,
      buildTextContent(),
      "text/plain",
    );
  };

  const handleDownloadJson = () => {
    // Full response including sermon boundaries if present
    const content = JSON.stringify(data, null, 2);
    downloadFile(`youtube-transcript-${data.videoId}.json`, content, "application/json");
  };

  const filteredSegments = data.segments.filter((s) =>
    s.text.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full mt-6 bg-card/60 backdrop-blur-xl border border-border rounded-2xl overflow-hidden shadow-2xl shadow-black/50"
    >
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-border bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <Youtube className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Transcript Ready</p>
              <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 mt-0.5"
              >
                {data.videoId} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-background/50 p-1 rounded-lg border border-border">
            <button
              onClick={() => setView("timestamped")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                view === "timestamped"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              Timestamps
            </button>
            <button
              onClick={() => setView("plain")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                view === "plain"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              Plain Text
            </button>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-background/20 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search transcript..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background/50 border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <button
            onClick={handleCopy}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 border border-border rounded-lg text-sm font-medium transition-all"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            onClick={handleDownloadTxt}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 border border-border rounded-lg text-sm font-medium transition-all"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">.TXT</span>
          </button>
          <button
            onClick={handleDownloadJson}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 border border-border rounded-lg text-sm font-medium transition-all"
          >
            <FileJson className="w-4 h-4" />
            <span className="hidden sm:inline">.JSON</span>
          </button>
        </div>
      </div>

      {/* Transcript Content */}
      <div className="p-4 sm:p-6 bg-background/40">
        <div className="h-[400px] overflow-y-auto pr-4 scroll-smooth">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.2 }}
            >
              {view === "plain" ? (
                <div className="prose prose-invert max-w-none">
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap font-sans text-sm sm:text-base">
                    {data.fullText}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {filteredSegments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                      <Search className="w-8 h-8 mb-3 opacity-50" />
                      <p>No matching segments found.</p>
                    </div>
                  ) : (
                    filteredSegments.map((segment, idx) => (
                      <div
                        key={idx}
                        className="group flex gap-4 px-3 py-2 hover:bg-muted/20 rounded-lg transition-colors border border-transparent hover:border-border/50"
                      >
                        <span className="text-primary/70 font-mono text-xs sm:text-sm pt-0.5 min-w-[50px] shrink-0 select-none">
                          [{formatTime(segment.offset)}]
                        </span>
                        <span className="text-foreground/90 font-sans text-sm sm:text-base leading-relaxed">
                          {segment.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
