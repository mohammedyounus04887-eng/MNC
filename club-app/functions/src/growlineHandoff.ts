import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { processHandoff, verifyServerAssertion, type DestinationRequest } from "./integrationHandoff";

const serviceKeys = defineSecret("CLUB_GROWLINE_SERVICE_KEYS");

function readKeys(value: string): Map<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.some(([key, secret]) => !key || typeof secret !== "string" || secret.length < 32)) return null;
    return new Map(entries as Array<[string, string]>);
  } catch {
    return null;
  }
}

/** Server-only destination. Disabled unless an operator explicitly enables local/staging traffic. */
export const growlineHandoff = onRequest(
  { secrets: [serviceKeys], cors: false, maxInstances: 5 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    if (process.env.INTEGRATION_HANDOFF_ENABLED !== "true") {
      response.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const audience = process.env.CLUB_INTEGRATION_AUDIENCE;
    const growlineProject = process.env.GROWLINE_PROJECT_ID;
    const clubProject = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
    const activeKeys = readKeys(serviceKeys.value());
    if (!audience || !growlineProject || !clubProject || !activeKeys) {
      response.status(503).json({ error: "INTEGRATION_CONFIGURATION_UNAVAILABLE" });
      return;
    }
    const verified = verifyServerAssertion(request.get("authorization") ?? null, {
      audience, growlineProject, clubProject, activeKeys, maxTokenAgeSeconds: 120,
    });
    if (!verified.ok) {
      response.status(401).json({ error: verified.code });
      return;
    }
    const result = await processHandoff(admin.firestore(), verified.caller, request.body as DestinationRequest, audience);
    const status = result.status === "REJECTED" ? 400
      : result.status === "MANUAL_REVIEW_REQUIRED" ? 409
      : result.status === "FAILED_FINAL" ? 422
      : 200;
    response.status(status).json(result);
  },
);
