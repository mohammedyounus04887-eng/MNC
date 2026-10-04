"use client";
import FederationPanel from "@/components/FederationPanel";
import { firebaseAuth } from "@/lib/firebase";
const establishSession = async (idToken: string) => {
  const response = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!response.ok) throw new Error("Could not establish this app's session.");
  window.location.assign("/");
};
export default function Federation() {
  return <FederationPanel app="growline" getAuth={firebaseAuth} endpoint="/api/integration/federation" onSignedIn={establishSession} />;
}
