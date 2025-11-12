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
  status?: "completed" | "processing" | "failed";
  duration?: string;
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

export default function FileDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.replace("/login");
      return;
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
        } catch {}
      } catch (e) {
        setDetails(null);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [params.id, router]);

  if (loading) return <div className="min-h-screen bg-black text-white pt-28 px-6">Loading...</div>;
  if (!details) return <div className="min-h-screen bg-black text-white pt-28 px-6">File not found.</div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="mb-4">
          <Link href="/files" className="text-zinc-400 hover:text-white inline-flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
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
            (details.status === "failed"
              ? "bg-red-500/10 text-red-300 border border-red-500/30"
              : details.status === "processing"
              ? "bg-blue-500/10 text-blue-300 border border-blue-500/30"
              : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30")
          }>
            {details.status === "failed" ? "failed" : details.status === "processing" ? "processing" : "completed"}
          </span>
        </div>

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
      </div>
    </div>
  );
}
