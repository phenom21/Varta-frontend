"use client";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type Toast = { id: number; title?: string; message: string; variant?: "success" | "error" | "info" };

interface ToastCtx {
  toasts: Toast[];
  notify: (msg: string, opts?: { title?: string; variant?: "success" | "error" | "info" }) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastCtx | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback((message: string, opts?: { title?: string; variant?: "success" | "error" | "info" }) => {
    const t: Toast = { id: Date.now() + Math.random(), message, title: opts?.title, variant: opts?.variant };
    setToasts((prev) => [...prev, t]);
    setTimeout(() => dismiss(t.id), 4000);
  }, [dismiss]);

  const value = useMemo(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "rounded-lg border px-4 py-3 shadow " +
              (t.variant === "success"
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-200"
                : t.variant === "error"
                ? "bg-red-600/20 border-red-500 text-red-200"
                : "bg-zinc-800 border-zinc-600 text-zinc-200")
            }
          >
            {t.title && <div className="font-semibold mb-0.5">{t.title}</div>}
            <div className="text-sm">{t.message}</div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used within ToastProvider");
  return v;
}
