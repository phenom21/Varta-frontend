"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

type FileDetails = {
  id: string;
  name: string;
  size?: number;
  uploaded_at?: string;
  kind?: "video" | "image" | "file";
  status?: string;
  duration?: string;
  progress?: any;
};

function formatBytes(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatDate(d?: string) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

function formatDurationSec(total?: number | null) {
  if (typeof total !== "number" || !isFinite(total) || total < 0) return "";
  const sec = Math.floor(total);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function FileDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<{
    status: string;
    progress: number;
    status_message?: string | null;
    transcript_txt?: string | null;
    transcript_json?: string | null;
    processing_time_seconds?: number | null;
  } | null>(null);
  const [speakers, setSpeakers] = useState<
    Array<{
      id: number | string;
      speaker_label: string;
      display_name?: string | null;
      sample_status: string;
      sample_path?: string | null;
      sample_quality?: { total_duration_sec?: number; avg_rms?: number; segment_ids_used?: number[] } | null;
      clone_state?: Record<string, any> | null;
    }>
  >([]);
  const [ttsBusy, setTtsBusy] = useState<Record<string, boolean>>({});
  const [ttsText, setTtsText] = useState<Record<string, string>>({});
  const [translateBusy, setTranslateBusy] = useState(false);
  const [targetLang, setTargetLang] = useState("hi");
  const [ttsGenerating, setTtsGenerating] = useState(false);
  const [ttsProgress, setTtsProgress] = useState<{
    total_segments?: number;
    done?: number;
    errors?: number;
    status?: string;
  } | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.replace("/login");
      return;
    }
    async function fetchSpeakersOnce() {
      try {
        const spRes = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/speakers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (spRes.ok) {
          const data = await spRes.json();
          if (Array.isArray(data.speakers)) setSpeakers(data.speakers);
        }
      } catch { }
    }
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setDetails({
          id: data.id,
          name: data.name,
          size: data.size,
          uploaded_at: data.uploaded_at,
          kind: data.kind,
          status: data.status || "completed",
          duration: data.duration,
          progress: data.progress,
        });

        // Fetch preview blob securely with Authorization and create an object URL
        try {
          const mediaRes = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/content`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (mediaRes.ok) {
            const blob = await mediaRes.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
          }
        } catch { }
        // Fetch speakers for this file
        try {
          await fetchSpeakersOnce();
        } catch { }
      } catch (e) {
        setDetails(null);
      } finally {
        setLoading(false);
      }
    }
    load();

    // Poll for file status updates (translation, TTS, etc.)
    const pollInterval = setInterval(load, 3000);
    return () => clearInterval(pollInterval);
  }, [params.id, router]);

  // Refetch speakers when status/progress changes via SSE
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token || !txStatus) return;
    (async () => {
      try {
        const spRes = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/speakers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (spRes.ok) {
          const data = await spRes.json();
          if (Array.isArray(data.speakers)) setSpeakers(data.speakers);
        }
      } catch { }
    })();
  }, [txStatus?.status, txStatus?.progress, params.id]);

  useEffect(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [params.id, router]);

  // Stream transcription status via SSE, fallback to polling if SSE fails
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    let aborted = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let ctrl: AbortController | null = null;

    async function startSSE() {
      try {
        ctrl = new AbortController();
        const res = await fetch(`${API_BASE}/status/stream/${encodeURIComponent(params.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error("SSE failed");
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 2);
            if (chunk.startsWith("data:")) {
              const payload = chunk.slice(5).trim();
              try {
                const data = JSON.parse(payload);
                setTxStatus({
                  status: data.status,
                  progress: typeof data.progress === "number" ? data.progress : 0,
                  status_message: data.status_message,
                  transcript_txt: data.transcript_txt || null,
                  transcript_json: data.transcript_json || null,
                  processing_time_seconds: typeof data.processing_time_seconds === "number" ? data.processing_time_seconds : null,
                });
                if (data.status === "transcribed" || data.status === "failed") {
                  aborted = true;
                  ctrl?.abort();
                  break;
                }
              } catch { }
            }
          }
        }
      } catch {
        // Fallback to polling
        if (!aborted) {
          let timer: number | undefined;
          const poll = async () => {
            try {
              const r = await fetch(`${API_BASE}/status/${encodeURIComponent(params.id)}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (r.ok) {
                const data = await r.json();
                setTxStatus({
                  status: data.status,
                  progress: typeof data.progress === "number" ? data.progress : 0,
                  status_message: data.status_message,
                  transcript_txt: data.transcript_txt || null,
                  transcript_json: data.transcript_json || null,
                  processing_time_seconds: typeof data.processing_time_seconds === "number" ? data.processing_time_seconds : null,
                });
                if (data.status === "transcribed" || data.status === "failed") return;
              }
            } catch { }
            timer = window.setTimeout(poll, 2000);
          };
          poll();
          return () => timer && window.clearTimeout(timer);
        }
      }
    }
    startSSE();
    return () => {
      aborted = true;
      ctrl?.abort();
      reader?.releaseLock();
    };
  }, [params.id]);

  if (loading) return <div className="min-h-screen bg-black text-white pt-28 px-6">Loading...</div>;
  if (!details) return <div className="min-h-screen bg-black text-white pt-28 px-6">File not found.</div>;


  // ... (existing effects)

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        {/* ... (existing header) */}
        <div className="mb-4">
          <Link href="/files" className="text-zinc-400 hover:text-white inline-flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            Back to Files
          </Link>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold heading-gradient text-glow-emerald">{details.name}</h1>
            <p className="mt-1 text-zinc-400">Uploaded on {formatDate(details.uploaded_at)}</p>
          </div>
          <span className={
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium h-7 " +
            ((txStatus?.status || details.status) === "failed"
              ? "bg-red-500/10 text-red-300 border border-red-500/30"
              : (txStatus?.status || details.status) === "processing"
                ? "bg-blue-500/10 text-blue-300 border border-blue-500/30"
                : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30")
          }>
            {(txStatus?.status || details.status || "completed").toString()}
          </span>
        </div>

        {/* Transcription status */}
        <div className="mt-6 rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6v12M6 12h12" /></svg>
              Transcription
            </div>
            <div className="text-sm text-zinc-400">
              {typeof txStatus?.progress === "number" ? `${txStatus.progress}%` : ""}
            </div>
          </div>
          <div className="mt-4 h-2 w-full rounded bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, txStatus?.progress ?? 0))}%` }}
            />
          </div>
          {typeof txStatus?.processing_time_seconds === "number" && (
            <p className="mt-2 text-xs text-zinc-500">Processing time: {formatDurationSec(txStatus.processing_time_seconds)}</p>
          )}
          {txStatus?.status_message && (
            <p className="mt-3 text-sm text-zinc-400">{txStatus.status_message}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={!txStatus?.transcript_txt}
              onClick={async () => {
                if (!txStatus?.transcript_txt) return;
                const token = localStorage.getItem("token");
                if (!token) return;
                const res = await fetch(`${API_BASE}${txStatus.transcript_txt}`, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${details.name}.txt`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
            >Download TXT</Button>
            <Button
              disabled={!txStatus?.transcript_json}
              onClick={async () => {
                if (!txStatus?.transcript_json) return;
                const token = localStorage.getItem("token");
                if (!token) return;
                const res = await fetch(`${API_BASE}${txStatus.transcript_json}`, { headers: { Authorization: `Bearer ${token}` } });
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${details.name}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
              variant="secondary"
            >Download JSON</Button>
            <Button
              disabled={!txStatus || (txStatus.status !== "transcribed")}
              onClick={async () => {
                const token = localStorage.getItem("token");
                if (!token) return;
                const res = await fetch(`${API_BASE}/download/final/${encodeURIComponent(params.id as string)}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${details.name.replace(/\.[^.]+$/, '')}_final.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
              variant="secondary"
            >Download Final JSON</Button>
          </div>
        </div>

        {/* Translation Section */}
        <div className="mt-6 rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8l6 6M19 6l-7 7-7-7" /></svg>
              Translation
            </div>
            <div className="text-sm text-zinc-400">
              {details?.status === 'translating' ? (
                <span className="text-blue-400">Processing</span>
              ) : details?.status === 'translated' ? (
                <span className="text-emerald-400">Complete</span>
              ) : (details?.progress as any)?.translate?.translated_segments > 0 ? (
                <span className="text-yellow-400">Partial</span>
              ) : "Not started"}
            </div>
          </div>

          {(details?.status === 'translating' || (details?.progress as any)?.translate?.status === 'processing') && (
            <div className="mt-4">
              <div className="h-2 w-full rounded bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(5,
                      ((details?.progress as any)?.translate?.translated_segments || 0) /
                      Math.max(1, (details?.progress as any)?.translate?.total_segments || 1) * 100
                    ))}%`
                  }}
                />
              </div>
              {(details?.progress as any)?.translate?.total_segments > 0 && (
                <div className="mt-2 text-xs text-zinc-500">
                  {(details?.progress as any).translate.translated_segments || 0} / {(details?.progress as any).translate.total_segments} segments
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center gap-4">
            <select
              className="bg-zinc-950 border border-zinc-800 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={translateBusy || details?.status === 'translating'}
            >
              <option value="hi">Hindi (IndicTrans2)</option>
              <option value="bn">Bengali (IndicTrans2)</option>
              <option value="ta">Tamil (IndicTrans2)</option>
              <option value="te">Telugu (IndicTrans2)</option>
              <option value="mr">Marathi (IndicTrans2)</option>
              <option value="es">Spanish (M2M-100)</option>
              <option value="fr">French (M2M-100)</option>
              <option value="de">German (M2M-100)</option>
              <option value="zh">Chinese (M2M-100)</option>
            </select>

            <Button
              variant="primary"
              disabled={translateBusy || details?.status === 'translating'}
              onClick={async () => {
                setTranslateBusy(true);
                try {
                  const token = localStorage.getItem("token");
                  if (!token) return;
                  // Optimistically update status
                  setDetails(prev => prev ? ({ ...prev, status: 'translating' }) : null);

                  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id as string)}/translate`, {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${token}`,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ target_lang: targetLang, force: true })
                  });
                  if (!res.ok) throw new Error(await res.text());
                } catch (e) {
                  alert("Translation failed to start: " + e);
                } finally {
                  setTranslateBusy(false);
                }
              }}
            >
              {details?.status === 'translating' ? "Translating..." : "Start Translation"}
            </Button>

            {details?.status === 'translated' && (
              <Link href={`/files/${params.id}/segments`} className="text-emerald-400 hover:text-emerald-300 text-sm underline">
                View Segments
              </Link>
            )}
          </div>
        </div>

        {/* TTS Generation Section */}
        {(txStatus?.status === "translated" || txStatus?.status === "tts" || txStatus?.status === "tts_done" || txStatus?.status === "tts_partial" || txStatus?.status === "voices_clone_ready" || txStatus?.status === "diarized" || txStatus?.status === "transcribed") && (
          <div className="mt-6 rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-200 font-semibold">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                Text-to-Speech Generation
              </div>
              <div className="text-sm text-zinc-400">
                {txStatus?.status === "tts" ? (
                  <span className="text-blue-400">Processing...</span>
                ) : txStatus?.status === "tts_done" ? (
                  <span className="text-emerald-400">✓ Complete</span>
                ) : txStatus?.status === "tts_partial" ? (
                  <span className="text-amber-400">Partial</span>
                ) : (
                  "Ready"
                )}
              </div>
            </div>

            {ttsProgress && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-zinc-400">
                    Progress: {ttsProgress.done || 0} / {ttsProgress.total_segments || 0} segments
                  </span>
                  {(ttsProgress.errors || 0) > 0 && (
                    <span className="text-red-400">
                      {ttsProgress.errors} errors
                    </span>
                  )}
                </div>
                <div className="h-2 w-full rounded bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, ((ttsProgress.done || 0) / (ttsProgress.total_segments || 1)) * 100))}%`
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-4">
              <Button
                variant="primary"
                disabled={
                  ttsGenerating ||
                  txStatus?.status === "tts" ||
                  !(details?.status === "ready_for_tts" || details?.status === "translated")
                }
                onClick={async () => {
                  setTtsGenerating(true);
                  try {
                    const token = localStorage.getItem("token");
                    if (!token) return;

                    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id as string)}/tts`, {
                      method: "POST",
                      headers: {
                        "Authorization": `Bearer ${token}`,
                      },
                    });

                    if (!res.ok) throw new Error(await res.text());

                    const data = await res.json();
                    console.log("TTS job enqueued:", data);

                    // Start polling for status
                    const pollInterval = setInterval(async () => {
                      try {
                        const statusRes = await fetch(
                          `${API_BASE}/files/${encodeURIComponent(params.id as string)}/tts/status`,
                          { headers: { Authorization: `Bearer ${token}` } }
                        );

                        if (statusRes.ok) {
                          const statusData = await statusRes.json();
                          setTtsProgress(statusData.tts_progress || null);

                          if (statusData.status === "tts_done" || statusData.status === "tts_partial") {
                            clearInterval(pollInterval);
                            setTtsGenerating(false);
                          }
                        }
                      } catch (err) {
                        console.error("TTS status poll error:", err);
                      }
                    }, 3000);

                    // Clear interval after 2 hours
                    setTimeout(() => clearInterval(pollInterval), 2 * 60 * 60 * 1000);

                  } catch (e) {
                    alert("TTS generation failed to start: " + e);
                    setTtsGenerating(false);
                  }
                }}
              >
                {ttsGenerating || txStatus?.status === "tts"
                  ? "⏳ Generating Speech..."
                  : txStatus?.status === "tts_done"
                    ? "🔄 Regenerate Speech"
                    : "🎤 Generate Speech Audio"}
              </Button>

              {txStatus?.status === "tts_done" && (
                <div className="text-sm text-emerald-400">
                  ✓ Audio files ready for stitching
                </div>
              )}
            </div>

            {txStatus?.status === "tts_partial" && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-300">
                ⚠️ Some segments failed to generate. Check logs for details.
              </div>
            )}
          </div>
        )}

        {/* ... (rest of the page: Original/Transformed, File Details, Actions, Speakers) */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
              Original {details.kind === "image" ? "Image" : details.kind === "video" ? "Video" : "File"}
            </div>
            <p className="text-zinc-400 text-sm">Your uploaded {details.kind || "file"}</p>
            <div className="mt-4 rounded-xl bg-black border border-zinc-800">
              {details.kind === "image" && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={details.name} className="w-full h-auto rounded-xl" />
              ) : details.kind === "video" && previewUrl ? (
                <video controls src={previewUrl} className="w-full rounded-xl" />
              ) : (
                <div className="h-56" />
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
              Transformed {details.kind === "image" ? "Image" : details.kind === "video" ? "Video" : "Output"}
            </div>
            <p className="text-zinc-400 text-sm">AI-processed result</p>
            <div className="mt-4 rounded-xl bg-black border border-zinc-800 h-56"></div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="2" /></svg>
              File Details
            </div>
            <div className="mt-4 grid grid-cols-2 gap-y-4 text-sm">
              <div className="text-zinc-400">Duration</div>
              <div className="text-white">{details.duration || "—"}</div>

              <div className="text-zinc-400">File Size</div>
              <div className="text-white">{formatBytes(details.size)}</div>

              <div className="text-zinc-400">Upload Date</div>
              <div className="text-white">{formatDate(details.uploaded_at)}</div>

              <div className="text-zinc-400">Status</div>
              <div className="text-white capitalize">{details.status}</div>
            </div>

            <div className="mt-6 text-sm">
              <div className="text-zinc-200 font-semibold">Processing Settings</div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="text-zinc-400">Voice Cloning</div>
                <div className="col-span-2"><span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">Enabled</span></div>
                <div className="text-zinc-400">Lip Sync</div>
                <div className="col-span-2"><span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">Enabled</span></div>
                <div className="text-zinc-400">Target Language</div>
                <div className="col-span-2 text-white">English</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
            <div className="text-zinc-200 font-semibold">Actions</div>
            <div className="mt-4 space-y-3">
              <Button
                className="w-full"
                variant="primary"
                onClick={async () => {
                  const token = localStorage.getItem("token");
                  if (!token) return;
                  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(details.id)}/download`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) return;
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = details.name;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                }}
              >
                Download Result
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                }}
              >
                Share
              </Button>
              <Button className="w-full" variant="secondary" disabled>Reprocess</Button>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-emerald-500/15 bg-zinc-900/40 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>
              Speakers
            </div>
            <div className="text-sm text-zinc-400">{speakers.length} found</div>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {speakers.map((sp) => {
              const label = sp.speaker_label || "speaker";
              const dur = typeof sp.sample_quality?.total_duration_sec === "number" ? sp.sample_quality.total_duration_sec : undefined;
              const rms = typeof sp.sample_quality?.avg_rms === "number" ? sp.sample_quality.avg_rms : undefined;
              const sampleUrl = `${API_BASE}/files/${encodeURIComponent(params.id as string)}/speakers/${encodeURIComponent(label)}/sample`;
              const ttsUrl = `${API_BASE}/files/${encodeURIComponent(params.id as string)}/speakers/${encodeURIComponent(label)}/tts`;
              const ttsWavUrl = `${API_BASE}/files/${encodeURIComponent(params.id as string)}/speakers/${encodeURIComponent(label)}/tts.wav`;
              return (
                <div key={`${sp.id}-${label}`} className="rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-white">{sp.display_name || label}</div>
                    <span className={
                      "text-xs px-2 py-0.5 rounded-full border " +
                      (sp.sample_status === "clone_ready" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                        sp.sample_status === "ready" ? "bg-blue-500/10 text-blue-300 border-blue-500/30" :
                          sp.sample_status === "low_quality" ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                            sp.sample_status === "insufficient" ? "bg-red-500/10 text-red-300 border-red-500/30" :
                              "bg-zinc-700/20 text-zinc-300 border-zinc-700/50")
                    }>{sp.sample_status}</span>
                  </div>
                  <div className="mt-3 text-sm text-zinc-400">
                    <div>Sample duration: {typeof dur === "number" ? `${Math.round(dur)}s` : "—"}</div>
                    <div>Avg RMS: {typeof rms === "number" ? rms.toFixed(4) : "—"}</div>
                    <div className="break-all">Model: {sp.clone_state?.model_name || "—"}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={!sp.sample_path || (sp.sample_status !== "ready" && sp.sample_status !== "low_quality" && sp.sample_status !== "clone_ready")}
                      onClick={async () => {
                        const token = localStorage.getItem("token");
                        if (!token) return;
                        try {
                          const res = await fetch(sampleUrl, { headers: { Authorization: `Bearer ${token}` } });
                          if (!res.ok) return;
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const audio = new Audio(url);
                          audio.play();
                        } catch { }
                      }}
                    >Play sample</Button>
                    <Button
                      variant="secondary"
                      disabled={!sp.sample_path}
                      onClick={async () => {
                        const token = localStorage.getItem("token");
                        if (!token) return;
                        const res = await fetch(sampleUrl, { headers: { Authorization: `Bearer ${token}` } });
                        if (!res.ok) return;
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${label}_auto_sample.wav`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      }}
                    >Download WAV</Button>
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        className="w-44 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-200 focus:outline-none"
                        placeholder="TTS text"
                        value={ttsText[label] ?? "This is a test line."}
                        onChange={(e) => setTtsText((s) => ({ ...s, [label]: e.target.value }))}
                      />
                      <Button
                        variant="primary"
                        disabled={ttsBusy[label] || !(sp.sample_status === "ready" || sp.sample_status === "low_quality" || sp.sample_status === "clone_ready")}
                        onClick={async () => {
                          const token = localStorage.getItem("token");
                          if (!token) return;
                          setTtsBusy((s) => ({ ...s, [label]: true }));
                          try {
                            const form = new FormData();
                            form.append("text", (ttsText[label] ?? "This is a test line.").slice(0, 200));
                            const r = await fetch(ttsUrl, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
                            if (!r.ok) throw new Error(await r.text());
                            // poll for tts.wav up to ~45s with backoff
                            const deadline = Date.now() + 45000;
                            let played = false;
                            let delay = 600;
                            while (Date.now() < deadline) {
                              const bust = Date.now();
                              const wav = await fetch(`${ttsWavUrl}?t=${bust}` as string, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
                              if (wav.ok) {
                                const blob = await wav.blob();
                                const url = URL.createObjectURL(blob);
                                const audio = new Audio(url);
                                audio.play();
                                // Refresh speakers immediately after a successful synth
                                try {
                                  const spRes = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id as string)}/speakers`, {
                                    headers: { Authorization: `Bearer ${token}` },
                                  });
                                  if (spRes.ok) {
                                    const data = await spRes.json();
                                    if (Array.isArray(data.speakers)) setSpeakers(data.speakers);
                                  }
                                } catch { }
                                played = true;
                                break;
                              }
                              await new Promise((res) => setTimeout(res, delay));
                              delay = Math.min(2000, Math.floor(delay * 1.5));
                            }
                            if (!played) {
                              alert("TTS not ready yet. Try again in a moment.");
                            }
                          } catch (e) {
                            // no-op
                          } finally {
                            setTtsBusy((s) => ({ ...s, [label]: false }));
                          }
                        }}
                      >{ttsBusy[label] ? "Synthesizing..." : "Synthesize TTS"}</Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {speakers.length === 0 && (
              <div className="text-sm text-zinc-400">No speakers yet. They will appear after processing.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
