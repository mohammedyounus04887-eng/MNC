import { describe, it, expect } from 'vitest';
import { verifiedClubRole } from './authorizationProfile';

const uid = 'verified-owner-uid';
const claims = { clubId: 'club-one', role: 'owner', station: false };
const grant = { uid, clubId: 'club-one', role: 'owner', station: false, enabled: true };
describe('verified profile authorization', () => {
    it('resolves assigned owner/admin without a synthetic owner ID or email match', () => {
        expect(verifiedClubRole(uid, 'club-one', claims, grant)).toBe('owner');
        expect(verifiedClubRole(uid, 'club-one', { ...claims, role: 'admin' }, { ...grant, role: 'admin' })).toBe('admin');
    });
    it('rejects missing, disabled, wrong UID, wrong Club, wrong role and station grants', () => {
        for (const invalid of [null, { ...grant, enabled: false }, { ...grant, uid: 'other' }, { ...grant, clubId: 'club-two' }, { ...grant, role: 'member' }, { ...grant, station: true }]) {
            expect(verifiedClubRole(uid, 'club-one', claims, invalid)).toBeNull();
        }
        expect(verifiedClubRole(uid, 'club-two', claims, grant)).toBeNull();
        expect(verifiedClubRole(uid, 'club-one', { ...claims, station: true }, grant)).toBeNull();
        expect(verifiedClubRole(uid, 'club-one', { email: 'same@example.test' }, grant)).toBeNull();
    });
});
