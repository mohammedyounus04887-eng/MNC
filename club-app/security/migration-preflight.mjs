/** Pure validation of an operator-supplied migration inventory. No SDK or writes. */
export function inspectMigrationInventory(clubs) {
  if (!Array.isArray(clubs)) throw new TypeError('Expected an array of club migration records');
  const issues = [];
  const seen = new Set();
  for (const club of clubs) {
    if (!club || typeof club.clubId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(club.clubId)) {
      issues.push({ clubId: null, code: 'INVALID_CLUB_ID' });
      continue;
    }
    if (seen.has(club.clubId)) issues.push({ clubId: club.clubId, code: 'DUPLICATE_CLUB' });
    seen.add(club.clubId);
    // Contact fields and PINs are deliberately never used as identity proof.
    if (typeof club.verifiedOwnerAuthUid !== 'string' || !club.verifiedOwnerAuthUid.trim() ||
        typeof club.ownerVerificationReference !== 'string' || !club.ownerVerificationReference.trim()) {
      issues.push({ clubId: club.clubId, code: 'VERIFIED_OWNER_MAPPING_REQUIRED' });
    }
    if (!Array.isArray(club.remainingPublicPinFields) || club.remainingPublicPinFields.length !== 0) {
      issues.push({ clubId: club.clubId, code: 'PIN_SANITIZATION_NOT_CONFIRMED' });
    }
    for (const role of ['reception', 'kitchen', 'tv']) {
      if (club.stationWorkflowChecks?.[role] !== 'passed') {
        issues.push({ clubId: club.clubId, code: 'STATION_WORKFLOW_UNVERIFIED', role });
      }
    }
  }
  if (clubs.length === 0) issues.push({ clubId: null, code: 'EMPTY_INVENTORY' });
  return { readyForReview: issues.length === 0, issues };
}
