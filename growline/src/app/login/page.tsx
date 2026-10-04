import { Suspense } from "react";
import Link from "next/link";
import { isDemoMode } from "@/lib/demo";
import LoginFlow from "./LoginFlow";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginFlow />
      {/*
        The way into the demo without typing a URL from memory — which matters, because
        the moment this exists for is somebody asking to see the app right now.

        Rendered only when DEMO_MODE is set, so the production login screen is untouched.
      */}
      {isDemoMode() && (
        <div className="mx-auto w-full max-w-md px-4 pb-8">
          <Link
            href="/demo"
            data-testid="demo-entry"
            className="flex min-h-12 items-center justify-center rounded-xl border border-info/40 px-4 py-3 text-sm font-medium text-info"
          >
            Open the demo — no OTP
          </Link>
        </div>
      )}
    </Suspense>
  );
}
