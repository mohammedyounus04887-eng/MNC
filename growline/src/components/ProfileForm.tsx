"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToAvatarDataUrl } from "@/lib/image-client";
import { Avatar } from "./Avatar";

type SignupProps = {
  mode: "signup";
  idToken: string;
  initialReferral?: string;
  /**
   * Collect the coach's mobile number here (D82). A phone-OTP signup arrives with
   * the number already verified inside the token, so the server ignores this
   * field; an email signup has no number at all without it — and reports,
   * WhatsApp links and the portfolio all print one.
   */
  askPhone?: boolean;
};
type EditProps = {
  mode: "edit";
  initialName: string;
  initialCity: string;
  initialPhotoUrl: string | null;
  onDone: () => void;
};
type Props = SignupProps | EditProps;

const inputCls =
  "h-12 w-full rounded-xl border border-hairline bg-elevated px-4 text-base outline-none focus:border-gold focus:ring-2 focus:ring-gold/30";

export default function ProfileForm(props: Props) {
  const router = useRouter();
  const isSignup = props.mode === "signup";
  const [name, setName] = useState(isSignup ? "" : props.initialName);
  const [city, setCity] = useState(isSignup ? "" : props.initialCity);
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    isSignup ? null : props.initialPhotoUrl
  );
  const [referral, setReferral] = useState(
    isSignup ? (props.initialReferral ?? "") : ""
  );
  const askPhone = isSignup && props.askPhone === true;
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhotoUrl(await fileToAvatarDataUrl(file));
    } catch {
      setError("Could not read that photo. Try another one.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = isSignup
        ? await fetch("/api/auth/complete-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idToken: props.idToken,
              name,
              city,
              photoUrl: photoUrl ?? undefined,
              referralCode: referral,
              ...(askPhone ? { phone } : {}),
            }),
          })
        : await fetch("/api/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, city, photoUrl: photoUrl ?? "" }),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      if (isSignup) {
        router.replace("/");
        router.refresh();
      } else {
        props.onDone();
        router.refresh();
      }
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-4 self-start rounded-xl"
      >
        <Avatar name={name || "?"} photoUrl={photoUrl} size={64} />
        <span className="font-medium text-gold-ink">
          {photoUrl ? "Change photo" : "Add photo (optional)"}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickPhoto(e.target.files?.[0])}
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Your name</span>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Priya Kumar"
          autoFocus={isSignup}
          maxLength={60}
          required
        />
      </label>

      {askPhone && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your mobile number</span>
          <div className="flex items-center gap-2">
            <span className="flex h-12 items-center rounded-xl bg-surface px-4 font-semibold">
              +91
            </span>
            <input
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              required
            />
          </div>
          <span className="text-xs text-text-dim">
            Shown on the reports you send, so people can reach you.
          </span>
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">City</span>
        <input
          className={inputCls}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="e.g. Mysuru"
          maxLength={60}
          required
        />
      </label>

      {isSignup && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Referral code <span className="font-normal text-text-dim">(from your coach, optional)</span>
          </span>
          <input
            className={`${inputCls} uppercase tracking-widest`}
            value={referral}
            onChange={(e) => setReferral(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect="off"
          />
        </label>
      )}

      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy || (askPhone && phone.length !== 10)}
        className="h-12 neopop metal-gold font-semibold text-on-gold disabled:opacity-50"
      >
        {busy ? "Saving…" : isSignup ? "Start my Growline" : "Save changes"}
      </button>
      {!isSignup && (
        <button
          type="button"
          onClick={props.onDone}
          className="h-12 rounded-xl border border-hairline font-medium"
        >
          Cancel
        </button>
      )}
    </form>
  );
}
