import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & { className?: string };

export function MicIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <rect x="8" y="3" width="8" height="12" rx="4" className="text-emerald-400" />
      <rect x="8" y="3" width="8" height="12" rx="4" fill="none" className="text-emerald-400" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" className="text-emerald-400" />
      <path d="M12 19v3" className="text-emerald-400" />
    </svg>
  );
}

export function WaveSyncIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <path d="M3 12c2.5 0 2.5-6 5-6s2.5 12 5 12 2.5-6 5-6 2.5 0 3 0" className="text-emerald-400" />
      <path d="M8 4l-2 2 2 2M16 16l2 2-2 2" className="text-emerald-400" />
    </svg>
  );
}

export function SparkIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" className="text-emerald-400" />
    </svg>
  );
}

export function BoltIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" className="text-emerald-400" />
    </svg>
  );
}

export function GlobeIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <circle cx="12" cy="12" r="9" className="text-emerald-400" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" className="text-emerald-400" />
    </svg>
  );
}

export function ShieldIcon({ className = "h-6 w-6", ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} {...props}>
      <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z" className="text-emerald-400" />
      <path d="M9 12l2 2 4-4" className="text-emerald-400" />
    </svg>
  );
}
