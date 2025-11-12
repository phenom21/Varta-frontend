"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/providers/AuthProvider";

// Lazy-load the existing upload page implementation with a dark fallback to avoid white flashes
const InnerUpload = dynamic(() => import("../demo/page"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-black" />,
});

export default function UploadGuardPage() {
  const { isAuthed } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !isAuthed) {
      router.replace("/login");
    }
  }, [mounted, isAuthed, router]);

  // Always render a dark background shell to avoid white flashes during transitions
  if (!mounted) return <div className="min-h-screen bg-black" />;
  if (!isAuthed) return <div className="min-h-screen bg-black" />;
  return (
    <div className="min-h-screen bg-black">
      <InnerUpload />
    </div>
  );
}

