import { useState, useEffect } from 'react';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ReviewFormProps {
    clubId: string;
    member?: any;
    onClose: () => void;
}

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function ReviewForm({ clubId, member, onClose }: ReviewFormProps) {
    const [step, setStep] = useState<'form' | 'success'>('form');
    const [stars, setStars] = useState(0);
    const [hoverStar, setHoverStar] = useState(0);
    const [name, setName] = useState(member?.name || '');
    const [email, setEmail] = useState(member?.email || '');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [googleReviewUrl, setGoogleReviewUrl] = useState('');

    useEffect(() => {
        if (!clubId) return;
        getDoc(doc(db, 'clubs', clubId)).then(snap => {
            setGoogleReviewUrl(snap.data()?.googleReviewUrl || '');
        });
    }, [clubId]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }
        if (!email.trim() || !email.includes('@')) {
            setError('Please enter a valid email');
            return;
        }
        if (stars === 0) {
            setError('Please select a rating');
            return;
        }
        if (!description.trim()) {
            setError('Please write a description');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await addDoc(collection(db, 'clubs', clubId, 'reviews'), {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                description: description.trim(),
                stars,
                memberId: member?.id || null,
                memberPhone: member?.phone || null,
                status: 'pending',
                rewardAmount: 500,
                rewardCredited: false,
                submittedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            });
            try {
                await navigator.clipboard.writeText(description.trim());
            } catch {
                // Clipboard might fail on some browsers — continue anyway
            }
            setStep('success');
            setTimeout(() => {
                if (googleReviewUrl) {
                    // If it's a Google Maps URL, format it to open the review section
                    let reviewUrl = googleReviewUrl;
                    if (googleReviewUrl.includes('google.com/maps')) {
                        // Add the review action to the URL
                        // Remove any existing hash
                        reviewUrl = googleReviewUrl.split('#')[0];
                        // Add the action to write a review
                        reviewUrl += '#gid=0&action=add-review';
                    }
                    window.open(reviewUrl, '_blank');
                }
                onClose();
            }, 2500);
        } catch (err) {
            console.error(err);
            setError('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            fontFamily: 'Nunito, sans-serif',
        }}>
            <div style={{
                background: 'white',
                borderRadius: 24,
                padding: '36px 32px',
                width: '100%',
                maxWidth: 420,
                maxHeight: '90vh',
                overflowY: 'auto',
                position: 'relative',
            }}>
                {step === 'success' ? (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{
                            width: 100,
                            height: 100,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #2d9653, #1a6e3c)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 24px',
                            fontSize: 52,
                            animation: 'popIn 0.4s ease',
                        }}>
                            ✓
                        </div>
                        <h2 style={{ fontSize: 24, fontWeight: 900, color: '#1a3a2a', marginBottom: 8 }}>
                            Thank You! 🎉
                        </h2>
                        <p style={{ fontSize: 15, color: '#6b7280', lineHeight: 1.6, marginBottom: 16 }}>
                            Your review has been saved. We're opening Google Maps for you now.
                        </p>
                        <div style={{
                            background: '#fef9c3',
                            border: '2px solid #fde047',
                            borderRadius: 14,
                            padding: '16px 20px',
                            marginBottom: 16,
                        }}>
                            <div style={{ fontSize: 13, color: '#854d0e', fontWeight: 700, marginBottom: 4 }}>
                                📋 Your review is copied!
                            </div>
                            <div style={{ fontSize: 12, color: '#92400e' }}>
                                Just paste it in the Google review box and give your star rating.
                            </div>
                        </div>
                        <div style={{
                            background: '#f0fdf4',
                            border: '2px solid #86efac',
                            borderRadius: 14,
                            padding: '16px 20px',
                        }}>
                            <div style={{ fontSize: 22, fontWeight: 900, color: '#2d9653' }}>
                                🪙 500 MNC Coins
                            </div>
                            <div style={{ fontSize: 13, color: '#4b7a5a', marginTop: 4 }}>
                                Will be credited after admin verification
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            onClick={onClose}
                            style={{
                                position: 'absolute',
                                top: 16,
                                right: 16,
                                background: '#f3f4f6',
                                border: 'none',
                                borderRadius: '50%',
                                width: 36,
                                height: 36,
                                fontSize: 18,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >×</button>

                        <div style={{ textAlign: 'center', marginBottom: 28 }}>
                            <div style={{ fontSize: 40, marginBottom: 8 }}>⭐</div>
                            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>
                                Rate Your Experience
                            </h2>
                            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                                Your feedback helps us improve and earns you MNC coins!
                            </p>
                        </div>

                        {/* Star Rating */}
                        <div style={{ textAlign: 'center', marginBottom: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
                                {[1, 2, 3, 4, 5].map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setStars(s)}
                                        onMouseEnter={() => setHoverStar(s)}
                                        onMouseLeave={() => setHoverStar(0)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: 40,
                                            cursor: 'pointer',
                                            transition: 'transform 0.1s',
                                            transform: (hoverStar || stars) >= s ? 'scale(1.2)' : 'scale(1)',
                                            filter: (hoverStar || stars) >= s ? 'none' : 'grayscale(1)',
                                            opacity: (hoverStar || stars) >= s ? 1 : 0.4,
                                        }}
                                    >⭐</button>
                                ))}
                            </div>
                            {(hoverStar || stars) > 0 && (
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>
                                    {STAR_LABELS[hoverStar || stars]}
                                </div>
                            )}
                        </div>

                        {/* Name */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                                Your Name *
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Enter your name"
                                style={{
                                    width: '100%',
                                    padding: '12px 14px',
                                    border: '1.5px solid #e0f0e9',
                                    borderRadius: 10,
                                    fontSize: 14,
                                    fontFamily: 'Nunito, sans-serif',
                                    boxSizing: 'border-box',
                                    outline: 'none',
                                }}
                            />
                        </div>

                        {/* Email */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                                Email ID *
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                style={{
                                    width: '100%',
                                    padding: '12px 14px',
                                    border: '1.5px solid #e0f0e9',
                                    borderRadius: 10,
                                    fontSize: 14,
                                    fontFamily: 'Nunito, sans-serif',
                                    boxSizing: 'border-box',
                                    outline: 'none',
                                }}
                            />
                        </div>

                        {/* Description */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                                Your Experience *
                            </label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Tell us about your experience at the club..."
                                rows={4}
                                style={{
                                    width: '100%',
                                    padding: '12px 14px',
                                    border: '1.5px solid #e0f0e9',
                                    borderRadius: 10,
                                    fontSize: 14,
                                    fontFamily: 'Nunito, sans-serif',
                                    boxSizing: 'border-box',
                                    resize: 'vertical',
                                    outline: 'none',
                                }}
                            />
                            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                                This will be auto-copied so you can paste it on Google
                            </p>
                        </div>

                        {/* Reward hint */}
                        <div style={{
                            background: '#f0fdf4',
                            border: '1.5px solid #86efac',
                            borderRadius: 12,
                            padding: '12px 16px',
                            marginBottom: 20,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <span style={{ fontSize: 24 }}>🪙</span>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#2d9653' }}>
                                    Earn 500 MNC Coins!
                                </div>
                                <div style={{ fontSize: 11, color: '#4b7a5a' }}>
                                    Post on Google Maps and get rewarded after admin verification
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div style={{
                                background: '#fef2f2',
                                border: '1px solid #fca5a5',
                                borderRadius: 8,
                                padding: '10px 14px',
                                marginBottom: 16,
                                fontSize: 13,
                                color: '#ef4444',
                                fontWeight: 600,
                            }}>
                                ⚠️ {error}
                            </div>
                        )}

                        <button
                            onClick={handleSubmit}
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '16px',
                                background: loading ? '#9ca3af' : 'linear-gradient(135deg, #2d9653, #1a6e3c)',
                                color: 'white',
                                border: 'none',
                                borderRadius: 12,
                                fontSize: 16,
                                fontWeight: 800,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontFamily: 'Nunito, sans-serif',
                                boxShadow: loading ? 'none' : '0 4px 16px rgba(45,150,83,0.4)',
                            }}
                        >
                            {loading ? 'Submitting...' : '⭐ Submit & Open Google'}
                        </button>
                    </>
                )}
                <style>{`
                    @keyframes popIn {
                        0%   { transform: scale(0.5); opacity: 0; }
                        70%  { transform: scale(1.1); }
                        100% { transform: scale(1); opacity: 1; }
                    }
                `}</style>
            </div>
        </div>
    );
}
