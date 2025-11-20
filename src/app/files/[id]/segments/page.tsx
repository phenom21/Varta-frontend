"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

type Segment = {
    id: number;
    start_ms: number;
    end_ms: number;
    speaker_label: string;
    original_text: string;
    translated_text: string | null;
};

function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function SegmentsPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState("");

    useEffect(() => {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        if (!token) {
            router.replace("/login");
            return;
        }

        async function load() {
            try {
                const res = await fetch(`${API_BASE}/files/${encodeURIComponent(params.id)}/segments`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setSegments(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [params.id, router]);

    const handleSave = async (id: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const res = await fetch(`${API_BASE}/segments/${id}`, {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ translated_text: editText }),
            });

            if (res.ok) {
                setSegments(s => s.map(seg => seg.id === id ? { ...seg, translated_text: editText } : seg));
                setEditingId(null);
            } else {
                alert("Failed to save");
            }
        } catch (e) {
            alert("Error saving: " + e);
        }
    };

    if (loading) return <div className="min-h-screen bg-black text-white pt-28 px-6">Loading...</div>;

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">
                <div className="mb-6 flex items-center justify-between">
                    <Link href={`/files/${params.id}`} className="text-zinc-400 hover:text-white inline-flex items-center gap-2">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                        Back to File
                    </Link>
                    <h1 className="text-2xl font-bold">Translated Segments</h1>
                </div>

                <div className="space-y-4">
                    {segments.map((seg) => (
                        <div key={seg.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-xs text-zinc-500 font-mono">
                                    {formatTime(seg.start_ms)} - {formatTime(seg.end_ms)} • {seg.speaker_label}
                                </div>
                                {editingId !== seg.id && (
                                    <button
                                        onClick={() => { setEditingId(seg.id); setEditText(seg.translated_text || ""); }}
                                        className="text-xs text-emerald-400 hover:text-emerald-300"
                                    >
                                        Edit
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="text-zinc-400 text-sm border-r border-zinc-800 pr-4">
                                    {seg.original_text}
                                </div>
                                <div className="text-white text-sm">
                                    {editingId === seg.id ? (
                                        <div className="flex flex-col gap-2">
                                            <textarea
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white focus:outline-none focus:border-emerald-500"
                                                rows={3}
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <Button variant="secondary" onClick={() => setEditingId(null)} className="text-xs py-1 h-auto">Cancel</Button>
                                                <Button variant="primary" onClick={() => handleSave(seg.id)} className="text-xs py-1 h-auto">Save</Button>
                                            </div>
                                        </div>
                                    ) : (
                                        seg.translated_text || <span className="text-zinc-600 italic">No translation</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {segments.length === 0 && (
                        <div className="text-center text-zinc-500 py-10">No segments found.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
