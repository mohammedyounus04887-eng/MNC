export type Candidate = { clubId: string; clubMemberId: string; verifiedEvidence: string[]; activeLink: boolean };
export type MatchResult =
  | { outcome: "MATCHED"; clubMemberId: string }
  | { outcome: "NO_MATCH" }
  | { outcome: "MANUAL_REVIEW_REQUIRED"; reason: string };

export function matchVerifiedMember(clubId: string, candidates: Candidate[]): MatchResult {
  const inClub = candidates.filter((candidate) => candidate.clubId === clubId && candidate.activeLink);
  if (inClub.length === 0) return { outcome: "NO_MATCH" };
  const eligible = inClub.filter((candidate) => candidate.verifiedEvidence.length > 0);
  if (eligible.length > 1) return { outcome: "MANUAL_REVIEW_REQUIRED", reason: "ambiguous_verified_candidates" };
  if (eligible.length === 0) return { outcome: "MANUAL_REVIEW_REQUIRED", reason: "unverified_evidence" };
  return { outcome: "MATCHED", clubMemberId: eligible[0].clubMemberId };
}
