import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { configuredSiteUrl } from "@/lib/site-url";
import { LOCALE_TAGS } from "@/lib/i18n";
import { getLocale } from "@/lib/locale-server";
import ThemeScript from "@/components/ThemeScript";

/**
 * Nunito, for everything — Design System 3.2, chosen by the owner 2026-08-28.
 *
 * Rounded terminals and a wide, soft bowl: the friendliest widely-available face,
 * and the one that matches what this app is for. Its users are not accountants —
 * they are coaches whose day is conversations, and a geometric or technical face
 * makes a daily-log form feel like data entry. Nunito makes the same form feel
 * like a notebook.
 *
 * One family covering display and body, at 400 through 900. A single download
 * instead of a pair, which on a 3G connection outweighs the display/body pairing
 * the v2 spec argued for — and Nunito's 800/900 weights are distinct enough from
 * its 400 that the hierarchy survives without a second family.
 *
 * Both CSS variable names are kept and pointed here, so `font-display` and
 * `font-sans` resolve without touching a single component.
 */
const nunito = Nunito({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Growline",
  description: "The daily operating system for wellness coaches.",
  applicationName: "Growline",
  // Relative og:image URLs need an absolute base or they resolve to localhost off
  // Vercel, leaving forwarded snapshot links with no preview card.
  metadataBase: new URL(configuredSiteUrl() ?? "https://growline.in"),

  /**
   * iOS does not read the web app manifest. Everything Android takes from
   * `app/manifest.ts` — the standalone window, the name, the home-screen icon — Safari
   * takes from these tags instead, so leaving them out would make the app installable
   * on Android only. The target device is a mid-range Android (v1 §3), so this is the
   * minor platform; it is here because a coach's upline showing the app on an iPhone is
   * exactly the moment it must not look unfinished.
   */
  appleWebApp: {
    capable: true,
    title: "Growline",
    // The app paints its own near-black ground, so the status bar should sit on top of
    // it rather than in a separate strip.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  /**
   * The Android status bar, and the one theme-aware slot the platform gives us —
   * unlike the manifest's single `theme_color`, this accepts a media query, so
   * neither half of the audience gets a contrasting strip above their app.
   *
   * The values are the two `--bg` tokens from globals.css, and they have to stay
   * in step with them by hand: this is metadata, not CSS, so it cannot read a
   * custom property. If the ground changes, change it here too.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff9f2" },
    { media: "(prefers-color-scheme: dark)", color: "#17120e" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // `lang` is not decoration: screen readers pick a voice from it, and the browser
  // picks line-breaking and font fallback from it — which matters most for exactly the
  // scripts we just added.
  const locale = await getLocale();

  return (
    <html
      lang={LOCALE_TAGS[locale]}
      // Set by ThemeScript before paint; this is only the pre-hydration default.
      data-theme="light"
      className={`${nunito.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
