"use client";
import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  asChild?: boolean;
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center whitespace-nowrap rounded-full px-5 h-11 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-emerald-500 text-black hover:bg-emerald-400",
    secondary: "bg-transparent text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10",
    ghost: "bg-transparent text-white hover:bg-white/10",
  } as const;
  function cn(...args: Array<string | false | undefined>) {
    return args.filter(Boolean).join(" ");
  }
  return <button className={cn(base, variants[variant], className)} {...props} />;
}
