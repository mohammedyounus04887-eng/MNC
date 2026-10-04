"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const logout = async () => {
    setError("");
    setBusy(true);
    try {
      // Server first: it needs the cookie to know whose session to end, and it
      // revokes on the Auth backend so a copy of this cookie is dead too.
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("logout failed");

      // Then this browser's own Firebase credentials. The cookie is not the only
      // key: the client SDK keeps a refresh token in browser storage, and
      // RealtimeProspects reads prospects straight from Firestore with it.
      await signOut(firebaseAuth());
    } catch {
      // Never send them to /login while they are in fact still logged in — that
      // is how someone walks away from a shared phone believing they are out.
      setError("Could not log out. Check your network and try again.");
      setBusy(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={logout}
        disabled={busy}
        className="h-12 rounded-xl border border-error font-semibold text-heat disabled:opacity-50"
      >
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}
      {/* Honest about what revoking costs: it is every device, not just this one. */}
      <p className="text-center text-xs text-text-dim">
        Logs you out everywhere. You&apos;ll need your number and an OTP to come back.
      </p>
    </div>
  );
}
