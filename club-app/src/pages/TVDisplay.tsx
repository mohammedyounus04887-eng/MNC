// TV SETUP INSTRUCTIONS:
// 1. Connect Smart TV to club WiFi
// 2. Open TV browser
//    Samsung: Internet app
//    LG: Web Browser app
//    Sony: Internet Browser
// 3. Navigate to:
//    yourapp.com/tv?clubId=CLUB_ID
// 4. Enable fullscreen in browser
// 5. Leave running — never touch again
// clubId can be found in
// owner Settings page

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  collection, doc, onSnapshot, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useClubContext } from '@/lib/clubDetection';
import StationAccess from '@/components/StationAccess';


// Per-slide durations — queue stays much longer because it's the main
// "who's getting their shake next" slide that staff and members glance at.
type SlideKey =
  | 'specials'
  | 'queue'
  | 'recentlyServed'
  | 'announcements'
  | 'birthday'
  | 'earlyBird'
  | 'funFriday'
  | 'stats'
  | 'quote';

// Base durations. Queue is dynamic (scales with order count) — see currentDuration.
const SLIDE_DURATION_MS: Record<SlideKey, number> = {
  specials: 10000,
  queue: 30000,        // hero slide — who's getting the shake next, in one ranked view
  recentlyServed: 10000,
  announcements: 10000,
  birthday: 12000,
  earlyBird: 10000,
  funFriday: 10000,
  stats: 10000,
  quote: 10000,
};
const WELCOME_SPIN_MS = 2500;
const WELCOME_REVEAL_MS = 4500;
const WELCOME_DURATION_MS = WELCOME_SPIN_MS + WELCOME_REVEAL_MS;
const QUOTES = [
  'Your health is your greatest wealth.',
  'Every shake is a step towards a better you.',
  'Consistency is the key to transformation.',
  'Small steps every day lead to big results.',
  'Fuel your body. Transform your life.',
  "You didn't come this far to only come this far.",
  'Believe in yourself and your journey.',
  'Progress, not perfection.',
  "Your body can do it. It's your mind you need to convince.",
  "Health is not a destination. It's a way of life.",
  'Wake up. Work out. Look great.',
  "The only bad workout is the one that didn't happen.",
  'Strive for progress, not perfection.',
  "Take care of your body. It's the only place you have to live.",
  'Good things come to those who sweat.',
];

const todayStr = () => new Date().toISOString().slice(0, 10);

type Club = {
  name?: string;
  clubName?: string;
  logoUrl?: string;
  logo?: string;
};

type Special = {
  id: string;
  name?: string;
  itemName?: string;
  price?: number;
  photoUrl?: string;
  imageUrl?: string;
  image?: string;
  isActive?: boolean;
  date?: string;
  stockType?: string;
  remainingStock?: number;
};

type Member = {
  id: string;
  name?: string;
  fullName?: string;
  photoUrl?: string;
  photo?: string;
  btcProgress?: number;
  totalVisits?: number;
  lastVisit?: string;
};

type Announcement = {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  isActive?: boolean;
  createdAt?: { toDate?: () => Date } | null;
};

type CheckinData = {
  memberId?: string;
  memberCode?: string;
  memberName?: string;
  memberPhoto?: string;
  totalVisits?: number;
  orderedItems?: { name?: string; qty?: number }[];
  checkedInAt?: { toDate?: () => Date } | null;
  processedAt?: { toDate?: () => Date } | null;
};

type OrderItem = {
  itemName?: string;
  productName?: string;
  name?: string;
  qty?: number;
  quantity?: number;
};

type Order = {
  id: string;
  memberId?: string;
  memberName?: string;
  memberPhoto?: string;
  items?: OrderItem[];
  status?: string;
  date?: string;
  tokenNumber?: string;
  createdAt?: { toDate?: () => Date } | null;
  servedAt?: { toDate?: () => Date } | null;
};

type EarlyBirdPhoto = {
  photoUrl?: string;
  uploadedAt?: { toDate?: () => Date } | null;
  date?: string;
};

type FunFridayPhoto = {
  photoUrl?: string;
  uploadedAt?: { toDate?: () => Date } | null;
  validUntil?: string;
};

type BirthdayMember = {
  id: string;
  name?: string;
  photoUrl?: string | null;
};

type BirthdayDoc = {
  memberIds?: string[];
  members?: BirthdayMember[];
  updatedAt?: { toDate?: () => Date } | null;
};

