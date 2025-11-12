"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/providers/ToastProvider";
import { useAuth } from "@/components/providers/AuthProvider";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export default function SignupPage() {
  const router = useRouter();
  const { notify } = useToast();
  const { setToken } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Full name is optional for backend, but present for UI parity
    if (fullName && fullName.trim().length < 2) {
      setError("Please enter a valid name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Please enter a valid email");
      return;
    }
    const strongPasswordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

    if (!strongPasswordRegex.test(password)) {
      setError(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character"
      );
      return;
    }
    
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName || null }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Signup failed");
      }
      // Auto-login after successful signup
      const loginRes = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        // If auto-login fails, fall back to manual login
        notify("Account created. Please login.", { variant: "info" });
        router.push("/login");
        return;
      }
      const loginData = await loginRes.json();
      setToken(loginData.access_token);
      notify("Account created and signed in", { variant: "success" });
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Signup failed");
      notify(err.message || "Signup failed", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-md px-6 pt-28 pb-20">
        <div className="rounded-2xl border border-emerald-500/20 bg-zinc-900/60 shadow-[0_20px_60px_-20px_rgba(16,185,129,0.25)] p-6 sm:p-8">
          <h1 className="text-center text-3xl sm:text-4xl font-extrabold heading-gradient text-glow-emerald">Create Account</h1>
          <p className="mt-2 text-center section-subtitle">Get started with Varta today</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="fullname" className="mb-1 block text-sm text-zinc-300">Full Name</label>
              <input
                id="fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="w-full rounded-xl bg-black/40 border border-zinc-700 px-4 h-11 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-zinc-500"
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1 block text-sm text-zinc-300">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-xl bg-black/40 border border-zinc-700 px-4 h-11 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-zinc-500"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm text-zinc-300">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl bg-black/40 border border-zinc-700 px-4 h-11 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-zinc-500"
                required
              />
            </div>

            {error && <p className="text-red-400 text-sm whitespace-pre-wrap">{error}</p>}
            <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
              {loading ? "Creating..." : "Create Account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm section-subtitle">
            Already have an account?{" "}
            <Link href="/login" className="text-emerald-400 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
