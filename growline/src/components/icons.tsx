type IconProps = { className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

export function ProspectsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20c.6-3.4 3.2-5.2 6.2-5.2s5.6 1.8 6.2 5.2" />
      <circle cx="17.2" cy="9.5" r="2.5" />
      <path d="M16.4 14.6c2.6.2 4.4 1.8 4.9 4.4" />
    </svg>
  );
}

export function LogIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12.5 2.5 2.5 4.8-5.3" />
    </svg>
  );
}

export function TeamIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="5.5" r="2.6" />
      <circle cx="5.5" cy="18" r="2.6" />
      <circle cx="18.5" cy="18" r="2.6" />
      <path d="M12 8.1v3.4M7 16.2l3.4-3.2M17 16.2l-3.4-3.2" />
    </svg>
  );
}

export function ThreadsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 11v2a1.5 1.5 0 0 0 1.5 1.5H6l4.8 4V7l-4.8 4H4.5A1.5 1.5 0 0 0 3 11Z" />
      <path d="M14.5 9.2a4 4 0 0 1 0 5.6M17.5 6.8a8 8 0 0 1 0 10.4" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.1A8.5 8.5 0 1 0 12 3.5Z" />
      <path d="M9 8.8c-.3 2.2 3.9 6.5 6.2 6.2l.6-1.5-2-1.2-.9.7c-.9-.4-1.6-1.1-2-2l.7-.9-1.2-2Z" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
