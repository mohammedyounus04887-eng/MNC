/** Thin scheduler transport. Disabled until an operator opts this environment in. */
export async function callScheduledRoute(
  job: string,
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  request: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  if (env.GROWLINE_JOBS_ENABLED !== "true") return null;
  const secret = env.CRON_SECRET;
  let base: URL;
  try {
    base = new URL(env.SITE_URL ?? "");
    const local = env.FIRESTORE_EMULATOR_HOST && env.FIREBASE_AUTH_EMULATOR_HOST &&
      ["localhost", "127.0.0.1"].includes(base.hostname);
    if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
      base.username || base.password || base.search || base.hash || base.pathname !== "/" || !secret || secret.length < 32) {
      throw new Error("INVALID_JOB_CONFIGURATION");
    }
  } catch {
    console.error(JSON.stringify({ job, status: "configuration_unavailable" }));
    throw new Error("INVALID_JOB_CONFIGURATION");
  }
  try {
    const response = await request(new URL(path, base), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      console.error(JSON.stringify({ job, status: "http_failure", httpStatus: response.status }));
      throw new Error("JOB_HTTP_FAILURE");
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_JOB_RESPONSE");
    console.log(JSON.stringify({ job, status: "completed" }));
    return body as Record<string, unknown>;
  } catch {
    // Do not log response bodies, tokens, prospect data or provider errors.
    console.error(JSON.stringify({ job, status: "failed" }));
    throw new Error("SCHEDULED_JOB_FAILED");
  }
}
