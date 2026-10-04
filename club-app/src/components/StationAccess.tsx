import { useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth, db } from '@/lib/firebase';
import { useClubContext } from '@/lib/clubDetection';
import { stationSessionIsAuthorized, type StationRole } from '@/lib/stationAuthorization';

export default function StationAccess({ role, children }: { role: StationRole; children: ReactNode }) {
  const { club, loading: clubLoading } = useClubContext();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const clubId = club?.id;

  useEffect(() => {
    let generation = 0;
    let unsubscribeGrant: (() => void) | undefined;
    const unsubscribeAuth = onIdTokenChanged(auth, async user => {
      const current = ++generation;
      unsubscribeGrant?.();
      setAllowed(false);
      if (!user || user.isAnonymous || !clubId) { setLoading(false); return; }
      try {
        const result = await user.getIdTokenResult();
        if (generation !== current) return;
        unsubscribeGrant = onSnapshot(doc(db, 'clubs', clubId, 'authorizations', user.uid), snapshot => {
          if (generation !== current) return;
          setAllowed(stationSessionIsAuthorized(user.uid, user.isAnonymous, result.claims, snapshot.data(), clubId, role));
          setLoading(false);
        }, () => { setAllowed(false); setLoading(false); setError('Unable to verify this station. Reconnect or contact your club administrator.'); });
      } catch { if (generation === current) { setAllowed(false); setLoading(false); } }
    });
    return () => { ++generation; unsubscribeAuth(); unsubscribeGrant?.(); };
  }, [clubId, role]);

  async function enroll() {
    if (!clubId) return;
    setBusy(true); setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      const enrollStation = httpsCallable<{ clubId: string; role: StationRole }, { token: string }>(getFunctions(app), 'enrollStation');
      const response = await enrollStation({ clubId, role });
      await signInWithCustomToken(auth, response.data.token);
      setPassword(''); setEmail('');
    } catch {
      await signOut(auth);
      setPassword('');
      setError('Enrollment failed. Use an administrator account verified for this club by a platform admin.');
    } finally { setBusy(false); }
  }

  if (clubLoading || loading) return <div role="status" className="p-8 text-center">Verifying station access…</div>;
  if (allowed) return <>{children}</>;
  return <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
    <form className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow" onSubmit={event => { event.preventDefault(); void enroll(); }}>
      <h1 className="text-xl font-bold">Set up {role} station</h1>
      <p>{club?.name ?? 'Club not available'}</p>
      <p className="text-sm">An authorized club administrator must sign in once to enroll this device.</p>
      <label className="block">Administrator email<input className="block w-full border p-2" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="block">Password<input className="block w-full border p-2" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="rounded bg-emerald-700 px-4 py-2 text-white" disabled={busy || !clubId}>{busy ? 'Enrolling…' : 'Enroll this device'}</button>
    </form>
  </main>;
}
