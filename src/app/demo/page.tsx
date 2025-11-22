"use client";
import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/providers/ToastProvider";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv"]; // allowed
function isVideoFile(f: File | null) {
  if (!f) return false;
  if (f.type && f.type.startsWith("video/")) return true;
  const ext = f.name.split(".").pop()?.toLowerCase() || "";
  return VIDEO_EXTS.includes(ext);
}

export default function UploadPage() {
  const { notify } = useToast();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [isHover, setIsHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<string>("auto");  // Input video language
  const [targetLang, setTargetLang] = useState<string>("hi");  // Translation target language

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) {
      if (!isVideoFile(f)) {
        setError("Please upload a video file.");
        notify("Only video files are allowed", { variant: "error" });
        return;
      }
      setFile(f);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Keep drag & drop functional without changing highlight
    e.preventDefault();
  }, []);

  const onMouseEnter = useCallback(() => setIsHover(true), []);
  const onMouseLeave = useCallback(() => setIsHover(false), []);

  async function onUpload() {
    setError("");
    if (!file) return;
    if (!isVideoFile(file)) {
      setError("Please upload a video file.");
      notify("Only video files are allowed", { variant: "error" });
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Please login first to get a token.");
      return;
    }
    try {
      setStatus("uploading");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("language", language);  // Input language
      fd.append("target_lang", targetLang);  // Target language for translation
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Upload failed");
      }
      const data = await res.json();
      notify("Uploaded successfully", { variant: "success" });
      setStatus("success");
      // Clear file selection from UI after a successful upload
      setFile(null);
      // Redirect to per-file status page if available
      const fid = data?.file_id;
      if (typeof fid === "string" && fid.length > 0) {
        router.push(`/files/${encodeURIComponent(fid)}`);
      } else {
        router.push("/files");
      }
    } catch (e: any) {
      setError(e.message || "Upload failed");
      notify(e.message || "Upload failed", { variant: "error" });
      setStatus("error");
    } finally {
      // keep file displayed; user may upload again or change selection
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 pt-28 pb-20">
        <h1 className="text-center text-4xl sm:text-5xl font-extrabold heading-gradient text-glow-emerald">Voice Dubbing Studio</h1>
        <p className="mt-2 text-center section-subtitle">Upload your media for AI-powered voice cloning and lip sync</p>

        <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-zinc-900/60 p-4 sm:p-6 shadow-[0_20px_60px_-20px_rgba(16,185,129,0.25)]">
          <div
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className={
              "cursor-pointer rounded-xl border-2 border-dashed px-6 py-16 text-center transition-all " +
              (isHover
                ? "border-emerald-400 bg-emerald-500/5 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                : "border-emerald-400/20 bg-black/40")
            }
          >
            <div className="mx-auto mb-4 h-10 w-10 rounded-lg text-emerald-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-10 w-10 mx-auto">
                <path d="M12 16V4" />
                <path d="M6 10l6-6 6 6" />
                <path d="M20 20H4" />
              </svg>
            </div>
            <p className="text-lg font-semibold">Drop your file here or click to browse</p>
            <p className="mt-1 text-sm section-subtitle">Supports audio and video files (MP3, MP4, WAV, MOV, etc.)</p>
            <input
              type="file"
              ref={fileInputRef}
              accept="video/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f && !isVideoFile(f)) {
                  setError("Please upload a video file.");
                  notify("Only video files are allowed", { variant: "error" });
                  e.currentTarget.value = "";
                  setFile(null);
                  return;
                }
                setFile(f);
              }}
              className="hidden"
            />
          </div>
          {/* Selected file status row */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-zinc-300">
              {file ? (
                <span>
                  <span className="font-medium text-white">{file.name}</span>
                  <span className="ml-2 text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                </span>
              ) : (
                <span className="text-zinc-500">No file selected</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-300 flex items-center gap-2">
                <span>Input:</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-black border border-zinc-700 rounded-md px-2 py-1 text-white text-sm"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="zh">Chinese</option>
                </select>
              </label>

              <label className="text-sm text-zinc-300 flex items-center gap-2">
                <span>Translate to:</span>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="bg-black border border-zinc-700 rounded-md px-2 py-1 text-white text-sm"
                >
                  <option value="hi">Hindi</option>
                  <option value="bn">Bengali</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                  <option value="mr">Marathi</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="zh">Chinese</option>
                </select>
              </label>
              {status === "uploading" && (
                <span className="text-emerald-400 text-sm">Uploading...</span>
              )}
              {/* Hide 'Uploaded' text as requested */}
              {status === "error" && (
                <span className="text-red-400 text-sm">Failed</span>
              )}
              <Button onClick={onUpload} disabled={!file || status === "uploading"}>{status === "uploading" ? "Uploading..." : "Upload"}</Button>
            </div>
          </div>

          {error && <p className="mt-3 text-red-400 text-sm whitespace-pre-wrap">{error}</p>}
        </div>
      </div>
    </div>
  );
}
