import { growlineFederationService } from "@/lib/integration/federation-runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const raw = await request.text();
    if (raw.length > 16384) return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413, headers });
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    const result = await growlineFederationService().handle(JSON.parse(raw), request.headers.get("origin") ?? undefined, token);
    return Response.json(result, { headers });
  } catch (error) {
    const disabled = error instanceof Error && error.message === "FEDERATION_DISABLED";
    return Response.json({ error: disabled ? "FEDERATION_DISABLED" : "FEDERATION_DENIED" }, { status: disabled ? 404 : 403, headers });
  }
}
