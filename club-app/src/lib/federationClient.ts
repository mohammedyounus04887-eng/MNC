import { auth, useFirebaseEmulators } from "./firebase";

export function clubFederationEndpoint() {
  return useFirebaseEmulators ? "http://127.0.0.1:5002/demo-club-security/us-central1/federation" :
    `https://us-central1-${auth.app.options.projectId}.cloudfunctions.net/federation`;
}
export async function propagateClubLogout() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  const response = await fetch(clubFederationEndpoint(), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ operation: "logout", payload: {} }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Signed out locally; cross-app logout could not be verified. Sign in freshly to retry.");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("propagated" in result) || result.propagated !== true) throw new Error("This Club session is invalidated; cross-app logout delivery is pending. Sign in freshly to retry delivery.");
}
