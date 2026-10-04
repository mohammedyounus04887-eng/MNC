"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type ConfirmationResult,
  type UserCredential,
} from "firebase/auth";
import ProfileForm from "@/components/ProfileForm";
import { firebaseAuth, usingAuthEmulator } from "@/lib/firebase";

/**
 * Two ways in: email + password, and phone OTP.
 *
 * Email is the step a visitor lands on (D82). Not because it suits this audience
 * better — v1 §F1 wanted phone-first, and still does — but because production SMS
 * delivery is not switched on yet, and a default that errors for every real coach
 * is worse than a secondary path promoted to the front. The OTP flow is intact one
 * tap away, and putting phone back on top is a one-line change to INITIAL_STEP.
 *
 * The coach's phone number is still collected — at the profile step, as contact
 * data the reports and WhatsApp links need — it is just no longer the credential.
 */
type Step = "email" | "phone" | "otp" | "profile";
const INITIAL_STEP: Step = "email";

const inputCls =
  "h-14 w-full rounded-xl border border-hairline bg-elevated px-4 outline-none focus:border-gold focus:ring-2 focus:ring-gold/30";

export default function LoginFlow() {
  const router = useRouter();
  const refCode = useSearchParams().get("ref")?.toUpperCase() ?? "";

  const [step, setStep] = useState<Step>(INITIAL_STEP);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Sign-in and create-account are separate submit paths, chosen explicitly:
  // email-enumeration protection makes "no such user" indistinguishable from
  // "wrong password", so guessing the visitor's intent from the error is not possible.
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [idToken, setIdToken] = useState("");
  const [signedUpByEmail, setSignedUpByEmail] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Firebase holds the SMS session between "send code" and "check code".
  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  /**
   * Invisible reCAPTCHA, created once and reused. Firebase requires a verifier
   * for web phone auth — there is no way to opt out — but "invisible" means the
   * coach sees nothing unless Google decides the request looks automated.
   * The emulator needs no verifier at all.
   */
  const getVerifier = () => {
    if (!verifier.current) {
      verifier.current = new RecaptchaVerifier(firebaseAuth(), "recaptcha-container", {
        size: "invisible",
      });
    }
    return verifier.current;
  };

  /** Shared tail of every successful Firebase sign-in, whatever the method. */
  const establishSession = async (cred: UserCredential, viaEmail: boolean) => {
    const token = await cred.user.getIdToken();
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Try again.");
      return;
    }
    if (data.isNewUser) {
      // No session cookie yet — the token carries the verified identity through
      // profile setup, and the cookie is issued once the user document exists.
      setIdToken(token);
      setSignedUpByEmail(viaEmail);
      setStep("profile");
    } else {
      router.replace("/");
      router.refresh();
    }
  };

  const submitEmail = async () => {
    setError("");
    setNotice("");
    // Checked before any network call: a typo'd password on account creation is
    // otherwise only discovered at the NEXT sign-in, as a mystery lockout.
    if (creatingAccount && password !== confirm) {
      setError("The two passwords don't match. Type them again.");
      return;
    }
    setBusy(true);
    try {
      const auth = firebaseAuth();
      const cred = creatingAccount
        ? await createUserWithEmailAndPassword(auth, email.trim(), password)
        : await signInWithEmailAndPassword(auth, email.trim(), password);
      await establishSession(cred, true);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setError(
        code === "auth/email-already-in-use"
          ? "That email already has an account. Sign in instead."
          : code === "auth/invalid-email"
            ? "That email doesn't look right. Check and try again."
            : code === "auth/weak-password"
              ? "Please use a password of at least 6 characters."
              : code === "auth/too-many-requests"
                ? "Too many attempts. Try again in a little while."
                : code === "auth/invalid-credential" ||
                    code === "auth/wrong-password" ||
                    code === "auth/user-not-found"
                  ? creatingAccount
                    ? "Could not create the account. Check the details and try again."
                    : "Email or password is wrong — or the account doesn't exist yet. New here? Tap “create one”."
                  : code === "auth/operation-not-allowed"
                    ? "Email sign-in isn't switched on for this app yet."
                    : "Could not sign in. Check your network and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Type your email above first, then tap forgot password.");
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth(), email.trim());
      setNotice("Password reset email sent. Check your inbox.");
    } catch {
      // Deliberately the same message: whether the account exists is not
      // something this button should reveal.
      setNotice("Password reset email sent. Check your inbox.");
    }
  };

  const requestOtp = async () => {
    setError("");
    setBusy(true);
    try {
      confirmation.current = await signInWithPhoneNumber(
        firebaseAuth(),
        `+91${phone}`,
        getVerifier()
      );
      setCode("");
      setStep("otp");
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setError(
        code === "auth/too-many-requests"
          ? "Too many attempts from this number. Try again in a little while."
          : code === "auth/invalid-phone-number"
            ? "That number doesn't look right. Check and try again."
            : code === "auth/captcha-check-failed"
              ? "This site isn't authorised for OTP yet. Use email sign-in for now."
              : code === "auth/operation-not-allowed"
                ? "Phone OTP isn't switched on yet. Use email sign-in for now."
                : "Could not send the code — use email sign-in for now."
      );
      // A used verifier cannot be reused after a failure.
      verifier.current?.clear();
      verifier.current = null;
    } finally {
      setBusy(false);
    }
  };

  const verify = async (otp: string) => {
    setError("");
    setBusy(true);
    try {
      if (!confirmation.current) {
        setError("That code expired. Please request a new one.");
        setStep("phone");
        return;
      }
      const cred = await confirmation.current.confirm(otp);
      await establishSession(cred, false);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setError(
        code === "auth/invalid-verification-code"
          ? "That code isn't right. Check and try again."
          : code === "auth/code-expired"
            ? "That code expired. Please request a new one."
            : "Something went wrong. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  // 30-second rule: submit the moment the 6th digit lands, no button press.
  const onCodeChange = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length === 6 && !busy) void verify(next);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-4xl font-bold tracking-tight">
        Grow<span className="text-gold-ink">line</span>
      </h1>
      <p className="mt-2 text-text-dim">Your team, your day, your growth — one app.</p>

      {refCode && step !== "profile" && (
        <p className="mt-4 self-start rounded-full bg-elevated px-4 py-2 text-sm font-medium text-gold-ink">
          Joining with code {refCode}
        </p>
      )}

      <div className="mt-8">
        {step === "email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitEmail();
            }}
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Your email</span>
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Password</span>
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creatingAccount ? "new-password" : "current-password"}
                placeholder={creatingAccount ? "At least 6 characters" : "Your password"}
              />
            </label>
            {creatingAccount && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Confirm password</span>
                <input
                  className={inputCls}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="The same password again"
                />
              </label>
            )}
            {error && (
              <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
            )}
            {notice && (
              <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-text-dim">{notice}</p>
            )}
            <button
              type="submit"
              disabled={busy || !email.trim() || password.length < 6 || (creatingAccount && confirm.length < 6)}
              className="h-14 rounded-xl bg-gold text-lg font-semibold text-on-gold disabled:opacity-40"
            >
              {busy ? "One moment…" : creatingAccount ? "Create account" : "Sign in"}
            </button>
            <p className="text-center text-sm text-text-dim">
              {creatingAccount ? (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="font-medium text-gold-ink"
                    onClick={() => {
                      setCreatingAccount(false);
                      setError("");
                    }}
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New here?{" "}
                  <button
                    type="button"
                    className="font-medium text-gold-ink"
                    onClick={() => {
                      setCreatingAccount(true);
                      setError("");
                    }}
                  >
                    Create one
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="font-medium text-gold-ink"
                    onClick={() => void resetPassword()}
                  >
                    Forgot password?
                  </button>
                </>
              )}
            </p>
            <button
              type="button"
              className="h-12 rounded-xl border border-hairline text-sm font-medium"
              onClick={() => {
                setStep("phone");
                setError("");
                setNotice("");
              }}
            >
              Use phone OTP instead
            </button>
          </form>
        )}

        {step === "phone" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestOtp();
            }}
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Your mobile number</span>
              <div className="flex items-center gap-2">
                <span className="flex h-14 items-center rounded-xl bg-surface px-4 text-lg font-semibold">
                  +91
                </span>
                <input
                  className={`${inputCls} text-xl tracking-wider`}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  autoFocus
                />
              </div>
            </label>
            {error && (
              <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || phone.length !== 10}
              className="h-14 rounded-xl bg-gold text-lg font-semibold text-on-gold disabled:opacity-40"
            >
              {busy ? "Sending…" : "Get OTP"}
            </button>
            <button
              type="button"
              className="h-12 rounded-xl border border-hairline text-sm font-medium"
              onClick={() => {
                setStep("email");
                setError("");
              }}
            >
              Use email instead
            </button>
            <p className="text-center text-sm text-text-dim">
              New here? Enter your number — we&apos;ll set you up in a minute.
            </p>
          </form>
        )}

        {step === "otp" && (
          <div className="flex flex-col gap-4">
            <p>
              Enter the 6-digit code sent to{" "}
              <span className="font-semibold">+91 {phone.slice(0, 5)} {phone.slice(5)}</span>
            </p>
            {usingAuthEmulator && (
              <p className="rounded-xl border border-gold bg-elevated px-4 py-3 text-sm">
                Emulator — use the code configured for this test number.
              </p>
            )}
            <input
              className={`${inputCls} text-center text-3xl font-bold tracking-[0.4em]`}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              autoFocus
            />
            {error && (
              <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
            )}
            {busy && <p className="text-center text-sm text-text-dim">Checking…</p>}
            <div className="flex justify-between text-sm font-medium text-gold-ink">
              <button className="h-12 px-2" onClick={() => { setStep("phone"); setError(""); }}>
                Change number
              </button>
              <button className="h-12 px-2" onClick={() => void requestOtp()} disabled={busy}>
                Resend code
              </button>
            </div>
          </div>
        )}

        {step === "profile" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Welcome! Tell us about you</h2>
            <ProfileForm
              mode="signup"
              idToken={idToken}
              initialReferral={refCode}
              askPhone={signedUpByEmail}
            />
          </div>
        )}
      </div>

      {/* Firebase mounts the invisible reCAPTCHA here. Must exist before
          signInWithPhoneNumber runs, and must not be conditionally rendered. */}
      <div id="recaptcha-container" />
    </main>
  );
}
