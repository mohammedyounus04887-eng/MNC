import { z } from 'zod';

export type StationRole = 'reception' | 'kitchen' | 'tv';
const grantSchema = z.object({ uid: z.string(), clubId: z.string(), role: z.enum(['reception', 'kitchen', 'tv']), enabled: z.literal(true), station: z.literal(true) });

export function stationSessionIsAuthorized(uid: string, anonymous: boolean, claims: Record<string, unknown>, grant: unknown, clubId: string, role: StationRole): boolean {
  const parsed = grantSchema.safeParse(grant);
  return !anonymous && parsed.success && parsed.data.uid === uid && parsed.data.clubId === clubId && parsed.data.role === role &&
    claims.clubId === clubId && claims.role === role && claims.station === true;
}
