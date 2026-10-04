import { auth, db, usingEmulators } from "@/lib/firebase-admin";
import { FederationService, type FederationRuntime } from "./federation-service";

export function growlineFederationService() {
  const config: FederationRuntime = { app: "growline", enabled: process.env.INTEGRATION_SSO_ENABLED === "true",
    clubProject: process.env.CLUB_FIREBASE_PROJECT_ID ?? "", growlineProject: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    clubOrigin: process.env.FEDERATION_CLUB_ORIGIN ?? "", growlineOrigin: process.env.FEDERATION_GROWLINE_ORIGIN ?? "",
    peerUrl: process.env.FEDERATION_PEER_URL ?? "", keyId: process.env.FEDERATION_SERVICE_KEY_ID ?? "", secret: process.env.FEDERATION_SERVICE_KEY ?? "", local: usingEmulators };
  return new FederationService(db, auth, config);
}
