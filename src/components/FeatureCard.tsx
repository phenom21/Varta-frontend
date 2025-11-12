import React from "react";

type Props = {
  title: string;
  description: string;
  icon?: React.ReactNode;
};

export default function FeatureCard({ title, description, icon }: Props) {
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-zinc-900/40 p-5 shadow-[0_10px_40px_-15px_rgba(16,185,129,0.2)]">
      <div className="mb-3 text-emerald-400">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-zinc-400">{description}</p>
    </div>
  );
}
