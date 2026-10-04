import { collection, doc } from 'firebase/firestore';
import { db } from './firebase';

export const paths = {
    // Root
    superAdmin: (uid: string) => `superAdmins/${uid}`,

    // Club
    club: (clubId: string) => `clubs/${clubId}`,
    clubOwner: (clubId: string) => `clubs/${clubId}/owner/profile`,

    // Members
    members: (clubId: string) => `clubs/${clubId}/members`,
    member: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}`,

    // Member subcollections
    wallet: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}/wallet/data`,
    transactions: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}/transactions`,
    transaction: (clubId: string, memberId: string, txnId: string) => `clubs/${clubId}/members/${memberId}/transactions/${txnId}`,
    weighIns: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}/weighIns`,
    attendance: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}/attendance`,
    memberNotifications: (clubId: string, memberId: string) => `clubs/${clubId}/members/${memberId}/notifications`,

    // Club subcollections
    enquiries: (clubId: string) => `clubs/${clubId}/enquiries`,
    enquiry: (clubId: string, enquiryId: string) => `clubs/${clubId}/enquiries/${enquiryId}`,
    orders: (clubId: string) => `clubs/${clubId}/orders`,
    order: (clubId: string, orderId: string) => `clubs/${clubId}/orders/${orderId}`,
    menu: (clubId: string) => `clubs/${clubId}/menu`,
    menuItem: (clubId: string, itemId: string) => `clubs/${clubId}/menu/${itemId}`,
    announcements: (clubId: string) => `clubs/${clubId}/announcements`,
    volunteers: (clubId: string) => `clubs/${clubId}/volunteers`,
    feedback: (clubId: string) => `clubs/${clubId}/feedback`,
    topupRequests: (clubId: string) => `clubs/${clubId}/topupRequests`,
    topupRequest: (clubId: string, id: string) => `clubs/${clubId}/topupRequests/${id}`,
    memberships: (clubId: string) => `clubs/${clubId}/memberships`,
    membership: (clubId: string, planId: string) => `clubs/${clubId}/memberships/${planId}`,
    referrals: (clubId: string) => `clubs/${clubId}/referrals`,
    referral: (clubId: string, id: string) => `clubs/${clubId}/referrals/${id}`,
    inventory: (clubId: string) => `clubs/${clubId}/inventory`,
    usageStats: (clubId: string, docId: string) => `clubs/${clubId}/usageStats/${docId}`,

    // Landing page version history — each publish creates a doc here
    landingPages: (clubId: string) => `clubs/${clubId}/landingPages`,
    landingPage: (clubId: string, versionId: string) => `clubs/${clubId}/landingPages/${versionId}`,

    // Club-level transaction summary (aggregated across all members)
    clubTransactions: (clubId: string) => `clubs/${clubId}/transactions`,
    clubTransaction: (clubId: string, txId: string) => `clubs/${clubId}/transactions/${txId}`,
};

export const colRef = (path: string) => collection(db, path);
export const docRef = (path: string) => doc(db, path);
