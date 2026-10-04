import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { FederationService, type FederationRuntime } from "./federationService";

const federationKey = defineSecret("FEDERATION_SERVICE_KEY");
export const federation = onRequest({ secrets: [federationKey], cors: false, maxInstances: 5 }, async (request, response) => {
  response.set("Cache-Control", "no-store");
  const config: FederationRuntime = { app: "club", enabled: process.env.INTEGRATION_SSO_ENABLED === "true",
    clubProject: process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "", growlineProject: process.env.GROWLINE_PROJECT_ID ?? "",
    clubOrigin: process.env.FEDERATION_CLUB_ORIGIN ?? "", growlineOrigin: process.env.FEDERATION_GROWLINE_ORIGIN ?? "",
    peerUrl: process.env.FEDERATION_PEER_URL ?? "", keyId: process.env.FEDERATION_SERVICE_KEY_ID ?? "", secret: federationKey.value(), local: process.env.FUNCTIONS_EMULATOR === "true" };
  // CORS allows only the independently configured Club web origin, never the peer browser.
  if (request.get("origin") === config.clubOrigin && config.clubOrigin) {
    response.set("Access-Control-Allow-Origin", config.clubOrigin).set("Vary", "Origin");
    response.set("Access-Control-Allow-Headers", "Content-Type, Authorization").set("Access-Control-Allow-Methods", "POST");
  }
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "POST") { response.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
  if (JSON.stringify(request.body ?? {}).length > 16384) { response.status(413).json({ error: "REQUEST_TOO_LARGE" }); return; }
  try {
    const token = request.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    const service = new FederationService(admin.firestore(), admin.auth(), config);
    response.json(await service.handle(request.body, request.get("origin"), token));
  } catch (error) {
    const disabled = error instanceof Error && error.message === "FEDERATION_DISABLED";
    response.status(disabled ? 404 : 403).json({ error: disabled ? "FEDERATION_DISABLED" : "FEDERATION_DENIED" });
  }
});
