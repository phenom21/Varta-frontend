"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

interface AuthCtx {
  token: string | null;
  setToken: (t: string | null) => void;
  isAuthed: boolean;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize from localStorage synchronously to avoid hydration flash
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("token");
    } catch {
      return null;
    }
  });

  // Keep tokens in sync across tabs/windows
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "token") {
        setTokenState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setToken(t: string | null) {
    setTokenState(t);
    if (typeof window === "undefined") return;
    if (t) localStorage.setItem("token", t);
    else localStorage.removeItem("token");
  }

  function logout() {
    setToken(null);
  }

  // Decode JWT exp (in seconds) without external libs
  function getTokenExp(t?: string | null): number | null {
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length !== 3) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(base64);
      const payload = JSON.parse(json);
      if (typeof payload.exp === "number") return payload.exp;
      return null;
    } catch {
      return null;
    }
  }

  // Auto-logout when token expires
  useEffect(() => {
    let timer: number | undefined;
    const exp = getTokenExp(token);
    if (exp) {
      const nowMs = Date.now();
      const expMs = exp * 1000;
      if (expMs <= nowMs) {
        // Already expired
        logout();
      } else {
        const delay = Math.min(expMs - nowMs, 2 ** 31 - 1); // cap to setTimeout max
        timer = window.setTimeout(() => logout(), delay);
      }
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [token]);

  const value = useMemo(() => ({ token, setToken, isAuthed: !!token, logout }), [token]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
