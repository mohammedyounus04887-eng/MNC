"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";
import {
  HomeIcon,
  LogIcon,
  ProspectsIcon,
  SettingsIcon,
  TeamIcon,
  ThreadsIcon,
} from "./icons";

/**
 * Labels arrive as a PROP, translated by the server layout.
 *
 * This is a client component, so it cannot read the locale cookie itself — and it
 * should not want to. Looking a dictionary up here would ship all five languages to
 * every browser to render five words. The server already knows which one to use.
 */
export type NavLabels = Record<
  "home" | "prospects" | "log" | "team" | "threads" | "settings",
  string
>;

const TABS = [
  { href: "/", key: "home", Icon: HomeIcon },
  { href: "/prospects", key: "prospects", Icon: ProspectsIcon },
  { href: "/log", key: "log", Icon: LogIcon },
  { href: "/team", key: "team", Icon: TeamIcon },
  { href: "/threads", key: "threads", Icon: ThreadsIcon },
] as const;

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-xl font-bold tracking-tight text-text ${className}`}>
      Grow<span className="text-gold-ink">line</span>
    </span>
  );
}

export default function AppNav({
  userName,
  userPhotoUrl,
  labels,
}: {
  userName: string;
  userPhotoUrl: string | null;
  labels: NavLabels;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between bg-elevated px-4 md:hidden">
        <Link href="/" className="flex h-12 items-center">
          <Wordmark />
        </Link>
        <Link
          href="/settings"
          aria-label={labels.settings}
          className="flex h-12 w-12 items-center justify-center rounded-full text-text-dim"
        >
          <SettingsIcon className="h-6 w-6" />
        </Link>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid h-16 grid-cols-5 border-t border-hairline bg-elevated pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map(({ href, key, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 ${
                active ? "text-text" : "text-text/45"
              }`}
            >
              <Icon className={`h-6 w-6 ${active ? "text-gold-ink" : ""}`} />
              {/* A Kannada or Tamil label runs longer than the English one, and five of
                  them share a 360px row — so it wraps to a second line rather than
                  overflowing or being clipped. */}
              <span
                className={`px-0.5 text-center text-[11px] leading-tight ${
                  active ? "font-semibold" : ""
                }`}
              >
                {labels[key]}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Desktop side rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-elevated p-4 text-text md:flex">
        <Link href="/" className="flex h-12 items-center px-2">
          <Wordmark className="text-2xl" />
        </Link>
        <nav className="mt-6 flex flex-col gap-1">
          {TABS.map(({ href, key, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 ${
                  active
                    ? "bg-elevated/10 font-semibold text-gold-ink"
                    : "text-text-dim hover:bg-elevated/5 hover:text-text"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {labels[key]}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <Link
            href="/settings"
            className={`flex h-12 items-center gap-3 rounded-xl px-3 ${
              isActive("/settings")
                ? "bg-elevated/10 font-semibold text-gold-ink"
                : "text-text-dim hover:bg-elevated/5 hover:text-text"
            }`}
          >
            <SettingsIcon className="h-5 w-5 shrink-0" />
            {labels.settings}
          </Link>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2">
            <Avatar name={userName} photoUrl={userPhotoUrl} size={32} />
            <span className="truncate text-sm text-text-dim">{userName}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
