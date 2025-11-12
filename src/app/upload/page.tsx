"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/providers/AuthProvider";

// Lazy-load the existing upload page implementation (previously at ../demo/page)
const InnerUpload = dynamic(() => import("../demo/page"), { ssr: false });

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

  if (!mounted) return null;
  if (!isAuthed) return null;
  return <InnerUpload />;
}

