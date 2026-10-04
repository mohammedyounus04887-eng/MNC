import { createHash, createHmac } from "node:crypto";
import { hashHandoffRequest, type HandoffRequest } from "./contract";

export type ServiceSigningConfig = {
  keyId: string;
  secret: string;
  audience: string;
  growlineProject: string;
  clubProject: string;
  lifetimeSeconds: number;
};

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Server-side only: callers must load the secret from the server secret manager. */
export function signHandoffAssertion(
  request: HandoffRequest,
  growlineAuthUid: string,
  config: ServiceSigningConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return signPayloadAssertion(request, growlineAuthUid, config, nowSeconds, hashHandoffRequest(request));
}

export function signPayloadAssertion(
  payloadValue: unknown,
  growlineAuthUid: string,
  config: ServiceSigningConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
  requestHash = createHash("sha256").update(JSON.stringify(payloadValue)).digest("hex"),
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(growlineAuthUid) || !config.keyId || config.secret.length < 32 || !config.audience || !config.growlineProject || !config.clubProject || config.lifetimeSeconds < 1 || config.lifetimeSeconds > 120) {
    throw new Error("INVALID_SERVICE_SIGNING_CONFIGURATION");
  }
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: "growline-service",
    aud: config.audience,
    growlineProject: config.growlineProject,
    clubProject: config.clubProject,
    kid: config.keyId,
    iat: nowSeconds,
    exp: nowSeconds + config.lifetimeSeconds,
    requestHash,
    growlineAuthUid,
  }));
  const signature = createHmac("sha256", config.secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
