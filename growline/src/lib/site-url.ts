import { headers } from "next/headers";

/**
 * The app's public origin.
 *
 * Prefers NEXT_PUBLIC_SITE_URL, because the Host header is attacker-controlled and
 * because relative Open Graph URLs need an absolute base that is correct off
 * Vercel — without one they resolve to localhost, and a forwarded snapshot link
 * renders in WhatsApp with no preview card at all.
 *
 * Falls back to the request's host so local development needs no configuration.
 */
export function configuredSiteUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export async function siteUrl(): Promise<string> {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
