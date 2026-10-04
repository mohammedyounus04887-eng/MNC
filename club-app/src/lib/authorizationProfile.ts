import { Timestamp } from 'firebase/firestore';
import type { User } from '@/types/firestore';

export function verifiedClubRole(
    uid: string, expectedClubId: string, claims: Record<string, unknown>, grant: Record<string, unknown> | null,
): 'owner' | 'admin' | 'member' | null {
    if (!grant || grant.enabled !== true || grant.uid !== uid || grant.clubId !== expectedClubId ||
        claims.clubId !== expectedClubId || claims.role !== grant.role || claims.station === true || grant.station === true) return null;
    return grant.role === 'owner' || grant.role === 'admin' || grant.role === 'member' ? grant.role : null;
}

/** Presentation defaults never provision an account or grant a database role. */
export function profileDefaults(uid: string, clubId: string, role: User['role']): User {
    const epoch = Timestamp.fromMillis(0);
    return {
        id: uid, clubId, role, name: '', phone: '', email: '', photo: '',
        parentUserId: null, treePath: '', status: 'active', dob: null,
        anniversary: null, qrCode: '', isClubOwner: role === 'clubOwner',
        ownedClubId: role === 'clubOwner' ? clubId : null,
        originalClubId: clubId, referredBy: null, createdAt: epoch, updatedAt: epoch,
    };
}
