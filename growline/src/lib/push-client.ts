/**
 * Browser side of follow-up reminders. Kept separate from the server push helper so
 * the VAPID private key can never be pulled into a client bundle by accident.
 */

export type PushState =
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

/**
 * VAPID keys arrive as base64url and must be handed to the browser as bytes.
 * Backed by an explicitly allocated ArrayBuffer so the result satisfies
 * BufferSource — Uint8Array.from widens to ArrayBufferLike, which does not.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const publicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!publicKey()) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export type EnableResult = { ok: true } | { ok: false; state: PushState; error?: string };

export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return { ok: false, state: "unsupported" };
  const key = publicKey();
  if (!key) return { ok: false, state: "unconfigured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, state: permission === "denied" ? "denied" : "off" };
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    // The worker registers in production only, so reminders cannot be switched on
    // from a dev build. Say so rather than failing silently.
    return {
      ok: false,
      state: "unsupported",
      error: "Reminders need the installed app or a production build.",
    };
  }

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      // So the morning reminder lands in the coach's morning, not the server's.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, state: "off", error: data.error };
  }
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const endpoint = sub?.endpoint;
  // Unsubscribe locally first so the toggle reflects reality even if the network
  // call fails, then tell the server to forget the row.
  await sub?.unsubscribe().catch(() => {});
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}
