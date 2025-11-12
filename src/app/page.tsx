"use client";
import { Button } from "@/components/ui/Button";
import FeatureCard from "@/components/FeatureCard";
import { MicIcon, WaveSyncIcon, SparkIcon, BoltIcon, GlobeIcon, ShieldIcon } from "@/components/icons";
import { useAuth } from "@/components/providers/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";

export default function Home() {
  const { isAuthed } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <main className="bg-black text-white min-h-screen">
      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-28 pb-16 text-center">
        <div className="mt-6 mb-6 flex justify-center">
          <div className="inline-block rounded-lg overflow-hidden bg-black">
            <Image
              src="/varta-hero.png"
              alt="Varta"
              width={240}
              height={160}
              className="block h-14 sm:h-20 w-auto"
              priority
              style={{ clipPath: "inset(1.5px round 10px)" }}
            />
          </div>
        </div>
        <h1 className="mx-auto max-w-5xl text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.1]">
          <span className="heading-gradient text-glow-emerald">Transform voices with</span>
          <br className="hidden sm:block" />
          <span className="heading-gradient text-glow-emerald">AI precision</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg sm:text-xl font-medium leading-relaxed text-white">
            Varta combines cutting-edge voice cloning and lip sync technology to create perfectly dubbed content in any language
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => router.push(isAuthed ? "/files" : "/login")}>Get Started</Button>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-emerald-400 text-glow-emerald text-center mt-30">Powerful Features</h2>
        <p className="text-center section-subtitle mt-2">Everything you need for professional voice dubbing</p>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard title="Voice Cloning" description="Clone any voice with incredible accuracy using advanced AI models" icon={<MicIcon className="h-8 w-8" />} />
          <FeatureCard title="Lip Sync" description="Perfect lip synchronization for natural-looking dubbed content" icon={<WaveSyncIcon className="h-8 w-8" />} />
          <FeatureCard title="AI Enhancement" description="Enhance audio quality and remove background noise automatically" icon={<SparkIcon className="h-8 w-8" />} />
          <FeatureCard title="Fast Processing" description="Get results in minutes, not hours, with our optimized pipeline" icon={<BoltIcon className="h-8 w-8" />} />
          <FeatureCard title="Multi-Language" description="Support for 50+ languages with natural pronunciation" icon={<GlobeIcon className="h-8 w-8" />} />
          <FeatureCard title="Secure & Private" description="Your data is encrypted and processed with enterprise-grade security" icon={<ShieldIcon className="h-8 w-8" />} />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl border border-emerald-500/20 bg-zinc-900/50 p-8 text-center shadow-[0_20px_60px_-20px_rgba(16,185,129,0.25)]">
          <h3 className="text-2xl sm:text-3xl font-extrabold heading-gradient text-glow-emerald">Ready to get started?</h3>
          <p className="section-subtitle mt-2">Join thousands of creators using Varta for their dubbing needs</p>
          <div className="mt-6">
            {!mounted ? (
              <div className="h-10" />
            ) : isAuthed ? (
              <Button className="px-6" variant="secondary" onClick={() => router.push("/upload")}>Go to Upload</Button>
            ) : (
              <Button className="px-6" onClick={() => router.push("/signup")}>Create Free Account</Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
