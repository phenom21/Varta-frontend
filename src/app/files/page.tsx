"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { useToast } from "@/components/providers/ToastProvider";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

type FileItem = {
  id: string;
  name: string;
  size?: number; // bytes
  uploaded_at?: string; // ISO
  status?: "completed" | "processing" | "failed";
  duration?: string; // e.g., "03:45"
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

function getKindIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const videoExts = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv"];
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "svg"];
  const isVideo = videoExts.includes(ext);
  const isImage = imageExts.includes(ext);
  if (isImage) {
    // Image icon
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8.5" cy="10" r="1.5" />
        <path d="M21 16l-5.5-5.5L9 17l-2-2-4 4" />
      </svg>
    );
  }
  // Default to video icon
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h5M7 14h3" />
    </svg>
  );
}

export default function FilesPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/files`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        // Expect an array; normalize into FileItem
        const normalized: FileItem[] = (Array.isArray(data) ? data : []).map((it: any) => ({
          id: it.id || it.path || it.name,
          name: it.name || it.filename || it.path?.split("/").pop() || "unknown",
          size: typeof it.size === "number" ? it.size : undefined,
          uploaded_at: it.uploaded_at || it.created_at || undefined,
          status: (it.status as FileItem["status"]) || "completed",
          duration: it.duration || undefined,
        }));
        setItems(normalized);
      } catch (e: any) {
        notify(e.message || "Failed to load files", { variant: "error" });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, notify]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl sm:text-5xl font-extrabold text-emerald-400 text-glow-emerald">Your Files</h1>
            <p className="mt-1 text-zinc-400">Manage and view all your processed videos</p>
          </div>
          <Button onClick={() => router.push("/upload")} className="h-10 px-4 flex items-center gap-2" variant="primary">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 16V4" />
              <path d="M6 10l6-6 6 6" />
              <path d="M20 20H4" />
            </svg>
            Upload New File
          </Button>
        </div>

        {loading ? (
          <p className="mt-10 text-zinc-400">Loading...</p>
        ) : items.length === 0 ? (
          <div className="mt-10 rounded-xl border border-emerald-500/20 bg-zinc-900/40 p-8 text-center">
            <p className="text-zinc-300">No files yet. Start by uploading your first file.</p>
            <div className="mt-4">
              <Button onClick={() => router.push("/upload")}>Upload New File</Button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.map((f, idx) => (
              <Link key={idx} href={`/files/${encodeURIComponent(f.id)}`} className="block group">
                <div
                  className="rounded-2xl border border-emerald-500/10 bg-[#0c0f0d] p-5 shadow-[0_40px_80px_-40px_rgba(16,185,129,0.35)] group-hover:shadow-[0_50px_100px_-40px_rgba(16,185,129,0.45)] transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                        {getKindIcon(f.name)}
                      </div>
                      <div>
                        <div className="font-semibold text-white line-clamp-1">{f.name}</div>
                        <div className="text-xs text-zinc-400">{f.uploaded_at ? `Uploaded on ${formatDate(f.uploaded_at)}` : "Uploaded"}</div>
                      </div>
                    </div>
                    <div>
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium " +
                          (f.status === "failed"
                            ? "bg-red-500/10 text-red-300 border border-red-500/30"
                            : f.status === "processing"
                            ? "bg-blue-500/10 text-blue-300 border border-blue-500/30"
                            : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30")
                        }
                      >
                        {f.status === "failed" ? "Failed" : f.status === "processing" ? "Processing" : "Completed"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-sm text-zinc-400">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                        {f.duration || ""}
                      </span>
                    </div>
                    <div className="text-right text-zinc-300">{formatBytes(f.size)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