export default function TVDisplayPage() {
  return <StationAccess role="tv"><TVDisplay /></StationAccess>;
}
function TVDisplay() {
  const [params] = useSearchParams();
  const { club: contextClub } = useClubContext();
  const clubId = contextClub?.id || params.get('clubId') || '';
  const authed = true;
  const [club, setClub] = useState<Club | null>(null);
  const [specials, setSpecials] = useState<Special[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ordersToday, setOrdersToday] = useState(0);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [recentlyServed, setRecentlyServed] = useState<Order[]>([]);
  const [checkinsToday, setCheckinsToday] = useState(0);
  const [earlyBirdPhoto, setEarlyBirdPhoto] = useState<EarlyBirdPhoto | null>(null);
  const [funFridayPhoto, setFunFridayPhoto] = useState<FunFridayPhoto | null>(null);
  const [birthdays, setBirthdays] = useState<BirthdayDoc | null>(null);
  const [now, setNow] = useState(new Date());
  const [slideIdx, setSlideIdx] = useState(0);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [welcome, setWelcome] = useState<CheckinData | null>(null);
  const [progress, setProgress] = useState(0);

  const firstCheckinRef = useRef<string | null>(null);
  const welcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Clock ──────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Club doc ───────────────────────────────────
  useEffect(() => {
    if (!clubId) return;
    const unsub = onSnapshot(doc(db, 'clubs', clubId), (snap) => {
      if (snap.exists()) setClub(snap.data() as Club);
    });
    return () => unsub();
  }, [clubId]);

  // ── Today's specials ───────────────────────────
  useEffect(() => {
    if (!clubId || !authed) return;
    const today = todayStr();
    const q = query(
      collection(db, 'clubs', clubId, 'todaysSpecial'),
      where('isActive', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      const items: Special[] = [];
      snap.forEach((d) => {
        const data = d.data() as Special;
        if (!data.date || data.date === today) {
          items.push({ ...data, id: d.id });
        }
      });
      setSpecials(items);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Members (for leaderboard + stats) ──────────
  useEffect(() => {
    if (!clubId || !authed) return;
    const unsub = onSnapshot(collection(db, 'clubs', clubId, 'members'), (snap) => {
      const ms: Member[] = [];
      snap.forEach((d) => ms.push({ id: d.id, ...(d.data() as Member) }));
      setMembers(ms);
      const today = todayStr();
      setCheckinsToday(ms.filter((m) => m.lastVisit === today).length);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Announcements ──────────────────────────────
  useEffect(() => {
    if (!clubId || !authed) return;
    const q = query(
      collection(db, 'clubs', clubId, 'announcements'),
      where('isActive', '==', true),
    );
    const unsub = onSnapshot(q, (snap) => {
      const items: Announcement[] = [];
      snap.forEach((d) => items.push({ id: d.id, ...(d.data() as Announcement) }));
      items.sort((a, b) => {
        const ad = a.createdAt?.toDate?.()?.getTime() ?? 0;
        const bd = b.createdAt?.toDate?.()?.getTime() ?? 0;
        return bd - ad;
      });
      setAnnouncements(items.slice(0, 3));
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Orders today (active queue + recently served + count) ──
  useEffect(() => {
    if (!clubId || !authed) return;
    const today = todayStr();
    const q = query(
      collection(db, 'clubs', clubId, 'orders'),
      where('date', '==', today),
    );
    const unsub = onSnapshot(q, (snap) => {
      const active: Order[] = [];
      const served: Order[] = [];
      snap.forEach((d) => {
        const data = d.data() as Order;
        const status = data.status || '';
        const order = { id: d.id, ...data };
        if (status === 'served' || status === 'completed') {
          served.push(order);
        }
        if (status === 'pending' || status === 'preparing') {
          active.push(order);
        }
      });
      // Active queue: oldest first (FIFO so the next person up is at index 0)
      active.sort((a, b) => {
        const at = a.createdAt?.toDate?.()?.getTime() ?? 0;
        const bt = b.createdAt?.toDate?.()?.getTime() ?? 0;
        return at - bt;
      });
      // Recently served: newest first, capped to 10 (latest celebration first)
      served.sort((a, b) => {
        const at = a.servedAt?.toDate?.()?.getTime()
          ?? a.createdAt?.toDate?.()?.getTime() ?? 0;
        const bt = b.servedAt?.toDate?.()?.getTime()
          ?? b.createdAt?.toDate?.()?.getTime() ?? 0;
        return bt - at;
      });
      setActiveOrders(active);
      setRecentlyServed(served.slice(0, 10));
      setOrdersToday(served.length);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Early Bird photo (today only) ──────────────
  useEffect(() => {
    if (!clubId || !authed) return;
    const today = todayStr();
    const unsub = onSnapshot(doc(db, 'clubs', clubId, 'earlyBird', today), (snap) => {
      if (!snap.exists()) {
        setEarlyBirdPhoto(null);
        return;
      }
      const data = snap.data() as EarlyBirdPhoto;
      // Guard: only show if it actually matches today
      if (data.date && data.date !== today) {
        setEarlyBirdPhoto(null);
        return;
      }
      setEarlyBirdPhoto(data);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Fun Friday photo (valid for 7 days from upload) ──
  useEffect(() => {
    if (!clubId || !authed) return;
    const unsub = onSnapshot(doc(db, 'clubs', clubId, 'funFriday', 'current'), (snap) => {
      if (!snap.exists()) {
        setFunFridayPhoto(null);
        return;
      }
      const data = snap.data() as FunFridayPhoto;
      const today = todayStr();
      if (data.validUntil && data.validUntil < today) {
        setFunFridayPhoto(null);
        return;
      }
      setFunFridayPhoto(data);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Today's birthdays (owner-selected in Settings) ──
  useEffect(() => {
    if (!clubId || !authed) return;
    const today = todayStr();
    const unsub = onSnapshot(doc(db, 'clubs', clubId, 'tvBirthdays', today), (snap) => {
      if (!snap.exists()) {
        setBirthdays(null);
        return;
      }
      setBirthdays(snap.data() as BirthdayDoc);
    });
    return () => unsub();
  }, [clubId, authed]);

  // ── Real-time check-in interruption ────────────
  useEffect(() => {
    if (!clubId || !authed) return;
    const unsub = onSnapshot(doc(db, 'clubs', clubId, 'recentCheckin', 'latest'), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as CheckinData;
      const ts = data.checkedInAt?.toDate?.() || data.processedAt?.toDate?.();
      if (!ts) return;
      const age = Date.now() - ts.getTime();
      const key = ts.toISOString() + (data.memberId || '');
      // Skip the very first snapshot on page load
      if (firstCheckinRef.current === null) {
        firstCheckinRef.current = key;
        return;
      }
      if (key === firstCheckinRef.current) return;
      if (age > 10000) return;
      firstCheckinRef.current = key;
      setWelcome(data);
      if (welcomeTimeoutRef.current) clearTimeout(welcomeTimeoutRef.current);
      welcomeTimeoutRef.current = setTimeout(() => setWelcome(null), WELCOME_DURATION_MS);
    });
    return () => {
      unsub();
      if (welcomeTimeoutRef.current) clearTimeout(welcomeTimeoutRef.current);
    };
  }, [clubId, authed]);

  // ── Dynamic slide list ─────────────────────────
  // Slides are only included if they have data to show — empty announcements
  // don't burn 5 seconds of TV time. Order is fixed; queue is the hero slide.
  const slides = useMemo<SlideKey[]>(() => {
    const list: SlideKey[] = ['specials'];
    if (activeOrders.length > 0) list.push('queue');
    if (recentlyServed.length > 0) list.push('recentlyServed');
    if (announcements.length > 0) list.push('announcements');
    if (birthdays?.members && birthdays.members.length > 0) list.push('birthday');
    if (earlyBirdPhoto?.photoUrl) list.push('earlyBird');
    if (funFridayPhoto?.photoUrl) list.push('funFriday');
    list.push('stats');
    list.push('quote');
    return list;
  }, [activeOrders.length, recentlyServed.length, announcements.length, birthdays, earlyBirdPhoto, funFridayPhoto]);

  // Clamp the index when the slide list shrinks (e.g. last active order served)
  useEffect(() => {
    if (slideIdx >= slides.length) setSlideIdx(0);
  }, [slides.length, slideIdx]);

  const currentSlide: SlideKey = slides[Math.min(slideIdx, slides.length - 1)] || 'specials';
  // Queue stays longer when more orders are in line, so every member's name
  // gets at least a moment on screen. 30s base + 200ms/order, capped at 60s.
  const currentDuration = currentSlide === 'queue'
    ? Math.min(60000, 30000 + activeOrders.length * 200)
    : SLIDE_DURATION_MS[currentSlide];

  // ── Slide rotation + progress bar ──────────────
  useEffect(() => {
    if (welcome) return;
    if (slides.length === 0) return;
    const start = Date.now();
    const prog = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(100, (elapsed / currentDuration) * 100));
    }, 100);
    const next = setTimeout(() => {
      setSlideIdx((i) => {
        const ni = (i + 1) % slides.length;
        // Advance the quote pointer whenever we land on a quote slide so the
        // text rotates rather than repeating the same line every cycle.
        if (slides[ni] === 'quote') setQuoteIdx((q) => (q + 1) % QUOTES.length);
        return ni;
      });
      setProgress(0);
    }, currentDuration);
    return () => {
      clearInterval(prog);
      clearTimeout(next);
    };
  }, [slideIdx, welcome, slides, currentDuration]);

  const clubName = club?.clubName || club?.name || 'Magic Nutrition Club';
  const clubLogo = club?.logoUrl || club?.logo || '';

  if (!clubId) {
    return (
      <div style={styles.missingClub}>
        <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 16 }}>TV Display</div>
        <div style={{ fontSize: 24, opacity: 0.8 }}>Missing clubId in URL.</div>
        <div style={{ fontSize: 20, opacity: 0.6, marginTop: 12 }}>
          Use: /tv?clubId=YOUR_CLUB_ID
        </div>
      </div>
    );
  }

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div style={styles.root}>
      <style>{keyframes}</style>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {clubLogo ? (
            <img src={clubLogo} alt="logo" style={styles.logo} />
          ) : (
            <div style={styles.logoFallback}>{clubName.charAt(0)}</div>
          )}
          <div style={styles.clubName}>{clubName}</div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.time}>{timeStr}</div>
          <div style={styles.date}>{dateStr}</div>
        </div>
      </div>

      {/* Slide area */}
      <div style={styles.slideArea}>
        <div key={`${currentSlide}-${slideIdx}`} style={styles.slide}>
          {currentSlide === 'specials' && <SlideSpecials specials={specials} />}
          {currentSlide === 'queue' && <SlideShakeQueue orders={activeOrders} />}
          {currentSlide === 'recentlyServed' && <SlideRecentlyServed orders={recentlyServed} />}
          {currentSlide === 'announcements' && <SlideAnnouncements items={announcements} />}
          {currentSlide === 'birthday' && birthdays?.members && birthdays.members.length > 0 && (
            <SlideBirthday members={birthdays.members} />
          )}
          {currentSlide === 'earlyBird' && earlyBirdPhoto?.photoUrl && (
            <SlideEarlyBird photo={earlyBirdPhoto} />
          )}
          {currentSlide === 'funFriday' && funFridayPhoto?.photoUrl && (
            <SlideFunFriday photo={funFridayPhoto} />
          )}
          {currentSlide === 'stats' && (
            <SlideStats
              checkins={checkinsToday}
              members={members.length}
              orders={ordersToday}
              activeSpecials={specials.length}
            />
          )}
          {currentSlide === 'quote' && (
            <SlideQuote quote={QUOTES[quoteIdx]} author={clubName} />
          )}
        </div>
      </div>

      {/* Footer: dots + progress */}
      <div style={styles.footer}>
        <div style={styles.dots}>
          {slides.map((key, i) => (
            <div
              key={`${key}-${i}`}
              style={{
                ...styles.dot,
                ...(i === slideIdx ? styles.dotActive : {}),
              }}
            />
          ))}
        </div>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>
      </div>

      {/* Welcome interruption */}
      {welcome && <WelcomeOverlay data={welcome} />}
    </div>
  );
}

// ────────────────────────────────────────────────
// SLIDES
// ────────────────────────────────────────────────

function SlideSpecials({ specials }: { specials: Special[] }) {
  if (specials.length === 0) {
    return (
      <EmptyState emoji="🥤" title="No specials today" subtitle="Check back soon!" />
    );
  }
  return (
    <div style={styles.slideInner}>
      <div style={styles.slideTitle}>🍹 Today's Specials</div>
      <div style={styles.specialsGrid}>
        {specials.map((s) => {
          const img = s.photoUrl || s.imageUrl || s.image;
          const name = s.name || s.itemName || 'Special';
          const stock = s.stockType === 'limited' ? s.remainingStock ?? 0 : null;
          let badge: { text: string; bg: string } = { text: 'Available', bg: '#16a34a' };
          if (stock !== null) {
            if (stock <= 0) badge = { text: 'Sold Out', bg: '#dc2626' };
            else badge = { text: `${stock} left`, bg: '#f97316' };
          }
          return (
            <div key={s.id} style={styles.specialCard}>
              {img ? (
                <img src={img} alt={name} style={styles.specialImg} />
              ) : (
                <div style={styles.specialImgFallback}>🥤</div>
              )}
              <div style={styles.specialName}>{name}</div>
              <div style={styles.specialPrice}>₹{s.price ?? 0}</div>
              <div style={{ ...styles.specialBadge, background: badge.bg }}>
                {badge.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlideShakeQueue({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <EmptyState
        emoji="🥤"
        title="No shakes in the queue"
        subtitle="All caught up!"
      />
    );
  }

  const orderItemSummary = (o: Order): string => {
    const items = o.items || [];
    return items
      .map((i) => {
        const name = i.itemName || i.productName || i.name || 'Shake';
        const qty = i.qty || i.quantity || 1;
        return qty > 1 ? `${qty}× ${name}` : name;
      })
      .join(', ');
  };

  const n = orders.length;
  // Adaptive sizing — every member is always shown with their name. Tiers tuned
  // for a 16:9 TV; cards shrink as count grows but stay readable. Item summary
  // is hidden once cards drop below medium so the name doesn't get crowded.
  type Tier = {
    cols: number; photo: number; name: number;
    meta: number; gap: number; pad: number;
    rank: number; showSummary: boolean;
  };
  let tier: Tier;
  if (n === 1)        tier = { cols: 1,  photo: 360, name: 96, meta: 36, gap: 32, pad: 48, rank: 64, showSummary: true };
  else if (n <= 4)    tier = { cols: 2,  photo: 220, name: 56, meta: 28, gap: 24, pad: 32, rank: 44, showSummary: true };
  else if (n <= 9)    tier = { cols: 3,  photo: 160, name: 38, meta: 22, gap: 20, pad: 24, rank: 32, showSummary: true };
  else if (n <= 16)   tier = { cols: 4,  photo: 120, name: 30, meta: 18, gap: 16, pad: 20, rank: 26, showSummary: false };
  else if (n <= 30)   tier = { cols: 6,  photo: 88,  name: 22, meta: 14, gap: 12, pad: 14, rank: 22, showSummary: false };
  else if (n <= 60)   tier = { cols: 8,  photo: 64,  name: 18, meta: 12, gap: 10, pad: 12, rank: 18, showSummary: false };
  else                tier = { cols: 10, photo: 52,  name: 14, meta: 10, gap: 8,  pad: 10, rank: 16, showSummary: false };

  return (
    <div style={styles.slideInner}>
      <div style={styles.slideTitle}>
        🥤 Up Next — {n} {n === 1 ? 'order' : 'orders'} in line
      </div>
      <div
        style={{
          flex: 1, display: 'grid', minHeight: 0,
          gridTemplateColumns: `repeat(${tier.cols}, 1fr)`,
          gridAutoRows: '1fr',
          gap: tier.gap,
          overflow: 'auto',
          alignContent: 'flex-start',
        }}
      >
        {orders.map((o, idx) => {
          const name = o.memberName || 'Member';
          const photo = o.memberPhoto;
          const summary = orderItemSummary(o);
          const rank = idx + 1;
          const isHero = rank === 1;
          return (
            <div
              key={o.id}
              style={{
                position: 'relative',
                background: isHero
                  ? 'linear-gradient(135deg, #16a34a, #0a1f14)'
                  : 'linear-gradient(135deg, #1a3a2a, #0a1f14)',
                border: isHero
                  ? `2.5px solid ${ACCENT}`
                  : `1.5px solid rgba(134,239,172,0.3)`,
                borderRadius: 18,
                padding: tier.pad,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: Math.max(6, tier.gap / 2),
                textAlign: 'center',
                minHeight: 0, minWidth: 0,
                boxShadow: isHero ? '0 0 32px rgba(134,239,172,0.4)' : 'none',
                animation: isHero ? 'tv-queue-pulse 2.4s ease-in-out infinite' : undefined,
              }}
            >
              {/* Rank badge */}
              <div style={{
                position: 'absolute',
                top: -tier.rank / 4, left: -tier.rank / 4,
                width: tier.rank, height: tier.rank, borderRadius: '50%',
                background: isHero ? ACCENT : '#1a3a2a',
                color: isHero ? '#0a1f14' : ACCENT,
                border: `2px solid ${isHero ? '#0a1f14' : ACCENT}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: tier.rank * 0.45, fontWeight: 900,
                lineHeight: 1,
              }}>{rank}</div>
              {/* Photo */}
              {photo ? (
                <img src={photo} alt={name} style={{
                  width: tier.photo, height: tier.photo, borderRadius: '50%',
                  objectFit: 'cover',
                  border: `${Math.max(2, tier.rank / 8)}px solid ${ACCENT}`,
                  flexShrink: 0,
                }} />
              ) : (
                <div style={{
                  width: tier.photo, height: tier.photo, borderRadius: '50%',
                  background: '#fff', color: PRIMARY,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: tier.photo * 0.45, fontWeight: 900,
                  border: `${Math.max(2, tier.rank / 8)}px solid ${ACCENT}`,
                  flexShrink: 0,
                }}>{name.charAt(0).toUpperCase()}</div>
              )}
              {/* Name */}
              <div style={{
                fontSize: tier.name, fontWeight: 900, lineHeight: 1.1,
                width: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{name}</div>
              {/* Item summary (only on bigger cards) */}
              {tier.showSummary && summary && (
                <div style={{
                  fontSize: tier.meta, opacity: 0.85, fontWeight: 600,
                  width: '100%',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>🥤 {summary}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueueHero({ order, summary }: { order: Order; summary: string }) {
  const name = order.memberName || 'Member';
  const photo = order.memberPhoto;
  const token = order.tokenNumber;
  return (
    <div style={styles.queueHeroCard}>
      {photo ? (
        <img src={photo} alt={name} style={styles.queueHeroPhoto} />
      ) : (
        <div style={styles.queueHeroPhotoFallback}>{name.charAt(0)}</div>
      )}
      <div style={styles.queueHeroBadge}>NEXT UP</div>
      <div style={styles.queueHeroName}>{name}</div>
      {token && <div style={styles.queueHeroToken}>Token #{token}</div>}
      {summary && <div style={styles.queueHeroSummary}>🥤 {summary}</div>}
    </div>
  );
}

function QueueRow({
  rank, order, summary, size,
}: {
  rank: number;
  order: Order;
  summary: string;
  size: 'medium' | 'small';
}) {
  const name = order.memberName || 'Member';
  const photo = order.memberPhoto;
  const card = size === 'medium' ? styles.queueRowMedium : styles.queueRowSmall;
  const photoStyle = size === 'medium' ? styles.queueRowPhotoMedium : styles.queueRowPhotoSmall;
  const fallbackStyle = size === 'medium' ? styles.queueRowFallbackMedium : styles.queueRowFallbackSmall;
  const nameStyle = size === 'medium' ? styles.queueRowNameMedium : styles.queueRowNameSmall;
  const summaryStyle = size === 'medium' ? styles.queueRowSummaryMedium : styles.queueRowSummarySmall;
  const rankStyle = size === 'medium' ? styles.queueRowRankMedium : styles.queueRowRankSmall;

  return (
    <div style={card}>
      <div style={rankStyle}>#{rank}</div>
      {photo ? (
        <img src={photo} alt={name} style={photoStyle} />
      ) : (
        <div style={fallbackStyle}>{name.charAt(0)}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={nameStyle}>{name}</div>
        {summary && <div style={summaryStyle}>🥤 {summary}</div>}
      </div>
      {order.tokenNumber && (
        <div style={size === 'medium' ? styles.queueRowTokenMedium : styles.queueRowTokenSmall}>
          #{order.tokenNumber}
        </div>
      )}
    </div>
  );
}

function SlideAnnouncements({ items }: { items: Announcement[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        emoji="📢"
        title="No announcements right now"
        subtitle="Check back for updates!"
      />
    );
  }
  return (
    <div style={styles.slideInner}>
      <div style={styles.slideTitle}>📢 Club Announcements</div>
      <div style={styles.annList}>
        {items.map((a) => {
          const posted = a.createdAt?.toDate?.();
          return (
            <div key={a.id} style={styles.annCard}>
              <div style={styles.annTitle}>{a.title || 'Announcement'}</div>
              <div style={styles.annBody}>{a.message || a.body || ''}</div>
              {posted && (
                <div style={styles.annDate}>
                  {posted.toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlideStats({
  checkins, members, orders, activeSpecials,
}: { checkins: number; members: number; orders: number; activeSpecials: number }) {
  const cards = [
    { icon: '👋', label: "Today's Check-ins", value: checkins },
    { icon: '👥', label: 'Total Members', value: members },
    { icon: '🥤', label: 'Orders Today', value: orders },
    { icon: '⭐', label: 'Active Specials', value: activeSpecials },
  ];
  return (
    <div style={styles.slideInner}>
      <div style={styles.slideTitle}>📊 Today at the Club</div>
      <div style={styles.statsGrid}>
        {cards.map((c) => (
          <div key={c.label} style={styles.statCard}>
            <div style={styles.statIcon}>{c.icon}</div>
            <div style={styles.statValue}>{c.value}</div>
            <div style={styles.statLabel}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideQuote({ quote, author }: { quote: string; author: string }) {
  return (
    <div style={styles.quoteWrap}>
      <div style={styles.quoteMark}>"</div>
      <div style={styles.quoteText}>{quote}</div>
      <div style={styles.quoteAuthor}>— {author}</div>
    </div>
  );
}

function SlideRecentlyServed({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <EmptyState emoji="🥤" title="No shakes served yet today" subtitle="Hang tight — first one's coming up!" />;
  }

  const fmtRelative = (ts: { toDate?: () => Date } | null | undefined): string => {
    const d = ts?.toDate?.();
    if (!d) return '';
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    return `${diffHr}h ago`;
  };

  const itemSummary = (o: Order): string =>
    (o.items || [])
      .map((i) => {
        const name = i.itemName || i.productName || i.name || 'Shake';
        const qty = i.qty || i.quantity || 1;
        return qty > 1 ? `${qty}× ${name}` : name;
      })
      .join(', ');

  return (
    <div style={styles.slideInner}>
      <div style={styles.slideTitle}>✅ Just Drank — {orders.length} served today</div>
      <div style={styles.servedGrid}>
        {orders.map((o) => {
          const name = o.memberName || 'Member';
          const photo = o.memberPhoto;
          return (
            <div key={o.id} style={styles.servedCard}>
              {photo ? (
                <img src={photo} alt={name} style={styles.servedPhoto} />
              ) : (
                <div style={styles.servedPhotoFallback}>{name.charAt(0)}</div>
              )}
              <div style={styles.servedName}>{name}</div>
              <div style={styles.servedSummary}>🥤 {itemSummary(o) || 'Shake'}</div>
              <div style={styles.servedTime}>{fmtRelative(o.servedAt || o.createdAt)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlideEarlyBird({ photo }: { photo: EarlyBirdPhoto }) {
  return (
    <div style={styles.photoSlideWrap}>
      <img src={photo.photoUrl} alt="Early Bird" style={styles.photoSlideImg} />
      <div style={styles.photoSlideCaption}>
        <div style={styles.photoSlideEmoji}>🐦</div>
        <div style={styles.photoSlideCaptionText}>
          <div style={styles.photoSlideTitle}>Early Birds Today</div>
          <div style={styles.photoSlideSub}>First in, first to win the day</div>
        </div>
      </div>
    </div>
  );
}

function SlideFunFriday({ photo }: { photo: FunFridayPhoto }) {
  return (
    <div style={styles.photoSlideWrap}>
      <img src={photo.photoUrl} alt="Fun Friday" style={styles.photoSlideImg} />
      <div style={styles.photoSlideCaption}>
        <div style={styles.photoSlideEmoji}>🎉</div>
        <div style={styles.photoSlideCaptionText}>
          <div style={styles.photoSlideTitle}>Fun Friday Winners</div>
          <div style={styles.photoSlideSub}>Cheers to our champions!</div>
        </div>
      </div>
    </div>
  );
}

function SlideBirthday({ members }: { members: BirthdayMember[] }) {
  const n = members.length;
  // Adaptive sizing — fewer members = bigger cards.
  let cols: number, photo: number, name: number;
  if (n === 1)      { cols = 1; photo = 380; name = 88; }
  else if (n === 2) { cols = 2; photo = 280; name = 64; }
  else if (n <= 4)  { cols = 2; photo = 220; name = 52; }
  else if (n <= 9)  { cols = 3; photo = 170; name = 38; }
  else if (n <= 16) { cols = 4; photo = 130; name = 30; }
  else              { cols = 5; photo = 100; name = 24; }

  return (
    <div style={styles.slideInner}>
      <div style={{ ...styles.slideTitle, textAlign: 'center', marginBottom: 8 }}>
        🎂 Happy Birthday!
      </div>
      <div style={{
        textAlign: 'center', fontSize: 26, opacity: 0.85,
        fontWeight: 700, marginBottom: 24, color: '#fde68a',
      }}>
        Wishing our amazing {n === 1 ? 'member' : 'members'} a year full of wins 🎉
      </div>
      <div style={{
        flex: 1, display: 'grid', minHeight: 0,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: '1fr',
        gap: 24, overflow: 'auto',
        alignContent: n <= 4 ? 'center' : 'flex-start',
        justifyItems: 'stretch',
      }}>
        {members.map((m) => {
          const mName = m.name || 'Member';
          return (
            <div key={m.id} style={{
              background: 'linear-gradient(135deg, #be185d, #4c1d95)',
              border: '3px solid #fbbf24',
              borderRadius: 24, padding: 24,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 14, textAlign: 'center',
              minHeight: 0, minWidth: 0,
              boxShadow: '0 0 32px rgba(251,191,36,0.4)',
            }}>
              {m.photoUrl ? (
                <img src={m.photoUrl} alt={mName} style={{
                  width: photo, height: photo, borderRadius: '50%',
                  objectFit: 'cover', border: '4px solid #fbbf24',
                  flexShrink: 0,
                }} />
              ) : (
                <div style={{
                  width: photo, height: photo, borderRadius: '50%',
                  background: '#fff', color: '#be185d',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: photo * 0.45, fontWeight: 900,
                  border: '4px solid #fbbf24', flexShrink: 0,
                }}>{mName.charAt(0).toUpperCase()}</div>
              )}
              <div style={{
                fontSize: Math.max(28, photo * 0.18),
                animation: 'tv-shake 1.5s ease-in-out infinite',
                lineHeight: 1,
              }}>🎂</div>
              <div style={{
                fontSize: name, fontWeight: 900, lineHeight: 1.1,
                color: '#fff',
                width: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{mName}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  return (
    <div style={styles.emptyWrap}>
      <div style={{ fontSize: 120, animation: 'tv-shake 1.2s ease-in-out infinite' }}>{emoji}</div>
      <div style={styles.emptyTitle}>{title}</div>
      <div style={styles.emptySub}>{subtitle}</div>
    </div>
  );
}

function WelcomeOverlay({ data }: { data: CheckinData }) {
  const [phase, setPhase] = useState<'spin' | 'reveal'>('spin');
  useEffect(() => {
    const t = setTimeout(() => setPhase('reveal'), WELCOME_SPIN_MS);
    return () => clearTimeout(t);
  }, []);

  const fullName = data.memberName || 'Member';
  const firstName = fullName.split(' ')[0];
  const photo = data.memberPhoto;
  const memberCode = data.memberCode || '';
  const orderedItems = data.orderedItems || [];
  const orderSummary = orderedItems
    .map((i) => (i.qty && i.qty > 1 ? `${i.qty}× ${i.name}` : i.name))
    .filter(Boolean)
    .join(', ');

  if (phase === 'spin') {
    return (
      <div style={styles.welcomeRoot}>
        <div style={styles.mysteryWrap}>
          <div style={styles.mysteryLabel}>🎉 Someone Just Checked In!</div>
          <div style={styles.mysteryCard}>
            <div style={styles.mysteryInner}>?</div>
            <div style={styles.mysteryRing} />
          </div>
          <div style={styles.mysterySub}>Who could it be…</div>
        </div>
      </div>
    );
  }

  const confettiPieces = Array.from({ length: 40 });
  return (
    <div style={styles.welcomeRoot}>
      {confettiPieces.map((_, i) => (
        <div
          key={i}
          style={{
            ...styles.confetti,
            left: `${(i * 97) % 100}%`,
            background: ['#86efac', '#fde047', '#fca5a5', '#93c5fd', '#f0abfc'][i % 5],
            animationDelay: `${(i % 12) * 0.08}s`,
          }}
        />
      ))}
      <div style={styles.welcomeInner}>
        <div style={styles.welcomeTagline}>🎊 Welcome Back! 🎊</div>
        {photo ? (
          <img src={photo} alt={firstName} style={styles.welcomePhoto} />
        ) : (
          <div style={styles.welcomePhotoFallback}>{firstName.charAt(0)}</div>
        )}
        <div style={styles.welcomeTitle}>{firstName}!</div>
        {memberCode && (
          <div style={styles.welcomeCode}>ID: {memberCode}</div>
        )}
        {data.totalVisits != null && (
          <div style={styles.welcomeSub}>Visit #{data.totalVisits}</div>
        )}
        {orderSummary && (
          <div style={styles.welcomeOrder}>🥤 Ordered: {orderSummary}</div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// STYLES
// ────────────────────────────────────────────────

const PRIMARY = '#2d9653';
const ACCENT = '#86efac';
const CARD_BG = 'rgba(255,255,255,0.08)';
const CARD_BORDER = '1px solid rgba(255,255,255,0.15)';

const keyframes = `
@keyframes tv-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes tv-shake { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
@keyframes tv-pulse-glow { 0%,100% { box-shadow: 0 0 20px rgba(134,239,172,0.3); } 50% { box-shadow: 0 0 40px rgba(134,239,172,0.6); } }
@keyframes tv-confetti { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
@keyframes tv-spin-card { 0% { transform: rotateY(0deg) scale(1); } 50% { transform: rotateY(180deg) scale(1.05); } 100% { transform: rotateY(360deg) scale(1); } }
@keyframes tv-ring-spin { to { transform: rotate(360deg); } }
@keyframes tv-q-bounce { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
@keyframes tv-reveal-pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes tv-queue-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(134,239,172,0.4); } 50% { box-shadow: 0 0 0 8px rgba(134,239,172,0); } }
`;

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed', inset: 0,
    background: 'linear-gradient(135deg, #0a1f14, #1a3a2a)',
    color: '#fff',
    fontFamily: 'Nunito, sans-serif',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  missingClub: {
    position: 'fixed', inset: 0,
    background: 'linear-gradient(135deg, #0a1f14, #1a3a2a)',
    color: '#fff',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Nunito, sans-serif',
    textAlign: 'center', padding: 40,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 48px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 20 },
  logo: {
    width: 72, height: 72, borderRadius: '50%',
    objectFit: 'cover', border: `2px solid ${ACCENT}`,
  },
  logoFallback: {
    width: 72, height: 72, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 36, fontWeight: 900,
  },
  clubName: { fontSize: 42, fontWeight: 900, letterSpacing: 0.5 },
  headerRight: { textAlign: 'right' },
  time: { fontSize: 48, fontWeight: 900, color: ACCENT, lineHeight: 1 },
  date: { fontSize: 22, opacity: 0.8, marginTop: 6 },
  slideArea: {
    flex: 1, display: 'flex',
    padding: '32px 48px', overflow: 'hidden',
    minHeight: 0,
  },
  slide: {
    flex: 1, display: 'flex',
    animation: 'tv-fade-in 0.5s ease-in',
    minHeight: 0,
  },
  slideInner: {
    flex: 1, display: 'flex', flexDirection: 'column',
    minHeight: 0,
  },
  slideTitle: {
    fontSize: 56, fontWeight: 900, marginBottom: 28,
    color: ACCENT, letterSpacing: 0.5,
  },
  specialsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 24, flex: 1, overflow: 'auto',
  },
  specialCard: {
    background: 'linear-gradient(135deg, #1a3a2a, #0a1f14)',
    border: CARD_BORDER,
    borderRadius: 16, padding: 20,
    display: 'flex', flexDirection: 'column',
    gap: 12, color: '#fff',
    backdropFilter: 'blur(10px)',
  },
  specialImg: {
    width: '100%', aspectRatio: '1',
    objectFit: 'cover', borderRadius: 12,
    background: 'rgba(0,0,0,0.3)',
  },
  specialImgFallback: {
    width: '100%', aspectRatio: '1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 80, borderRadius: 12,
    background: 'rgba(0,0,0,0.3)',
  },
  specialName: { fontSize: 28, fontWeight: 900, lineHeight: 1.15 },
  specialPrice: { fontSize: 30, fontWeight: 900, color: ACCENT },
  specialBadge: {
    alignSelf: 'flex-start',
    padding: '6px 14px', borderRadius: 999,
    fontSize: 18, fontWeight: 800, color: '#fff',
  },
  leaderList: {
    display: 'flex', flexDirection: 'column',
    gap: 10, flex: 1, overflow: 'auto',
  },
  leaderRow: {
    display: 'grid',
    gridTemplateColumns: '80px 64px 1fr 2fr 80px',
    alignItems: 'center', gap: 16,
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 14, padding: '10px 20px',
    backdropFilter: 'blur(10px)',
  },
  leaderRank: { fontSize: 32, fontWeight: 900, textAlign: 'center' },
  leaderPhoto: {
    width: 56, height: 56, borderRadius: '50%',
    objectFit: 'cover',
  },
  leaderPhotoFallback: {
    width: 56, height: 56, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 26, fontWeight: 900,
  },
  leaderName: { fontSize: 26, fontWeight: 800 },
  leaderBarWrap: {
    height: 14, background: 'rgba(255,255,255,0.15)',
    borderRadius: 999, overflow: 'hidden',
  },
  leaderBar: {
    height: '100%', background: `linear-gradient(90deg, ${PRIMARY}, ${ACCENT})`,
  },
  leaderVal: { fontSize: 28, fontWeight: 900, textAlign: 'right' },
  annList: {
    display: 'flex', flexDirection: 'column', gap: 20,
    flex: 1, overflow: 'auto',
  },
  annCard: {
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 16, padding: 28,
    backdropFilter: 'blur(10px)',
  },
  annTitle: { fontSize: 38, fontWeight: 900, color: ACCENT, marginBottom: 12 },
  annBody: { fontSize: 26, lineHeight: 1.4 },
  annDate: { fontSize: 18, opacity: 0.6, marginTop: 14 },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 28, flex: 1,
  },
  statCard: {
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 20, padding: 32,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    textAlign: 'center',
    backdropFilter: 'blur(10px)',
    animation: 'tv-pulse-glow 3s ease-in-out infinite',
  },
  statIcon: { fontSize: 72, marginBottom: 12 },
  statValue: {
    fontSize: 120, fontWeight: 900,
    color: ACCENT, lineHeight: 1,
  },
  statLabel: { fontSize: 24, opacity: 0.8, marginTop: 16, fontWeight: 700 },
  quoteWrap: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', padding: 40, position: 'relative',
  },
  quoteMark: {
    fontSize: 200, color: ACCENT, opacity: 0.3,
    lineHeight: 0.5, marginBottom: 24,
  },
  quoteText: {
    fontSize: 72, fontStyle: 'italic', fontWeight: 700,
    maxWidth: '80%', lineHeight: 1.2,
  },
  quoteAuthor: { fontSize: 32, marginTop: 40, opacity: 0.7 },
  emptyWrap: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 20,
  },
  emptyTitle: { fontSize: 56, fontWeight: 900, color: ACCENT },
  emptySub: { fontSize: 28, opacity: 0.7 },
  footer: {
    padding: '16px 48px 20px',
    display: 'flex', flexDirection: 'column',
    gap: 10, alignItems: 'center',
  },
  dots: { display: 'flex', gap: 10 },
  dot: {
    width: 10, height: 10, borderRadius: '50%',
    background: 'rgba(255,255,255,0.3)',
    transition: 'all 0.3s',
  },
  dotActive: {
    width: 16, height: 16,
    background: ACCENT,
    boxShadow: `0 0 12px ${ACCENT}`,
  },
  progressTrack: {
    width: '100%', height: 3,
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 999, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: PRIMARY,
    transition: 'width 0.1s linear',
  },
  welcomeRoot: {
    position: 'fixed', inset: 0,
    background: 'linear-gradient(135deg, #16a34a, #0a1f14)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 50, animation: 'tv-fade-in 0.3s ease-in',
    overflow: 'hidden',
  },
  welcomeInner: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 24, zIndex: 1,
  },
  welcomePhoto: {
    width: 280, height: 280, borderRadius: '50%',
    objectFit: 'cover', border: '8px solid #fff',
    boxShadow: '0 0 60px rgba(134,239,172,0.8)',
    animation: 'tv-reveal-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  welcomePhotoFallback: {
    width: 280, height: 280, borderRadius: '50%',
    background: '#fff', color: PRIMARY,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 140, fontWeight: 900,
    boxShadow: '0 0 60px rgba(134,239,172,0.8)',
    animation: 'tv-reveal-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  welcomeTitle: {
    fontSize: 96, fontWeight: 900,
    textShadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  welcomeSub: { fontSize: 40, opacity: 0.9 },
  confetti: {
    position: 'absolute', top: 0,
    width: 12, height: 12, borderRadius: 3,
    animation: 'tv-confetti 2.5s linear infinite',
  },
  welcomeTagline: {
    fontSize: 40, fontWeight: 900, color: ACCENT,
    marginBottom: 8, letterSpacing: 1,
  },
  welcomeCode: {
    fontSize: 26, fontWeight: 800, opacity: 0.85,
    letterSpacing: 2, fontFamily: 'monospace',
    background: 'rgba(255,255,255,0.12)',
    padding: '6px 18px', borderRadius: 999,
  },
  welcomeOrder: {
    fontSize: 34, fontWeight: 800, marginTop: 16,
    background: 'rgba(255,255,255,0.15)',
    padding: '14px 28px', borderRadius: 18,
    border: '2px solid rgba(255,255,255,0.3)',
  },
  mysteryWrap: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 32, zIndex: 1,
  },
  mysteryLabel: {
    fontSize: 44, fontWeight: 900, color: ACCENT,
    letterSpacing: 1,
  },
  mysteryCard: {
    position: 'relative',
    width: 320, height: 320, borderRadius: '50%',
    background: 'linear-gradient(135deg, #1a3a2a, #0a1f14)',
    border: '6px solid #fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 80px rgba(134,239,172,0.6)',
    animation: 'tv-spin-card 1.25s ease-in-out infinite',
  },
  mysteryInner: {
    fontSize: 180, fontWeight: 900, color: ACCENT,
    animation: 'tv-q-bounce 0.8s ease-in-out infinite',
  },
  mysteryRing: {
    position: 'absolute', inset: -24,
    borderRadius: '50%',
    border: '4px dashed rgba(134,239,172,0.5)',
    animation: 'tv-ring-spin 3s linear infinite',
  },
  mysterySub: {
    fontSize: 28, opacity: 0.8, fontStyle: 'italic',
  },
  // ── Queue (new ranked-hierarchy design) ───────────────────────
  queueLayout: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1fr',
    gap: 32, flex: 1, minHeight: 0,
  },
  queueHeroWrap: {
    display: 'flex', minHeight: 0,
  },
  queueHeroCard: {
    flex: 1,
    background: `linear-gradient(135deg, ${PRIMARY}, #0a1f14)`,
    border: `2px solid ${ACCENT}`,
    borderRadius: 28, padding: 32,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 18, position: 'relative',
    boxShadow: '0 0 60px rgba(134,239,172,0.35)',
    animation: 'tv-queue-pulse 2s ease-in-out infinite',
  },
  queueHeroPhoto: {
    width: 260, height: 260, borderRadius: '50%',
    objectFit: 'cover', border: '6px solid #fff',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  queueHeroPhotoFallback: {
    width: 260, height: 260, borderRadius: '50%',
    background: '#fff', color: PRIMARY,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 130, fontWeight: 900,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  queueHeroBadge: {
    background: '#fde047', color: '#1a3a2a',
    padding: '8px 22px', borderRadius: 999,
    fontSize: 22, fontWeight: 900, letterSpacing: 2,
  },
  queueHeroName: {
    fontSize: 64, fontWeight: 900, textAlign: 'center',
    lineHeight: 1.1, textShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  queueHeroToken: {
    fontSize: 28, fontWeight: 800, opacity: 0.85,
    fontFamily: 'monospace', letterSpacing: 1,
  },
  queueHeroSummary: {
    fontSize: 26, fontWeight: 700, textAlign: 'center',
    background: 'rgba(255,255,255,0.15)',
    padding: '10px 22px', borderRadius: 14,
    maxWidth: '90%',
  },
  queueRightCol: {
    display: 'flex', flexDirection: 'column', gap: 14,
    minHeight: 0, overflow: 'hidden',
  },
  queueRowMedium: {
    display: 'flex', alignItems: 'center', gap: 18,
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 18, padding: '18px 22px',
    backdropFilter: 'blur(10px)',
  },
  queueRowSmall: {
    display: 'flex', alignItems: 'center', gap: 14,
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 14, padding: '12px 16px',
    backdropFilter: 'blur(10px)',
  },
  queueRowRankMedium: {
    fontSize: 32, fontWeight: 900, color: ACCENT,
    minWidth: 56, textAlign: 'center',
  },
  queueRowRankSmall: {
    fontSize: 22, fontWeight: 900, color: ACCENT,
    minWidth: 42, textAlign: 'center',
  },
  queueRowPhotoMedium: {
    width: 80, height: 80, borderRadius: '50%',
    objectFit: 'cover', border: `3px solid ${ACCENT}`,
  },
  queueRowFallbackMedium: {
    width: 80, height: 80, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 36, fontWeight: 900,
    border: `3px solid ${ACCENT}`,
  },
  queueRowPhotoSmall: {
    width: 56, height: 56, borderRadius: '50%',
    objectFit: 'cover', border: '2px solid rgba(255,255,255,0.4)',
  },
  queueRowFallbackSmall: {
    width: 56, height: 56, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, fontWeight: 900,
    border: '2px solid rgba(255,255,255,0.4)',
  },
  queueRowNameMedium: {
    fontSize: 28, fontWeight: 800, lineHeight: 1.1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  queueRowNameSmall: {
    fontSize: 20, fontWeight: 800, lineHeight: 1.1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  queueRowSummaryMedium: {
    fontSize: 18, opacity: 0.75, marginTop: 4,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  queueRowSummarySmall: {
    fontSize: 14, opacity: 0.7, marginTop: 2,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  queueRowTokenMedium: {
    fontSize: 18, fontWeight: 800, opacity: 0.7,
    fontFamily: 'monospace',
  },
  queueRowTokenSmall: {
    fontSize: 14, fontWeight: 800, opacity: 0.6,
    fontFamily: 'monospace',
  },
  queueChipRow: {
    display: 'flex', flexWrap: 'wrap', gap: 10,
    marginTop: 6,
  },
  queueChip: {
    position: 'relative',
    width: 56, height: 56, borderRadius: '50%',
    overflow: 'visible',
  },
  queueChipImg: {
    width: 56, height: 56, borderRadius: '50%',
    objectFit: 'cover', border: '2px solid rgba(255,255,255,0.4)',
  },
  queueChipFallback: {
    width: 56, height: 56, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, fontWeight: 900,
    border: '2px solid rgba(255,255,255,0.4)',
  },
  queueChipRank: {
    position: 'absolute', bottom: -4, right: -4,
    background: '#1a3a2a', color: ACCENT,
    fontSize: 11, fontWeight: 900,
    padding: '2px 6px', borderRadius: 999,
    border: '2px solid #1a3a2a',
  },

  // ── Recently Served slide ──────────────────────────────────────
  servedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 20, flex: 1, overflow: 'auto',
    alignContent: 'flex-start',
  },
  servedCard: {
    background: 'linear-gradient(135deg, #16a34a, #0a1f14)',
    border: `1.5px solid rgba(134,239,172,0.4)`,
    borderRadius: 18, padding: 18,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 10, textAlign: 'center',
    backdropFilter: 'blur(10px)',
  },
  servedPhoto: {
    width: 100, height: 100, borderRadius: '50%',
    objectFit: 'cover', border: `3px solid ${ACCENT}`,
  },
  servedPhotoFallback: {
    width: 100, height: 100, borderRadius: '50%',
    background: '#fff', color: PRIMARY,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 48, fontWeight: 900,
    border: `3px solid ${ACCENT}`,
  },
  servedName: {
    fontSize: 20, fontWeight: 900, lineHeight: 1.1,
    overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', width: '100%',
  },
  servedSummary: {
    fontSize: 14, opacity: 0.85, lineHeight: 1.2,
    overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', width: '100%',
  },
  servedTime: {
    fontSize: 12, opacity: 0.7, fontWeight: 700,
    marginTop: 2,
  },

  // ── Photo slides (Early Bird / Fun Friday) ─────────────────────
  // Full-bleed: image fills the slide, caption sits in a gradient strip at
  // the bottom so the photo feels truly fullscreen on a TV.
  photoSlideWrap: {
    flex: 1, position: 'relative', minHeight: 0,
    borderRadius: 24, overflow: 'hidden',
    border: `3px solid ${ACCENT}`,
    boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
  },
  photoSlideImgWrap: {
    // Deprecated wrapper from the previous side-by-side layout. Kept as an
    // orphan style so any stray reference doesn't break.
    display: 'none',
  },
  photoSlideImg: {
    position: 'absolute', inset: 0,
    width: '100%', height: '100%',
    objectFit: 'cover', display: 'block',
  },
  photoSlideCaption: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: '40px 56px',
    background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 50%, rgba(0,0,0,0) 100%)',
    display: 'flex', alignItems: 'center', gap: 24,
  },
  photoSlideCaptionText: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  photoSlideEmoji: {
    fontSize: 96, animation: 'tv-shake 2s ease-in-out infinite',
    flexShrink: 0,
  },
  photoSlideTitle: {
    fontSize: 64, fontWeight: 900, color: ACCENT,
    lineHeight: 1.1, letterSpacing: 0.5,
    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
  },
  photoSlideSub: {
    fontSize: 24, opacity: 0.92, fontWeight: 700,
    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
  },

  // ── Old queueGrid (kept to not orphan refs in unused styles) ──
  queueGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 24, flex: 1, minHeight: 0,
  },
  queueColumn: {
    background: CARD_BG, border: CARD_BORDER,
    borderRadius: 20, padding: 20,
    display: 'flex', flexDirection: 'column',
    minHeight: 0, backdropFilter: 'blur(10px)',
  },
  queueColHeader: {
    display: 'flex', alignItems: 'center', gap: 16,
    paddingBottom: 16, marginBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.15)',
  },
  queueColImg: {
    width: 72, height: 72, borderRadius: 14,
    objectFit: 'cover',
  },
  queueColImgFallback: {
    width: 72, height: 72, borderRadius: 14,
    background: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 40,
  },
  queueColName: {
    flex: 1, fontSize: 30, fontWeight: 900,
    lineHeight: 1.1,
  },
  queueColCount: {
    fontSize: 18, fontWeight: 800, color: ACCENT,
    background: 'rgba(134,239,172,0.15)',
    padding: '6px 14px', borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  queueList: {
    display: 'flex', flexDirection: 'column', gap: 10,
    flex: 1, overflow: 'auto',
  },
  queueRow: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '10px 14px', borderRadius: 12,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  queueRowNext: {
    background: 'linear-gradient(90deg, rgba(134,239,172,0.25), rgba(45,150,83,0.15))',
    border: '2px solid #86efac',
    animation: 'tv-queue-pulse 1.8s ease-in-out infinite',
  },
  queuePos: {
    width: 42, height: 42, borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 900, flexShrink: 0,
  },
  queuePosNext: {
    background: ACCENT, color: '#0a1f14',
  },
  queuePhoto: {
    width: 44, height: 44, borderRadius: '50%',
    objectFit: 'cover', flexShrink: 0,
  },
  queuePhotoFallback: {
    width: 44, height: 44, borderRadius: '50%',
    background: PRIMARY, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 900, flexShrink: 0,
  },
  queueName: {
    flex: 1, fontSize: 22, fontWeight: 800,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  queueNextBadge: {
    fontSize: 14, fontWeight: 900,
    background: '#86efac', color: '#0a1f14',
    padding: '4px 10px', borderRadius: 999,
    letterSpacing: 1,
  },
  queueEmpty: {
    textAlign: 'center', padding: 32,
    fontSize: 22, opacity: 0.5, fontStyle: 'italic',
  },
};
