import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, getDoc, addDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useClubContext } from '@/lib/clubDetection';

export default function Reviews() {
    const { club } = useClubContext();
    const clubId = club?.id;
    const [reviews, setReviews] = useState<any[]>([]);
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);

    useEffect(() => {
        if (!clubId) return;
        return onSnapshot(
            query(collection(db, 'clubs', clubId, 'reviews'), orderBy('createdAt', 'desc')),
            snap => setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );
    }, [clubId]);

    const handleApprove = async (review: any) => {
        if (!clubId) return;
        setApprovingId(review.id);
        try {
            await updateDoc(doc(db, 'clubs', clubId, 'reviews', review.id), {
                status: 'approved',
                approvedAt: serverTimestamp(),
                rewardCredited: true,
            });
            if (review.memberId) {
                const walletRef = doc(db, 'clubs', clubId, 'members', review.memberId, 'wallet', 'data');
                const walletSnap = await getDoc(walletRef);
                const currentBalance = walletSnap.data()?.balance || 0;
                await updateDoc(walletRef, {
                    balance: currentBalance + 500,
                    updatedAt: serverTimestamp(),
                });
                await addDoc(collection(db, 'clubs', clubId, 'members', review.memberId, 'transactions'), {
                    type: 'credit',
                    amount: 500,
                    reason: 'Google Review Reward',
                    description: 'Reward for posting Google Maps review',
                    balanceAfter: currentBalance + 500,
                    createdAt: serverTimestamp(),
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setApprovingId(null);
        }
    };

    const handleReject = async (review: any) => {
        if (!clubId) return;
        setRejectingId(review.id);
        try {
            await updateDoc(doc(db, 'clubs', clubId, 'reviews', review.id), {
                status: 'rejected',
                rejectedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error(err);
        } finally {
            setRejectingId(null);
        }
    };

    const filtered = reviews.filter(r => filter === 'all' || r.status === filter);
    const pendingCount = reviews.filter(r => r.status === 'pending').length;
    const avgRating = reviews.length > 0
        ? (reviews.reduce((s, r) => s + (r.stars || 0), 0) / reviews.length).toFixed(1)
        : '—';

    return (
        <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto', fontFamily: 'Nunito, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>
                        ⭐ Reviews
                    </h1>
                    <p style={{ fontSize: 14, color: '#6b7280', margin: '4px 0 0' }}>
                        Verify and reward members for Google reviews
                    </p>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                {[
                    { label: 'Total Reviews', value: reviews.length, color: '#6366f1', bg: '#f5f3ff' },
                    { label: '⏳ Pending Approval', value: reviews.filter(r => r.status === 'pending').length, color: '#f59e0b', bg: '#fffbeb' },
                    { label: '✅ Approved', value: reviews.filter(r => r.status === 'approved').length, color: '#2d9653', bg: '#f0fdf4' },
                    { label: '❌ Rejected', value: reviews.filter(r => r.status === 'rejected').length, color: '#ef4444', bg: '#fef2f2' },
                    { label: '⭐ Avg Rating', value: reviews.length > 0 ? (reviews.filter(r => r.status !== 'rejected').reduce((s, r) => s + (r.stars || 0), 0) / reviews.filter(r => r.status !== 'rejected').length).toFixed(1) : '—', color: '#f59e0b', bg: '#fffbeb' },
                ].map(card => (
                    <div key={card.label} style={{ background: card.bg, borderRadius: 14, padding: '16px 20px', flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 12, color: card.color, fontWeight: 700, marginBottom: 4 }}>{card.label}</div>
                        <div style={{ fontSize: 28, fontWeight: 900, color: card.color, lineHeight: 1 }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Filter Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        style={{
                            padding: '8px 20px',
                            borderRadius: 100,
                            border: filter === f ? 'none' : '1.5px solid #e0f0e9',
                            background: filter === f ? '#2d9653' : 'white',
                            color: filter === f ? 'white' : '#6b7280',
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: 'pointer',
                            fontFamily: 'Nunito, sans-serif',
                            textTransform: 'capitalize',
                        }}
                    >
                        {f === 'pending'
                            ? `Pending ${pendingCount > 0 ? `(${pendingCount})` : ''}`
                            : f === 'rejected'
                            ? `Rejected (${reviews.filter(r => r.status === 'rejected').length})`
                            : f.charAt(0).toUpperCase() + f.slice(1)
                        }
                    </button>
                ))}
            </div>

            {/* Reviews List */}
            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
                    <div style={{ fontSize: 48 }}>⭐</div>
                    <p>No {filter === 'all' ? '' : filter} reviews yet</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {filtered.map(review => {
                        let borderColor = '#fde047';
                        let statusBgColor = '#fef9c3';
                        let statusTextColor = '#854d0e';
                        let statusLabel = '⏳ Pending';

                        if (review.status === 'approved') {
                            borderColor = '#86efac';
                            statusBgColor = '#d8f3dc';
                            statusTextColor = '#2d9653';
                            statusLabel = '✅ Approved';
                        } else if (review.status === 'rejected') {
                            borderColor = '#fca5a5';
                            statusBgColor = '#fee2e2';
                            statusTextColor = '#dc2626';
                            statusLabel = '❌ Rejected';
                        }

                        return (
                        <div key={review.id} style={{
                            background: 'white',
                            borderRadius: 16,
                            padding: '20px 24px',
                            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                            border: `2px solid ${borderColor}`,
                            opacity: review.status === 'rejected' ? 0.7 : 1,
                        }}>
                            {/* Top row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: '#1a3a2a', marginBottom: 2, textDecoration: review.status === 'rejected' ? 'line-through' : 'none' }}>
                                        {review.name}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                                        📧 {review.email}
                                    </div>
                                    <div style={{ fontSize: 18, letterSpacing: 2 }}>
                                        {'⭐'.repeat(review.stars || 0)}
                                        <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 6 }}>
                                            {review.stars}/5
                                        </span>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <span style={{
                                        background: statusBgColor,
                                        color: statusTextColor,
                                        padding: '4px 12px',
                                        borderRadius: 100,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        display: 'block',
                                        marginBottom: 4,
                                    }}>
                                        {statusLabel}
                                    </span>
                                    <div style={{ fontSize: 11, color: '#9ca3af' }}>
                                        {review.createdAt?.toDate?.()?.toLocaleDateString('en-IN') || ''}
                                    </div>
                                </div>
                            </div>

                            {/* Description */}
                            <div style={{
                                background: '#f8fafc',
                                borderRadius: 10,
                                padding: '12px 14px',
                                fontSize: 14,
                                color: '#374151',
                                lineHeight: 1.6,
                                marginBottom: 14,
                                fontStyle: 'italic',
                            }}>
                                "{review.description}"
                            </div>

                            {/* Actions */}
                            {review.status === 'pending' && (
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div style={{ fontSize: 12, color: '#6b7280', flex: 1, minWidth: 200 }}>
                                        🔍 Verify on Google Maps that {review.email} posted a review, then approve or reject.
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            onClick={() => handleReject(review)}
                                            disabled={rejectingId === review.id}
                                            style={{
                                                background: rejectingId === review.id ? '#9ca3af' : '#ef4444',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 10,
                                                padding: '10px 16px',
                                                fontSize: 13,
                                                fontWeight: 800,
                                                cursor: rejectingId === review.id ? 'not-allowed' : 'pointer',
                                                fontFamily: 'Nunito, sans-serif',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {rejectingId === review.id ? 'Rejecting...' : '❌ Reject'}
                                        </button>
                                        <button
                                            onClick={() => handleApprove(review)}
                                            disabled={approvingId === review.id}
                                            style={{
                                                background: approvingId === review.id ? '#9ca3af' : '#2d9653',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 10,
                                                padding: '10px 20px',
                                                fontSize: 13,
                                                fontWeight: 800,
                                                cursor: approvingId === review.id ? 'not-allowed' : 'pointer',
                                                fontFamily: 'Nunito, sans-serif',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {approvingId === review.id ? 'Crediting...' : '✅ Approve'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {review.status === 'approved' && review.rewardCredited && (
                                <div style={{ fontSize: 13, color: '#2d9653', fontWeight: 700 }}>
                                    🪙 500 MNC coins credited{review.memberId ? ' to wallet' : ' (non-member — add manually)'}
                                </div>
                            )}
                            {review.status === 'rejected' && (
                                <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 700 }}>
                                    🚫 This review has been rejected
                                </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
