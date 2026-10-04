import {
  useState, useEffect, useRef
} from 'react';
import {
  collection, query, where,
  onSnapshot, doc, getDoc,
  setDoc, updateDoc, addDoc, deleteDoc,
  getDocs, serverTimestamp,
  increment, writeBatch, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { markMemberAttendance, type CheckInMethod } from '@/lib/attendance';
import { membershipUpdate } from '@/lib/membership';
import { addPaymentToBatch } from '@/lib/recordPayment';
import { onAuthStateChanged } from 'firebase/auth';
import { fetchClubAndPrint, generateTxnId, primeClubPrintCache, primeShakeTokenToggles, printShakeAndAfresh, getCachedShakeTokenToggles } from '@/utils/printReceipt';
import { getNextOrderNumber, getNextOrderNumbers } from '@/utils/orderNumber';
import { buildSessionSummaryReceipt, buildTopupReceipt, buildShakeTokenReceipt, buildAfreshToken, buildMemberWelcomeSlip, buildGuestPaymentReceipt, buildHeader, buildFooter } from '@/utils/receiptBuilder';
import PaymentMethodPicker, { emptyPaymentSelection, validatePayment, validatePayment as validateTopupPayment, type PaymentSelection, type PaymentSelection as TopupPaymentSelection } from '@/components/PaymentMethodPicker';
import { logInvoice } from '@/utils/invoice';
import ShakeBalanceCard from '@/components/member/ShakeBalanceCard';
import BirthdayWishBanner from '@/components/mlm/BirthdayWishBanner';
import { useClubContext } from '@/lib/clubDetection';
import { useEarlyBird } from '@/hooks/useEarlyBird';
import * as faceapi from 'face-api.js';
import { loadFaceModels, FACE_DETECTOR_OPTS } from '@/lib/faceApi';
import BulkWeighIn from '@/components/owner/BulkWeighIn';
import AddShakeCredits from '@/components/reception/AddShakeCredits';
import SellProduct from '@/components/reception/SellProduct';
import TodayReportModal from '@/components/owner/TodayReportModal';
import ManualEntryModal from '@/components/owner/ManualEntryModal';
import MemberDetailsPanel from '@/components/reception/MemberDetailsPanel';
import { planCreditsOf, planGrantsNoCredits, planCreditsLabel } from '@/utils/planCredits';
import TodayActivityDrawer from '@/components/reception/TodayActivityDrawer';
import LuckyDipCounter from '@/components/reception/LuckyDipCounter';
import { luckyDipNudge } from '@/lib/luckyDip';
import GiftCardChecklist from '@/components/reception/GiftCardChecklist';
import DailyClubUsage from '@/components/reception/DailyClubUsage';
import { expiryStatus } from '@/hooks/owner/useVirtualMembers';
import { useRejectOrder } from '@/hooks/useOrders';
import { useAddGuestEntry } from '@/hooks/useGuestEntries';
import ReceptionGuestWizard from '@/components/reception/ReceptionGuestWizard';
import PurchaseRequestsScreen from '@/components/reception/PurchaseRequestsScreen';
import { usePendingPurchaseRequests } from '@/hooks/usePurchaseRequests';
import { useLeaderboard } from '@/hooks/owner/useWeighIns';
import MagicianButton from '@/features/magician/MagicianButton';
import FaceAutoCapture from '@/features/faceCapture/FaceAutoCapture';
import { playBirthdaySong, isBirthdayToday } from '@/features/birthday/birthdaySong';
import ShakePreferencesEditor from '@/features/preferences/ShakePreferencesEditor';
import TeamsManager from '@/features/teams/TeamsManager';
import { todayLocal } from '@/lib/clubDay';
import { speakWelcome } from '@/lib/speak';
import { normalizeTender } from '@/lib/paymentSplit';
import { memberPhotoFields, memberPhotoOf } from '@/lib/memberPhoto';
import NightShakeScreen from '@/components/reception/NightShakeScreen';
import { addVirtualRenewal, addVirtualRenewalToBatch, getAllVirtualRenewals, getRenewedMemberIdsOn } from '@/lib/virtualRenewals';
import { useCardScanner } from '@/lib/qrScan';

// ─────────────────────────────────
// UPI Add Form (inline in reception settings)
// ─────────────────────────────────
function UpiAddForm({ clubId, upiAccounts, setUpiAccounts }: { clubId: string; upiAccounts: any[]; setUpiAccounts: (v: any[]) => void }) {
  const [app, setApp] = useState('');
  const [number, setNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const handleAdd = async () => {
    if (!app || !number || !holderName || !clubId) return;
    setSaving(true);
    const newAccount = { id: Date.now().toString(), app, number, holderName };
    const updated = [...upiAccounts, newAccount];
    try {
      await updateDoc(doc(db, 'clubs', clubId), { upiAccounts: updated });
      setUpiAccounts(updated);
      setApp(''); setNumber(''); setHolderName('');
    } catch (e) { console.error('Add UPI error', e); }
    setSaving(false);
  };
  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid #e9d5ff', fontSize: 13, fontFamily: 'Nunito,sans-serif', boxSizing: 'border-box' as const };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input placeholder="UPI Name (e.g. PhonePe)" value={app} onChange={e => setApp(e.target.value)} style={inputStyle} />
      <input placeholder="UPI ID (e.g. 9876543210@ybl)" value={number} onChange={e => setNumber(e.target.value)} style={inputStyle} />
      <input placeholder="Mobile Number" value={holderName} onChange={e => setHolderName(e.target.value)} style={inputStyle} />
      <button onClick={handleAdd} disabled={saving || !app || !number || !holderName}
        style={{ padding: '8px 0', borderRadius: 8, border: 'none', background: !app || !number || !holderName ? '#d1d5db' : '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, cursor: !app || !number || !holderName ? 'default' : 'pointer', fontFamily: 'Nunito,sans-serif' }}>
        {saving ? 'Adding...' : '+ Add UPI Account'}
      </button>
    </div>
  );
}

// ─────────────────────────────────
// TYPES
// ─────────────────────────────────
type Screen =
  | 'home'
  | 'member_grid'
  | 'renew_grid'
  | 'night_shake'
  | 'face_verify'
  | 'member_dashboard'
  | 'done_summary'
  | 'otp_fallback'
  | 'topup'
  | 'accountant_select'
  | 'accountant_verify'
  | 'volunteer_grid'
  | 'volunteer_verify'
  | 'enroll_select'
  | 'enroll_plan'
  | 'enroll_capture'
  | 'pending_confirmed'
  | 'purchase_requests'
  | 'first_day'
  | 'virtual_grid'
  | 'virtual_renew_choice'
  | 'virtual_renew'
  | 'virtual_renew_backdate'
  | 'virtual_bulk_renew';

// ─────────────────────────────────
// HELPERS
// ─────────────────────────────────
const playSuccessSound = () => {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as any).webkitAudioContext
    )();
    [0, 0.12, 0.24].forEach((t, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = i === 2 ? 1200 : 900;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.1);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.1);
    });
  } catch {}
};

// ─────────────────────────────────
// NUMPAD COMPONENT
// ─────────────────────────────────
const NumPad = ({
  value,
  onChange,
  maxLength = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(3,1fr)',
    gap: 10,
  }}>
    {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', '0', '⌫'].map((n, i) => (
      <button
        key={i}
        onClick={() => {
          if (n === '⌫') {
            onChange(value.slice(0, -1));
          } else if (n !== '' && value.length < maxLength) {
            onChange(value + n);
          }
        }}
        style={{
          padding: '18px',
          border: '1.5px solid #e0f0e9',
          borderRadius: 12,
          background: n === '' ? 'transparent' : 'white',
          fontSize: 20,
          fontWeight: 700,
          cursor: n === '' ? 'default' : 'pointer',
          color: '#1a3a2a',
          visibility: n === '' ? 'hidden' : 'visible',
          fontFamily: 'Nunito, sans-serif',
          transition: 'background 0.1s',
        }}
      >{n}</button>
    ))}
  </div>
);

// ─────────────────────────────────
// PIN DOTS COMPONENT
// ─────────────────────────────────
const PinDots = ({
  value,
  total = 6,
}: {
  value: string;
  total?: number;
}) => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 28,
  }}>
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: value.length > i ? '#2d9653' : '#e5e7eb',
        transition: 'background 0.2s',
      }} />
    ))}
  </div>
);

// ─────────────────────────────────
// Add Volunteer picker — mark members as volunteers (isVolunteer=true) so
// they appear on the Volunteer Check-in grid. Also lets you remove someone.
// `members` is the live roster from the parent (onSnapshot), so the lists
// update the moment a flag is flipped.
// ─────────────────────────────────
function AddVolunteerPicker({ clubId, members, onClose }: { clubId: string; members: any[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const term = q.trim().toLowerCase();

  const matchesTerm = (m: any) =>
    !term ||
    (m.name || '').toLowerCase().includes(term) ||
    (m.phone || '').toLowerCase().includes(term) ||
    (m.memberId || '').toString().toLowerCase().includes(term);

  const currentVols = members.filter(m => m.isVolunteer === true);
  const candidates = members.filter(m => m.isVolunteer !== true && matchesTerm(m)).slice(0, 50);

  const setVol = async (m: any, isVol: boolean) => {
    if (!clubId) return;
    setBusyId(m.id);
    try {
      await updateDoc(doc(db, 'clubs', clubId, 'members', m.id), { isVolunteer: isVol, updatedAt: serverTimestamp() });
    } catch (e) { console.error('[volunteer flag]', e); }
    finally { setBusyId(null); }
  };

  const rowImg = (m: any) => memberPhotoOf(m)
    ? <img src={memberPhotoOf(m)} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'white', fontWeight: 900, flexShrink: 0 }}>{(m.name || '?').charAt(0).toUpperCase()}</div>;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16, fontFamily: 'Nunito, sans-serif' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 20, maxWidth: 520, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>➕ Add Volunteer</div>
          <button onClick={onClose} style={{ width: 34, height: 34, border: 'none', background: '#f1f5f9', borderRadius: '50%', cursor: 'pointer', fontWeight: 800, color: '#64748b', fontSize: 16 }}>×</button>
        </div>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="🔍 Search members by name, ID or phone…"
          autoFocus
          style={{ width: '100%', padding: '13px 16px', border: '2px solid #c7d2fe', borderRadius: 12, fontSize: 15, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none', marginBottom: 14 }}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Add a member as volunteer
          </div>
          {candidates.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13, padding: '10px 4px' }}>{term ? 'No matching members.' : 'Start typing to find a member.'}</div>
          )}
          <div style={{ display: 'grid', gap: 6 }}>
            {candidates.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                {rowImg(m)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || '—'}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{m.memberId || ''}{m.memberId && m.phone ? ' · ' : ''}{m.phone || ''}</div>
                </div>
                <button onClick={() => setVol(m, true)} disabled={busyId === m.id} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', flexShrink: 0 }}>{busyId === m.id ? '…' : 'Add'}</button>
              </div>
            ))}
          </div>

          {currentVols.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, margin: '16px 0 8px' }}>
                Current volunteers · {currentVols.length}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {currentVols.filter(matchesTerm).map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                    {rowImg(m)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || '—'}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{m.memberId || ''}{m.memberId && m.phone ? ' · ' : ''}{m.phone || ''}</div>
                    </div>
                    <button onClick={() => setVol(m, false)} disabled={busyId === m.id} style={{ padding: '8px 14px', background: 'white', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', flexShrink: 0 }}>{busyId === m.id ? '…' : 'Remove'}</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────
export default function Reception() {
  const { club: contextClub } = useClubContext();

  // ── Early Bird ────────────────
  const { photo: earlyBirdPhoto } = useEarlyBird(contextClub?.id);
  const { data: receptionLeaderboard = [] } = useLeaderboard(contextClub?.id ?? null, 'week');

  // ── Pending purchase requests (real-time count for inbox badge) ────────
  const { count: pendingRequestCount } = usePendingPurchaseRequests(contextClub?.id ?? null);

  // ── PIN lock ──────────────────
  const [pinUnlocked, setPinUnlocked] = useState(true); // PIN temporarily disabled
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [clubPin, setClubPin] = useState('1234');
  const [walletPin, setWalletPin] = useState('');
  const [clubId, setClubId] = useState('');
  const [clubName, setClubName] = useState('Magic Nutrition Club');
  const [isAuthed, setIsAuthed] = useState(false);

  // ── Biometric settings panel ───
  const [showSettings, setShowSettings] = useState(false);

  // ── Weight check-in ───────────
  const [showWeighIn, setShowWeighIn] = useState(false);
  const [weighInOverride, setWeighInOverride] = useState<boolean | null>(null);

  // ── Leaderboard overlay ───────
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ── Screen state ──────────────
  const [screen, setScreen] = useState<Screen>('home');

  // ── Data ──────────────────────
  const [members, setMembers] = useState<any[]>([]);
  // Volunteer Check-in: "Add Volunteer" picker (marks members isVolunteer=true)
  const [addVolOpen, setAddVolOpen] = useState(false);
  // Couple prompt — opens when a tile is tapped for a member who has a
  // `couplePartnerId`. Lets the receptionist record "Both / Only [name] /
  // Only [partner]" for the day's couple-attendance award tracking.
  const [couplePrompt, setCouplePrompt] = useState<{ member: any; partner: any } | null>(null);
  // Single-account couple attendance (one membership, husband + wife names):
  // tapping the tile asks "Who is present today?" before completing attendance.
  const [coupleSinglePrompt, setCoupleSinglePrompt] = useState<any | null>(null);
  // One-Day Shake member: tapping the tile offers Deduct Credits vs One-Day Shake.
  const [oneDayRoutePrompt, setOneDayRoutePrompt] = useState<any | null>(null);
  const [todaysSpecials, setTodaysSpecials] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [memberWallet, setMemberWallet] = useState<any>(null);
  const [pendingCheckins, setPendingCheckins] = useState<any[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<any>(null); // for pending_confirmed screen

  // When face verification is OFF (club setting), tapping a member card opens
  // this confirm dialog instead of going straight in. Staff sees the photo
  // big and confirms "Is <Name> entered?" before the profile opens — protects
  // against the receptionist accidentally tapping the wrong tile in a crowd.
  const [confirmingMember, setConfirmingMember] = useState<any>(null);
  const [confirmingPending, setConfirmingPending] = useState<any | null>(null);
  const [confirmingBusy, setConfirmingBusy] = useState(false);

  // Live club setting — useClubContext caches once per session, so toggles
  // made in Settings don't reach Reception until reload. We track this field
  // separately via onSnapshot so the toggle takes effect immediately.
  // Initialised from the last-known value (localStorage) so a face-OFF club
  // doesn't download face models on every Reception open before the club-doc
  // snapshot resolves. Default true when unknown.
  const [faceVerificationEnabled, setFaceVerificationEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('mnh_faceVerif') !== '0'; } catch { return true; }
  });

  // ── Face recognition ──────────
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [faceStatus, setFaceStatus] = useState('');
  const [failCount, setFailCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceIntervalRef = useRef<any>(null);

  // ── OTP fallback ──────────────
  const [otpInput, setOtpInput] = useState('');
  const [otpPinInput, setOtpPinInput] = useState('');
  const [otpError, setOtpError] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');

  // ── Top-up ────────────────────
  const [topupAmount, setTopupAmount] = useState('');
  const [topupPin, setTopupPin] = useState('');
  const [topupPinError, setTopupPinError] = useState('');
  const [topupSuccess, setTopupSuccess] = useState(false);
  const [topupVerifiedBy, setTopupVerifiedBy] = useState(''); // name of accountant who verified
  const [showPinFallback, setShowPinFallback] = useState(false);

  // ── Accountants ───────────────
  const [accountants, setAccountants] = useState<any[]>([]);
  const [verifyingAccountant, setVerifyingAccountant] = useState<any | null>(null);

  // ── Order ─────────────────────
  const [orderMessage, setOrderMessage] = useState('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [cart, setCart] = useState<any[]>([]);
  const [showCartCheckout, setShowCartCheckout] = useState(false);
  const [shakeCart, setShakeCart] = useState<any[]>([]); // max 1 item, has icePreference field
  const [showShakeCheckout, setShowShakeCheckout] = useState(false);
  // Products payment: which method, plus the PaymentMethodPicker selection
  // for cash/UPI/split. 'wallet' is a 4th option that debits from the
  // member's wallet balance instead of recording a cash/UPI payment.
  const [productsPayMethod, setProductsPayMethod] = useState<'wallet' | 'cash' | 'upi' | 'split' | null>(null);
  const [productsPayment, setProductsPayment] = useState<TopupPaymentSelection>(emptyPaymentSelection);
  // Holds the inline payment-picker view inside the Buy Products modal.
  const [showProductsPayment, setShowProductsPayment] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [sessionLog, setSessionLog] = useState<any[]>([]);

  // ── Member plan & attendance ──
  const [memberPlan, setMemberPlan] = useState<any>(null);
  const [memberAttendanceCount, setMemberAttendanceCount] = useState(0);
  const [clubProducts, setClubProducts] = useState<any[]>([]);
  const [clubMemberships, setClubMemberships] = useState<any[]>([]);
  const [todayOrders, setTodayOrders] = useState<any[]>([]);

  // ── UPI accounts (from club settings) ─────────────
  const [upiAccounts, setUpiAccounts] = useState<any[]>([]);

  // ── Payment method for plan purchase ──────────────
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'split' | ''>('');
  const [selectedUpiAccount, setSelectedUpiAccount] = useState<any | null>(null);

  // ── Topup payment selection (cash / upi / split) ──
  const [topupPayment, setTopupPayment] = useState<TopupPaymentSelection>({ method: 'cash', cashAmount: 0, upiAmount: 0 });

  // ── Virtual Members ────────────────────────────────
  const [virtualMembers, setVirtualMembers] = useState<any[]>([]);
  const [showVirtualSection, setShowVirtualSection] = useState(false);
  const [virtualTab, setVirtualTab] = useState<'list' | 'add' | 'payment'>('list');
  const [newVirtualName, setNewVirtualName] = useState('');
  const [newVirtualPhone, setNewVirtualPhone] = useState('');
  const [newVirtualSaving, setNewVirtualSaving] = useState(false);
  const [selectedVirtualMember, setSelectedVirtualMember] = useState<any | null>(null);
  const [virtualPlanId, setVirtualPlanId] = useState('');
  const [virtualAmount, setVirtualAmount] = useState('');
  const [virtualPayMethod, setVirtualPayMethod] = useState<'cash' | 'upi' | ''>('');
  const [virtualUpiAccount, setVirtualUpiAccount] = useState<any | null>(null);
  const [virtualSaving, setVirtualSaving] = useState(false);
  // Collection date (used on the dedicated Virtual Number tab renewal flow)
  const [virtualCollectionDate, setVirtualCollectionDate] = useState('');
  // Back-dated renewal (payment already collected earlier — just extend expiry by 1 month)
  const [virtualBackdatePaidOn, setVirtualBackdatePaidOn] = useState('');

  // ── Virtual tab inline Add form + search ─────────
  const [showVirtualAdd, setShowVirtualAdd] = useState(false);
  const [virtualGridSearch, setVirtualGridSearch] = useState('');
  // ── Virtual Member filters & sort ───────────────────────────────────
  const [virtualStatusFilter, setVirtualStatusFilter] = useState<'all' | 'active' | 'expired' | 'never'>('all');
  const [virtualPlanFilter, setVirtualPlanFilter] = useState<string>('all'); // planName or 'all'
  const [virtualSort, setVirtualSort] = useState<'recent' | 'name' | 'expiringSoon' | 'expiredFirst'>('recent');
  // ── Virtual Member Report ──────────────────────────────────────────
  const [showVirtualReport, setShowVirtualReport] = useState(false);
  const [vrFromDate, setVrFromDate] = useState('');
  const [vrToDate, setVrToDate] = useState('');
  const [vrData, setVrData] = useState<any[] | null>(null);
  const [vrLoading, setVrLoading] = useState(false);
  // ── Inline edit (name / phone) for an existing virtual member ───────
  const [editingVirtualId, setEditingVirtualId] = useState<string | null>(null);
  // ── Bulk Renew (back-fill historical renewals for many members at once) ──
  const [bulkRenewDate, setBulkRenewDate] = useState('');
  const [bulkRenewSearch, setBulkRenewSearch] = useState('');
  const [bulkRenewSelected, setBulkRenewSelected] = useState<string[]>([]);
  const [bulkRenewPayMethod, setBulkRenewPayMethod] = useState<'cash' | 'upi'>('cash');
  const [bulkRenewSaving, setBulkRenewSaving] = useState(false);
  const [bulkRenewResult, setBulkRenewResult] = useState<{ ok: number; failed: number; alreadyDone?: number; failedVms?: any[]; amountWritten?: number; missing?: number; renewalDateStr?: string } | null>(null);
  const [editVirtualName, setEditVirtualName] = useState('');
  const [editVirtualPhone, setEditVirtualPhone] = useState('');
  const [editVirtualSaving, setEditVirtualSaving] = useState(false);
  const [editVirtualError, setEditVirtualError] = useState('');

  // ── First Day ────────────────────────────────────
  // Reception tile that records a free trial shake for a brand-new walk-in.
  // Phone gets two complimentary entries; third returns a banner instead of
  // saving so reception can route them through the regular paid flow.
  const [fdName, setFdName] = useState('');
  const [fdPhone, setFdPhone] = useState('');
  const [fdInviterSearch, setFdInviterSearch] = useState('');
  const [fdInviter, setFdInviter] = useState<{ id: string; name: string; phone?: string; memberId?: string } | null>(null);
  const [fdSaving, setFdSaving] = useState(false);
  const [fdLimitInfo, setFdLimitInfo] = useState<{ count: number; lastDate?: string } | null>(null);
  const [fdResult, setFdResult] = useState<{ name: string; token?: string } | null>(null);
  const [fdShowCapture, setFdShowCapture] = useState(false);

  // ── Enroll ────────────────────
  const [enrollMemberId, setEnrollMemberId] = useState('');
  const [enrollPhotos, setEnrollPhotos] = useState<number[][]>([]);
  const [enrollStatus, setEnrollStatus] = useState('');
  const [enrollPlanId, setEnrollPlanId] = useState('');
  const [enrollPayMethod, setEnrollPayMethod] = useState<'cash' | 'upi'>('cash');
  const [enrollDaysUsed, setEnrollDaysUsed] = useState('');
  const [enrollSearch, setEnrollSearch] = useState('');
  const [viewOnlyMode, setViewOnlyMode] = useState(false); // "View Member": open profile WITHOUT marking attendance
  const [showRemoveVolunteer, setShowRemoveVolunteer] = useState(false);

  // ── Volunteer ──────────────────
  const [volunteerTarget, setVolunteerTarget] = useState('');
  const [volunteerSessions, setVolunteerSessions] = useState<any[]>([]);
  const [verifyingVolunteer, setVerifyingVolunteer] = useState<any | null>(null);

  // ── Search ────────────────────
  const [memberSearch, setMemberSearch] = useState('');
  // Shared keyboard mode for the member + volunteer search inputs.
  // Default to numeric (members usually search by phone / member ID); the
  // little 123/ABC toggle next to the box flips it to a text keyboard for
  // name searches. Toggling re-focuses the input so the on-screen keyboard
  // actually switches on tablets.
  const [searchKeyboardMode, setSearchKeyboardMode] = useState<'numeric' | 'text'>('numeric');
  const memberSearchRef = useRef<HTMLInputElement | null>(null);
  const volunteerSearchRef = useRef<HTMLInputElement | null>(null);
  const toggleSearchKeyboard = () => {
    const next = searchKeyboardMode === 'numeric' ? 'text' : 'numeric';
    setSearchKeyboardMode(next);
    // blur + re-focus so mobile / tablet keyboards switch immediately
    setTimeout(() => {
      const el = memberSearchRef.current || volunteerSearchRef.current;
      if (el) { el.blur(); requestAnimationFrame(() => el.focus()); }
    }, 0);
  };
  const [volunteerSearch, setVolunteerSearch] = useState('');

  // Auto-clear the search boxes whenever the user leaves member_grid /
  // volunteer_grid, so the next person entering doesn't see someone
  // else's typed number still in the field.
  useEffect(() => {
    if (screen !== 'member_grid') setMemberSearch('');
    if (screen !== 'volunteer_grid') setVolunteerSearch('');
  }, [screen]);

  // ── Success overlay ───────────
  const [successData, setSuccessData] = useState<{
    message: string;
    sub?: string;
  } | null>(null);

  // ── Reception actions (new) ────
  const [receptionAction, setReceptionAction] = useState<'add_shake_credits' | 'sell_product' | 'add_guest' | null>(null);
  const [sellProductInitialName, setSellProductInitialName] = useState<string | null>(null);
  const [showTodayReport, setShowTodayReport] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showShakePrefs, setShowShakePrefs] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const [showGiftCards, setShowGiftCards] = useState(false);
  const [showDailyUsage, setShowDailyUsage] = useState(false);

  // ── Plan purchase at reception ─
  const [showNoCreditOptions, setShowNoCreditOptions] = useState(false);
  const [showPlanPurchase, setShowPlanPurchase] = useState(false);
  const [purchasePlanId, setPurchasePlanId] = useState('');
  const [planPurchaseVerifiedBy, setPlanPurchaseVerifiedBy] = useState('');
  const [planPurchaseSuccess, setPlanPurchaseSuccess] = useState(false);
  const verifyActionRef = useRef<'topup' | 'plan_purchase' | 'oneday_shake'>('topup');
  // True while a renewal is being written, so a double press sells one plan.
  const planPurchaseInFlightRef = useRef(false);
  // Renewal block: the member picked from the Renewal tile, and its search box.
  const [renewSearch, setRenewSearch] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  // Renewal payment. Cash / UPI / **Split** — the renewal screen was the only
  // money flow left that could not take part cash and part UPI, which is how a
  // fair number of members actually pay.
  const [planPayment, setPlanPayment] = useState<PaymentSelection>(emptyPaymentSelection);
  // Which voice reads the welcome. Empty = let lib/speak choose, which prefers
  // an Indian English female voice. Pinned per tablet, because the voices
  // installed on the desk machine are not the ones on anybody else's.
  const [preferredVoiceName, setPreferredVoiceName] = useState<string>(() => {
    try { return localStorage.getItem('mnh_voice') || ''; } catch { return ''; }
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setAvailableVoices(synth.getVoices().filter(v => (v.lang || '').toLowerCase().startsWith('en')));
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, []);
  const accountantApprovingRef = useRef(false);
  // When each member was last checked in from this tablet, so a repeated tap
  // on the same face cannot place a second order. Per member, not global.
  const checkInTapRef = useRef<Record<string, number>>({});
  // The burst that pops over a member's face when they are checked in, instead
  // of navigating to a welcome screen. `id` is the member doc id, so the tile
  // knows whether the burst belongs to it. Cleared after the animation.
  const [checkInBurst, setCheckInBurst] = useState<{ id: string; msg: string; failed?: boolean } | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCheckInBurst = (member: any, msg: string) => {
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    setCheckInBurst({ id: member.id, msg });
    burstTimerRef.current = trackTimer(setTimeout(() => setCheckInBurst(null), 2600));
    // Reads the name aloud in an Indian female voice where the tablet has one.
    // The club can pin a specific voice from Settings if it prefers another.
    speakWelcome(member?.name || member?.fullName || '', preferredVoiceName);
  };
  // A check-in that failed must never look like one that worked. Held longer
  // and shown in red so the receptionist notices and taps again.
  const showCheckInFailed = (member: any, msg: string) => {
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    setCheckInBurst({ id: member.id, msg, failed: true });
    burstTimerRef.current = trackTimer(setTimeout(() => setCheckInBurst(null), 6000));
  };
  // Every setTimeout started by this screen, so none of them can fire after the
  // receptionist has moved on or the page has closed. There were 28 timers here
  // and not one clearTimeout, so navigation timers kept firing against a screen
  // that had already changed — which is why the tab sometimes jumped back to
  // the home screen on its own.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const trackTimer = (t: ReturnType<typeof setTimeout>) => {
    timersRef.current.push(t);
    return t;
  };
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // ── One-day shake purchase ─
  const [showOneDayShake, setShowOneDayShake] = useState(false);
  const [oneDayShakeStep, setOneDayShakeStep] = useState<'select' | 'payment' | 'done'>('select');
  const [oneDayShakeItem, setOneDayShakeItem] = useState<any>(null);
  // How many days the customer is paying for today (1, 2, or 3). Today's
  // shake is served immediately; any extra days go to `oneDayShakeCredits`
  // on the member doc and are auto-redeemed on future visits.
  const [oneDayShakeDays, setOneDayShakeDays] = useState<number>(1);
  // When member has prepaid credits, the modal opens in "redeem" mode by
  // default — clicking a shake consumes one credit instead of charging.
  // The receptionist can toggle off to buy more days at the same visit.
  const [oneDayShakeRedeemMode, setOneDayShakeRedeemMode] = useState<boolean>(false);
  const [oneDayShakeRedeeming, setOneDayShakeRedeeming] = useState<boolean>(false);
  const [oneDayPayment, setOneDayPayment] = useState<TopupPaymentSelection>(emptyPaymentSelection);
  const [oneDayShakeVerifiedBy, setOneDayShakeVerifiedBy] = useState('');
  const [oneDayShakeSaving, setOneDayShakeSaving] = useState(false);
  const [showOneDayShakeMemberPicker, setShowOneDayShakeMemberPicker] = useState(false);
  const [oneDayShakeMemberSearch, setOneDayShakeMemberSearch] = useState('');

  // ─────────────────────────────
  // StationAccess has already verified the device's club-scoped grant.
  // ─────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setIsAuthed(!!user && !user.isAnonymous);
    });
    return unsub;
  }, []);

  // INIT — get clubId
  // ─────────────────────────────
  useEffect(() => {
    const id =
      localStorage.getItem('receptionClubId') ||
      new URLSearchParams(window.location.search).get('clubId') ||
      contextClub?.id || '';
    setClubId(id);
  }, [contextClub?.id]);

  // ─────────────────────────────
  // FETCH club data + PIN (real-time)
  //
  // Subscribed (not getDoc) so settings flipped in the admin dashboard
  // — face-verification toggle, PIN, UPI accounts — propagate to Reception
  // without forcing a page reload.
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    return onSnapshot(doc(db, 'clubs', clubId), snap => {
      const data = snap.data();
      if (!data) return;
      setClubPin(data?.receptionPin || data?.kitchenPin || '1234');
      setWalletPin(data?.walletPin || '');
      setClubName(data?.clubName || data?.name || 'Magic Nutrition Club');
      setUpiAccounts(data?.upiAccounts || []);
      {
        const fv = data?.faceVerificationEnabled ?? true;
        setFaceVerificationEnabled(fv);
        try { localStorage.setItem('mnh_faceVerif', fv ? '1' : '0'); } catch { /* ignore */ }
      }
      if (data?.weighInOpen != null) setWeighInOverride(data.weighInOpen);
      // Keep the print-cache hot so shake-token / receipt prints don't wait
      // on a getDoc round-trip. The data we already have is exactly what
      // fetchClubAndPrint needs (name, address, phone, email, GSTIN).
      primeClubPrintCache(clubId, data);
      // And the per-club shake/refreshment-token toggles — owner can flip
      // these in admin Settings to suppress one or both auto-prints.
      primeShakeTokenToggles(clubId, data);
    });
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // FETCH virtual members (real-time)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    return onSnapshot(
      collection(db, 'clubs', clubId, 'virtualMembers'),
      snap => setVirtualMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.memberId || '').localeCompare(b.memberId || '')))
    );
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // FETCH members (real-time)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    return onSnapshot(
      collection(db, 'clubs', clubId, 'members'),
      snap => setMembers(snap.docs.map(d => {
        // Drop the face data before it goes into state. Every member's
        // descriptor is 128 numbers, and this is a LIVE listener on the whole
        // collection — so each check-in (which writes lastVisit) re-delivered
        // all ~200 members and rebuilt every one of those arrays, then
        // re-rendered everything reading `members`. Over a service the tab grew
        // heavier and heavier until it stopped responding.
        //
        // Nothing on screen needs the numbers themselves — only whether the
        // member is enrolled. The descriptor is fetched for the single member
        // being verified, which is what the volunteer flow already did.
        const { faceDescriptor, ...rest } = d.data() as any;
        return { id: d.id, ...rest, hasFace: !!faceDescriptor };
      }))
    );
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // AUTO-CREDIT monthly reset (for staff/owners with autoCredits flag)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed || members.length === 0) return;
    const currentMonth = new Date().toISOString().slice(0, 7); // "2026-04"
    const autoMembers = members.filter((m: any) => m.autoCredits && m.autoCreditsLastReset !== currentMonth);
    if (autoMembers.length === 0) return;

    const resetAll = async () => {
      const batch = writeBatch(db);
      for (const m of autoMembers) {
        // Top up TO 25, never down to it. This wrote 25 absolutely, so a staff
        // member who happened to be holding 40 credits when the month rolled
        // over silently lost 15 of them.
        const current = Number((m as any).shakeCredits) || 0;
        const topped = Math.max(current, 25);
        batch.update(doc(db, 'clubs', clubId, 'members', m.id), {
          shakeCredits: topped,
          shakeCreditsPlanTotal: Math.max(Number((m as any).shakeCreditsPlanTotal) || 0, topped),
          autoCreditsLastReset: currentMonth,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      console.log(`[AutoCredits] Reset ${autoMembers.length} member(s) to 25 credits for ${currentMonth}`);
    };
    resetAll().catch(err => console.error('[AutoCredits] reset failed:', err));
  }, [clubId, isAuthed, members.length]);

  // ─────────────────────────────
  // FETCH today's specials
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    const today = new Date().toISOString().slice(0, 10);
    return onSnapshot(
      query(
        collection(db, 'clubs', clubId, 'todaysSpecial'),
        where('isActive', '==', true),
        where('date', '==', today)
      ),
      snap => setTodaysSpecials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // FETCH member wallet
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !selectedMember || !isAuthed) return;
    return onSnapshot(
      doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data'),
      snap => setMemberWallet(snap.exists() ? snap.data() : { balance: 0 })
    );
  }, [clubId, selectedMember, isAuthed]);

  // ─────────────────────────────
  // FETCH member plan
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !selectedMember?.membershipPlanId || !isAuthed) { setMemberPlan(null); return; }
    getDoc(doc(db, 'clubs', clubId, 'memberships', selectedMember.membershipPlanId))
      .then(snap => setMemberPlan(snap.exists() ? { id: snap.id, ...snap.data() } : null));
  }, [clubId, selectedMember?.membershipPlanId, isAuthed]);

  // ─────────────────────────────
  // COUNT total attendance
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !selectedMember?.id || !isAuthed) { setMemberAttendanceCount(0); return; }
    getDocs(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'attendance'))
      .then(snap => setMemberAttendanceCount(snap.size));
  }, [clubId, selectedMember?.id, isAuthed]);

  // ─────────────────────────────
  // FETCH club products & memberships
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    getDocs(collection(db, 'clubs', clubId, 'products'))
      .then(snap => setClubProducts(snap.docs.map(d => {
        const data = d.data() as { isDeleted?: boolean; [key: string]: unknown };
        return { id: d.id, ...data };
      }).filter(p => p.isDeleted !== true)));
    getDocs(query(collection(db, 'clubs', clubId, 'memberships'), where('isActive', '==', true)))
      .then(snap => setClubMemberships(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // FETCH today's orders for member
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !selectedMember?.id || !isAuthed) { setTodayOrders([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    getDocs(query(collection(db, 'clubs', clubId, 'orders'), where('memberId', '==', selectedMember.id)))
      .then(snap => {
        const all = snap.docs.map(d => {
          const data = d.data() as { createdAt?: { toDate: () => Date }; [key: string]: unknown };
          return { id: d.id, ...data };
        });
        setTodayOrders(all.filter(o => {
          try { return o.createdAt?.toDate().toISOString().slice(0, 10) === today; } catch { return false; }
        }));
      });
  }, [clubId, selectedMember?.id, isAuthed, orderMessage]);

  // ─────────────────────────────
  // FETCH today's volunteer sessions (real-time)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    const today = new Date().toISOString().slice(0, 10);
    return onSnapshot(
      collection(db, 'clubs', clubId, 'volunteers'),
      snap => {
        const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.lastDate === today);
        setVolunteerSessions(sessions);
      }
    );
  }, [clubId, isAuthed]);

  // FETCH today's pending checkins (real-time)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    // todayLocal, not toISOString — IST is UTC+5:30, so a UTC date files
    // anything before 05:30 under yesterday and the member's order would
    // never appear in the queue. lib/pendingCheckin and QueuePage agree.
    const today = todayLocal();
    return onSnapshot(
      query(
        collection(db, 'clubs', clubId, 'pendingCheckins'),
        where('date', '==', today),
        where('status', '==', 'pending')
      ),
      snap => setPendingCheckins(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // MEMBER CARD READER
  // ─────────────────────────────
  // USB/Bluetooth QR readers type the code and press Enter, so this listens
  // globally — no clicking into a field first. Scanning a member's card opens
  // their dashboard, the same place the search and the Lucky Dip land.
  //
  // Only armed on the home screen: mid-flow (a payment, a cart, a modal) a
  // stray scan yanking the desk to another member would lose whatever the
  // receptionist was part-way through.
  useCardScanner({
    enabled: isAuthed && screen === 'home',
    onCard: (memberDocId) => {
      const m = members.find((x: any) => x.id === memberDocId);
      if (!m) {
        alert('Card not recognised — is this member in this club?');
        return;
      }
      setSelectedMember(m);
      setScreen('member_dashboard');
    },
    onUnknown: () => alert('That is not a Magic Nutrition Club card.'),
  });

  // ─────────────────────────────
  // LOAD ACCOUNTANTS (real-time)
  // ─────────────────────────────
  useEffect(() => {
    if (!clubId || !isAuthed) return;
    return onSnapshot(collection(db, 'clubs', clubId, 'accountants'), snap => {
      setAccountants(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [clubId, isAuthed]);

  // ─────────────────────────────
  // LOAD face-api models — ONLY when face verification is enabled.
  // Load the face nets ONCE via the shared faceApi module. loadFaceModels()
  // caches the load app-wide, so Reception, the guest wizard, the volunteer
  // grid, etc. all share a single download + warm-up instead of each loading
  // their own copy. Loaded regardless of the verification toggle: face
  // ENROLLMENT must always work; the toggle only gates verification SCANS.
  // ─────────────────────────────
  useEffect(() => {
    if (modelsLoaded) return;                          // already loaded this session
    let cancelled = false;
    setModelsLoading(true);
    loadFaceModels()
      .then(() => { if (!cancelled) setModelsLoaded(true); })
      .catch((e) => { console.warn('[face models] load failed', e); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [modelsLoaded]);

  // ─────────────────────────────
  // CAMERA CLEANUP on unmount
  // Ensures camera stream and face detection interval are always stopped
  // when the Reception component is removed from the DOM.
  // ─────────────────────────────
  useEffect(() => {
    return () => {
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ─────────────────────────────
  // CAMERA helpers
  // ─────────────────────────────
  const startCamera = async () => {
    // getUserMedia only exists in a secure context (HTTPS or localhost). On a
    // plain-http LAN IP, navigator.mediaDevices is undefined — surface that
    // instead of a misleading "permission denied".
    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('[Reception] camera unavailable', { isSecureContext: window.isSecureContext, origin: window.location.origin });
      setFaceStatus(
        !window.isSecureContext
          ? 'Camera needs HTTPS. Open the site over https:// (not a plain http:// IP).'
          : 'Camera not supported in this browser.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e: any) {
      console.error('[Reception] getUserMedia failed', e);
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setFaceStatus('Camera permission denied. Allow camera access for this site.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setFaceStatus('No camera found on this device.');
      } else if (name === 'NotReadableError') {
        setFaceStatus('Camera is in use by another app. Close it and retry.');
      } else {
        setFaceStatus(`Camera error: ${e?.message || name || 'unknown'}`);
      }
    }
  };

  const stopCamera = () => {
    if (faceIntervalRef.current) {
      clearInterval(faceIntervalRef.current);
      faceIntervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // ─────────────────────────────
  // SHOW SUCCESS OVERLAY
  // ─────────────────────────────
  const showSuccess = (message: string, sub?: string, onDone?: () => void) => {
    playSuccessSound();
    setSuccessData({ message, sub });
    setTimeout(() => {
      setSuccessData(null);
      onDone?.();
    }, 2500);
  };

  // ─────────────────────────────
  // AUTO-MARK VOLUNTEER (piggybacks on member check-in)
  // ─────────────────────────────
  // When a member flagged isVolunteer checks in, mirror the standalone
  // volunteer sign-in write so the Volunteers page shows them present today.
  // Idempotent: does nothing if they already have a signed-in session today.
  // Reception can undo a wrongly-marked volunteer via "Remove Today's
  // Volunteering" in Settings.
  const autoMarkVolunteer = async (member: any) => {
    if (!clubId || member?.isVolunteer !== true) return;
    try {
      // Club-local: a volunteer auto-marked before 05:30 IST was stamped
      // with yesterday, so the 'already signed in today' check below missed
      // and they were marked again.
      const dateStr = todayLocal();
      const volRef = doc(db, 'clubs', clubId, 'volunteers', member.id);
      const snap = await getDoc(volRef);
      const data = snap.data();
      if (data?.lastDate === dateStr && data?.status === 'signed_in') return; // already signed in today
      const nowTs = Timestamp.now();
      const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const sessionRef = await addDoc(collection(db, 'clubs', clubId, 'volunteerAttendance'), {
        memberId: member.id,
        memberName: member.name || '',
        memberPhoto: memberPhotoOf(member),
        clubId,
        loginTime: nowTs,
        logoutTime: null,
        totalMinutes: null,
        date: dateStr,
        status: 'active',
        autoCheckedIn: true,
      });
      await setDoc(volRef, {
        memberId: member.id,
        memberName: member.name || '',
        memberPhoto: memberPhotoOf(member),
        status: 'signed_in',
        lastDate: dateStr,
        signInTime: timeStr,
        signInTimestamp: Date.now(),
        sessionTimestamp: nowTs,
        activeSessionId: sessionRef.id,
        lastActivityTimestamp: nowTs,
        totalSessions: increment(1),
        autoCheckedIn: true,
      }, { merge: true });
    } catch (e) {
      console.error('[autoMarkVolunteer]', e);
    }
  };

  // ─────────────────────────────
  // REMOVE TODAY'S VOLUNTEERING (member attendance stays intact)
  // ─────────────────────────────
  // Deletes only the volunteer session for today + its audit mirror. The
  // member's own check-in attendance doc is untouched. Used when someone was
  // auto-marked as volunteering but didn't actually volunteer.
  const removeTodayVolunteering = async (vol: any) => {
    if (!clubId) return;
    const id = vol.id || vol.memberId;
    if (!id) return;
    try {
      const volRef = doc(db, 'clubs', clubId, 'volunteers', id);
      const snap = await getDoc(volRef);
      const data = snap.data();
      if (data?.activeSessionId) {
        await deleteDoc(doc(db, 'clubs', clubId, 'volunteerAttendance', data.activeSessionId)).catch(() => {});
      }
      await deleteDoc(volRef).catch(() => {});
    } catch (e) {
      console.error('[removeTodayVolunteering]', e);
    }
  };

  // ─────────────────────────────
  // MARK ATTENDANCE
  // ─────────────────────────────
  const markAttendance = async (
    member: any,
    pendingItems?: any[],
    couplePresence?: 'both' | 'husband' | 'wife',
    // How they were actually identified. This used to be hardcoded to
    // 'face_recognition' for every check-in, so the attendance register
    // claimed face recognition even for a plain tap on a tablet with face
    // verification switched off — which is how the club runs.
    method: CheckInMethod = 'manual',
  ) => {
    const orderedItems = (pendingItems || []).map((i: any) => ({
      name: i.name || i.itemName || i.productName || '',
      qty: i.qty || i.quantity || 1,
    })).filter((i: any) => i.name);

    // Attendance goes through the shared writer so reception, the member app
    // and the voice assistant all produce the same record: keyed by the local
    // date, with lastVisit + lastVisitAt written alongside it.
    //
    // It is idempotent, so this no longer bails out early on a second scan the
    // way it used to — which meant a member checked in once could never have
    // couplePresence corrected, and skipped the TV welcome, the birthday tune
    // and the volunteer auto-mark for the rest of the day.
    await Promise.all([
      markMemberAttendance({
        clubId,
        memberId: member.id,
        memberName: member.name || '',
        memberPhoto: memberPhotoOf(member),
        method,
        ...(couplePresence ? { couplePresence } : {}),
      }),
      // Broadcast check-in for TV Display (/tv) welcome interruption — non-fatal.
      setDoc(doc(db, 'clubs', clubId, 'recentCheckin', 'latest'), {
        memberId: member.id,
        memberCode: member.memberId || '',
        memberName: member.name || member.fullName || '',
        memberPhoto: memberPhotoOf(member),
        totalVisits: (member.totalVisits || 0) + 1,
        orderedItems,
        // Birthday flag → TV display can play extra celebration overlay.
        isBirthday: isBirthdayToday(member.dob),
        checkedInAt: serverTimestamp(),
      }).catch((e) => console.error('TV recentCheckin write failed', e)),
    ]);

    // Auto-mark volunteer attendance for members flagged as volunteers, so the
    // green "present" mark appears on the Volunteers page without a separate
    // scan. Non-blocking; undo via "Remove Today's Volunteering" in Settings.
    if (member?.isVolunteer === true) {
      void autoMarkVolunteer(member);
    }

    // Play the Happy Birthday tune on the reception speaker when it's
    // their birthday today. Wrapped in try/catch since some browsers
    // block audio without prior user interaction (Chrome on the desk
    // is fine — there's always been a button click earlier in the
    // session).
    if (isBirthdayToday(member.dob)) {
      try { playBirthdaySong(); } catch (e) { console.warn('[birthday]', e); }
    }
  };

  // ─────────────────────────────
  // COMPLETE PENDING CHECKIN
  // ─────────────────────────────
  const completePendingCheckin = async (member: any, pending: any): Promise<{ walletOk: boolean; newBalance: number; tokenNumber?: string }> => {
    const items: any[] = pending.items || [];
    if (items.length === 0) {
      await updateDoc(doc(db, 'clubs', clubId, 'pendingCheckins', pending.id), { status: 'completed', completedAt: serverTimestamp() });
      return { walletOk: true, newBalance: 0 };
    }

    // Fetch current shake credits + allocate the next per-day token in
    // parallel — these two reads don't depend on each other and saving
    // the round-trip noticeably speeds up the "Yes" → confirmed-order
    // transition.
    const [memberSnap, tokenNumber] = await Promise.all([
      getDoc(doc(db, 'clubs', clubId, 'members', member.id)),
      getNextOrderNumber(clubId),
    ]);
    const currentCredits: number = memberSnap.data()?.shakeCredits ?? 0;
    const totalShakes = items.reduce((s: number, i: any) => s + (i.qty || 1), 0);
    const GRACE_LIMIT = -5;
    const canOrder = (currentCredits - totalShakes) >= GRACE_LIMIT;

    if (!canOrder) {
      // Grace limit exceeded — reject the pre-order
      await updateDoc(doc(db, 'clubs', clubId, 'pendingCheckins', pending.id), { status: 'rejected', rejectedAt: serverTimestamp(), reason: 'no_credits' });
      return { walletOk: false, newBalance: currentCredits };
    }

    const batch = writeBatch(db);

    // Always deduct shake credits (can go negative up to grace limit)
    batch.update(doc(db, 'clubs', clubId, 'members', member.id), {
      shakeCredits: increment(-totalShakes),
    });
    const txRef = doc(collection(db, 'clubs', clubId, 'members', member.id, 'transactions'));
    batch.set(txRef, {
      type: 'shake_credit', amount: totalShakes, reason: 'shake_order',
      description: `Pre-order: ${items.map((i: any) => i.name).join(', ')}`,
      creditsAfter: currentCredits - totalShakes, createdAt: serverTimestamp(),
    });

    // Create the kitchen order
    const orderRef = doc(collection(db, 'clubs', clubId, 'orders'));
    batch.set(orderRef, {
      memberId: member.id,
      memberName: member.name || member.fullName || '',
      memberPhoto: memberPhotoOf(member),
      items: items.map((i: any) => ({
        itemName: i.name, productName: i.name,
        qty: i.qty, quantity: i.qty,
        price: i.price || 0, pricePerUnit: i.price || 0,
        notes: i.icePreference || i.notes || '',
        itemId: i.itemId || '',
      })),
      totalAmount: pending.totalAmount || 0,
      status: 'pending',
      source: 'member_app',
      paymentMethod: 'shake_credits',
      creditsUsed: totalShakes,
      tokenNumber,
      date: new Date().toISOString().slice(0, 10),
      clubId,
      createdAt: serverTimestamp(),
    });

    // Decrement stock for limited specials — but only for specials that still
    // exist.
    //
    // This is the "it says welcome, then they are still in the queue" bug. A
    // batch update against a document that has been removed rejects the WHOLE
    // batch, so the credit was not taken, no kitchen order was created and the
    // queue card was never marked done — while the screen had already shown the
    // welcome and the summary, because it moves on before the writes land. The
    // usual trigger is the midnight reset clearing a special that a member had
    // already pre-ordered, or the menu being edited during service.
    for (const item of items) {
      if (item.stockType !== 'limited' || !item.itemId) continue;
      const specialRef = doc(db, 'clubs', clubId, 'todaysSpecial', item.itemId);
      const specialSnap = await getDoc(specialRef);
      if (specialSnap.exists()) {
        batch.update(specialRef, { remainingStock: increment(-item.qty) });
      }
    }

    batch.update(doc(db, 'clubs', clubId, 'pendingCheckins', pending.id), { status: 'completed', completedAt: serverTimestamp() });
    await batch.commit();

    return { walletOk: true, newBalance: currentCredits - totalShakes, tokenNumber };
  };

  // ─────────────────────────────
  // BYPASSED CHECK-IN (no face verify)
  //
  // Runs the same post-success flow that face-match takes — mark attendance,
  // auto-confirm pending pre-orders, print shake tokens, land on the right
  // screen. Used when the club has opted out of face verification AND the
  // receptionist has confirmed the member's identity in the dialog.
  // ─────────────────────────────
  const runBypassedCheckIn = async (
    member: any,
    opts?: {
      couplePresence?: 'both' | 'husband' | 'wife';
      /**
       * Check this person in without taking over the screen — no
       * `selectedMember`, no navigation, no burst. Used for the SECOND half of
       * a couple: they must get the duplicate guard, the pending-order
       * completion and the failure alert, but the desk must stay on the person
       * the receptionist actually tapped. Without this the two calls raced and
       * the partner's profile silently replaced the tapped member's, so a plan
       * bought straight afterwards was charged to the wrong person.
       */
      silent?: boolean;
    },
  ) => {
    const silent = opts?.silent === true;
    // ── Duplicate-tap guard ──────────────────────────────────────────────
    // This function shows the confirmation screen immediately and does the
    // writes in the background, so the FIRST tap gives no sign that anything
    // started. On a busy tablet the receptionist taps again — and a touch
    // screen can fire touch and click from one firm press. Every extra run
    // used to deduct another credit, place another kitchen order and print
    // another token for the same member. That is the "multiple entries"
    // problem.
    //
    // Keyed per member, so tapping a DIFFERENT member is never blocked.
    const now = Date.now();
    const lastTap = checkInTapRef.current[member.id] ?? 0;
    if (now - lastTap < 4000) {
      console.warn('[checkin] ignored duplicate tap for', member.id);
      return;
    }
    checkInTapRef.current[member.id] = now;

    // A silent run must not touch the selection or the screen.
    if (!silent) {
      setSelectedMember(member);
      setFailCount(0);
      setFaceStatus('');
    }
    const pending = pendingCheckins.find(p => p.memberId === member.id);

    // ── Non-pending path: walked in with no pre-order ────────────────
    // Open their profile. Someone with nothing in the queue is here to be
    // dealt with — an order to take, a plan to sell, credits to check — and
    // the burst alone left the desk with nowhere to go. Members WITH a queue
    // card keep the burst, because for them the tap is the whole job.
    //
    // Attendance is still written, in the background: this is the check-in
    // grid, and tapping someone here means they are here.
    if (!pending) {
      if (silent) speakWelcome(member?.name || member?.fullName || '', preferredVoiceName);
      else playSuccessSound();
      void markAttendance(member, undefined, opts?.couplePresence).catch((e) => {
        console.error('[markAttendance bg]', e);
        delete checkInTapRef.current[member.id];
        // The burst renders on the grid, which we have just left — so say it
        // out loud as well. A silent failure here means the person is standing
        // in the club and recorded as absent.
        showCheckInFailed(member, 'Not saved — tap again');
        alert(`${member.name || 'This member'} was NOT marked present — the save failed.\n\nGo back and tap them again.`);
      });
      if (!silent) setScreen('member_dashboard');
      return;
    }

    // ── Pending path: shake pre-order to confirm ─────────────────────
    // Burst immediately so the receptionist can move to the next member. The
    // credit deduction, kitchen order, token allocation and print all run in
    // the BACKGROUND — these were what made "Yes" hang ~20s on a slow
    // connection (the token allocation needs a server round-trip). The burst
    // picks up the token, or turns red, once the writes land.
    playSuccessSound();
    if (silent) {
      // The partner's order still gets confirmed, their credit taken and their
      // token printed — they simply do not take over the screen.
      speakWelcome(member?.name || member?.fullName || '', preferredVoiceName);
    } else {
      setConfirmedOrder({ member, pending, walletOk: true, newBalance: null });
      showCheckInBurst(
        member,
        `${(member.name || '').split(' ')[0] || 'Welcome'} · ${(pending.items || []).map((i: any) => i.name || i.itemName || 'Shake').join(', ')}`,
      );
    }
    void (async () => {
      try {
        const [, result] = await Promise.all([
          markAttendance(member, pending.items, opts?.couplePresence),
          completePendingCheckin(member, pending),
        ]);
        // Only update if the receptionist is still on THIS member's screen.
        setConfirmedOrder((prev: any) => (prev && prev.member?.id === member.id) ? { ...prev, ...result } : prev);

        // Out of credits past the grace limit: the pre-order is REJECTED, not
        // served. The burst optimistically said welcome, so correct it —
        // otherwise the member walks off without a shake and nobody knows.
        if (result?.walletOk === false) {
          showCheckInFailed(member, 'No credits — needs to renew');
          // A silent run has no burst on screen to turn red, so say it plainly
          // — otherwise the partner walks off without a shake and nobody knows.
          if (silent) {
            alert(`${member.name || 'The partner'} has no credits left — their shake was NOT ordered. They need to renew.`);
          }
          return;
        }

        // Show the token on the burst once the server has allocated it.
        if (result?.tokenNumber) {
          setCheckInBurst((b) => (b && b.id === member.id
            ? { ...b, msg: `${b.msg} · Token ${result.tokenNumber}` }
            : b));
        }

        const { tokenNumber } = result;
        const pendingItems = (pending.items || []).map((it: any) => ({
          name: it.name || it.itemName || 'Shake',
          qty: it.qty || it.quantity || 1,
          ice: it.icePreference || it.notes || '',
        }));
        if (pendingItems.length > 0 && tokenNumber) {
          const printedName = member.name || member.fullName || '';
          const now = new Date();
          printShakeAndAfresh(clubId, {
            shake: buildShakeTokenReceipt({ memberName: printedName, items: pendingItems, tokenNumber, timestamp: now }),
            afresh: buildAfreshToken({ memberName: printedName, tokenNumber, timestamp: now }),
          });
        }
      } catch (e) {
        console.error('[pending checkin bg]', e);
        // The writes are backgrounded, so a failure here used to be completely
        // silent — the screen had already said welcome while the member stayed
        // in the queue. Say so, and let the tap through again immediately.
        delete checkInTapRef.current[member.id];
        showCheckInFailed(member, 'Not saved — tap again');
        // A silent run (the second half of a couple) has no tile on screen to
        // turn red — the desk is already on the other partner. Without this the
        // failure was invisible: no credit taken, no kitchen order, no token,
        // and the member still sitting in the queue.
        if (silent) {
          alert(`${member.name || 'The partner'} was NOT checked in — the save failed.

Their shake has not been ordered. Go back to the grid and tap them again.`);
        }
      }
    })();
    return;
  };

  // ─────────────────────────────
  // FACE VERIFICATION (1:1)
  // ─────────────────────────────
  const startFaceVerification = async (member: any) => {
    if (!modelsLoaded) {
      setFaceStatus('Face models still loading...');
      return;
    }
    // The roster no longer carries face data (see the members listener), so
    // fetch this one member's descriptor now. One small read instead of holding
    // every member's descriptor in memory all day.
    let descriptor: any = member.faceDescriptor;
    let descriptorSet: any[] | null = (member as any).faceDescriptors ?? null;
    if ((!descriptor && !descriptorSet) && member.hasFace && clubId) {
      setFaceStatus('Preparing…');
      try {
        const snap = await getDoc(doc(db, 'clubs', clubId, 'members', member.id));
        const d = snap.exists() ? (snap.data() as any) : null;
        descriptor = d?.faceDescriptor ?? null;
        descriptorSet = d?.faceDescriptors ?? null;
      } catch (e) {
        console.error('[face descriptor fetch]', e);
      }
    }
    if (!descriptor && !descriptorSet) {
      setFaceStatus('Face not enrolled. Use OTP.');
      return;
    }
    // Compare against every capture we hold and take the closest. Members
    // enrolled before this change only have the averaged descriptor, so fall
    // back to it — they keep working, and re-enrolling improves them.
    // Read every shape this field has ever had: the current [{v:[…]}, …],
    // a bare array of arrays, a map keyed by index, and the pre-2026-07-30
    // single averaged descriptor (itself stored as either an array or a map).
    const templates: Float32Array[] = (() => {
      const out: Float32Array[] = [];
      const push = (raw: any) => {
        if (!raw) return;
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray(raw.v) ? raw.v : Object.values(raw);
        if (arr.length) out.push(new Float32Array(arr as number[]));
      };
      if (Array.isArray(descriptorSet)) descriptorSet.forEach(push);
      else if (descriptorSet && typeof descriptorSet === 'object') Object.values(descriptorSet).forEach(push);
      if (out.length === 0) push(descriptor);
      return out;
    })();
    if (templates.length === 0) {
      setFaceStatus('Face not enrolled. Use OTP.');
      return;
    }
    setFaceStatus('Look at the camera');
    await startCamera();
    await new Promise(r => setTimeout(r, 500));
    let attempts = 0;
    let isDetecting = false;
    faceIntervalRef.current = setInterval(async () => {
      if (isDetecting || !videoRef.current) return;
      isDetecting = true;
      attempts++;
      try {
        const det = await faceapi
          .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det) {
          if (attempts % 8 === 0) setFaceStatus('No face detected. Move closer.');
          return;
        }
        const dist = Math.min(
          ...templates.map(t => faceapi.euclideanDistance(det.descriptor, t)),
        );
        if (dist < 0.5) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          // Check for pending pre-order from member's phone (pass items to TV broadcast)
          const pending = pendingCheckins.find(p => p.memberId === member.id);
          setSelectedMember(member);
          setFailCount(0);

          // Non-pending: show welcome immediately, mark attendance in
          // background. Pending: run mark + complete in parallel since
          // they're independent writes.
          // Both branches land back on the member grid and burst over the
          // face, rather than opening a welcome screen someone has to dismiss
          // before the next person can be served.
          if (!pending) {
            playSuccessSound();
            setScreen('member_grid');
            showCheckInBurst(member, `Welcome, ${member.name?.split(' ')[0] || 'back'}!`);
            void markAttendance(member, undefined, undefined, 'face_recognition').catch((e) => {
              console.error('[markAttendance bg]', e);
              showCheckInFailed(member, 'Not saved — tap again');
            });
            return;
          }

          let result: any;
          try {
            [, result] = await Promise.all([
              markAttendance(member, pending.items, undefined, 'face_recognition'),
              completePendingCheckin(member, pending),
            ]);
          } catch (writeErr) {
            // Without this the outer `catch {}` swallowed the failure and left
            // the receptionist staring at the camera while the member stayed
            // in the queue.
            console.error('[face checkin write]', writeErr);
            delete checkInTapRef.current[member.id];
            setScreen('member_grid');
            showCheckInFailed(member, 'Not saved — tap again');
            return;
          }
          const { walletOk, newBalance, tokenNumber } = result;
          setConfirmedOrder({ member, pending, walletOk, newBalance, tokenNumber });
          setScreen('member_grid');
          if (!walletOk) {
            showCheckInFailed(member, 'No credits — needs to renew');
            return;
          }
          playSuccessSound();
          showCheckInBurst(
            member,
            `${(member.name || '').split(' ')[0] || 'Welcome'}${tokenNumber ? ` · Token ${tokenNumber}` : ''}`,
          );

          // Auto-print shake token (replaces manual paper token)
          try {
            const pendingItems = (pending.items || []).map((it: any) => ({
              name: it.name || it.itemName || 'Shake',
              qty: it.qty || it.quantity || 1,
              ice: it.icePreference || it.notes || '',
            }));
            if (pendingItems.length > 0 && tokenNumber) {
              const printedName = member.name || member.fullName || '';
              const now = new Date();
              printShakeAndAfresh(clubId, {
                shake: buildShakeTokenReceipt({
                  memberName: printedName,
                  items: pendingItems,
                  tokenNumber,
                  timestamp: now,
                }),
                afresh: buildAfreshToken({
                  memberName: printedName,
                  tokenNumber,
                  timestamp: now,
                }),
              });
            }
          } catch (printErr) {
            console.error('[shake token print]', printErr);
          }
        } else if (attempts > 40) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          const newFail = failCount + 1;
          setFailCount(newFail);
          if (newFail >= 2) {
            await triggerOtp(member);
            setScreen('otp_fallback');
          } else {
            setFaceStatus('Not recognised. Try again.');
          }
        } else {
          setFaceStatus(dist < 0.65 ? 'Almost... hold still' : 'Verifying...');
        }
      } catch {
      } finally {
        isDetecting = false;
      }
    }, 350);
  };

  // ─────────────────────────────
  // VOLUNTEER SIGN-IN / SIGN-OUT (shared core)
  // ─────────────────────────────
  // Performs the actual Firestore write: if the volunteer is already
  // signed in today → sign out; otherwise → sign in. Shows the success
  // toast and lands back on the volunteer grid. Called from BOTH:
  //   1. The face-verify success path (faceVerificationEnabled === true)
  //   2. The direct tile-tap path (faceVerificationEnabled === false),
  //      where the tap itself is the auth — no face scan involved.
  const toggleVolunteerSession = async (vol: any) => {
    if (!clubId) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const volRef = doc(db, 'clubs', clubId, 'volunteers', vol.id);
    const snap = await getDoc(volRef);
    const data = snap.data();

    if (data?.lastDate === dateStr && data?.status === 'signed_in') {
      // ── SIGN OUT ──
      const nowTs = Timestamp.now();
      const signInTs: Timestamp = data.sessionTimestamp instanceof Timestamp
        ? data.sessionTimestamp
        : Timestamp.fromMillis(data.signInTimestamp || Date.now());
      const totalMinutes = Math.round((nowTs.toMillis() - signInTs.toMillis()) / 60000);
      const hrs = +(totalMinutes / 60).toFixed(1);

      await updateDoc(volRef, {
        status: 'signed_out',
        signOutTime: timeStr,
        signOutTimestamp: Date.now(),
        hoursToday: hrs,
        lastActivityTimestamp: nowTs,
      });

      if (data.activeSessionId) {
        await updateDoc(
          doc(db, 'clubs', clubId, 'volunteerAttendance', data.activeSessionId),
          { logoutTime: nowTs, totalMinutes, status: 'completed' }
        );
      }

      showSuccess(
        `Goodbye ${vol.name?.split(' ')[0]}! 👋`,
        `${hrs}h volunteered today. Thank you!`,
        () => setScreen('volunteer_grid')
      );
    } else {
      // ── SIGN IN ──
      const nowTs = Timestamp.now();

      const sessionRef = await addDoc(
        collection(db, 'clubs', clubId, 'volunteerAttendance'),
        {
          memberId: vol.id,
          memberName: vol.name || '',
          memberPhoto: memberPhotoOf(vol),
          clubId,
          loginTime: nowTs,
          logoutTime: null,
          totalMinutes: null,
          date: dateStr,
          status: 'active',
        }
      );

      await setDoc(volRef, {
        memberId: vol.id,
        memberName: vol.name || '',
        memberPhoto: memberPhotoOf(vol),
        status: 'signed_in',
        lastDate: dateStr,
        signInTime: timeStr,
        signInTimestamp: Date.now(),
        sessionTimestamp: nowTs,
        activeSessionId: sessionRef.id,
        lastActivityTimestamp: nowTs,
        totalSessions: increment(1),
      }, { merge: true });

      showSuccess(
        `Welcome ${vol.name?.split(' ')[0]}! 🙌`,
        'Volunteer check-in recorded! ✅',
        () => setScreen('volunteer_grid')
      );
    }
  };

  // ─────────────────────────────
  // VOLUNTEER FACE VERIFICATION
  // ─────────────────────────────
  const startVolunteerFaceVerification = async (vol: any) => {
    if (!modelsLoaded) {
      setFaceStatus('Face models still loading...');
      return;
    }
    if (!vol.faceDescriptor) {
      setFaceStatus('Face not enrolled for this volunteer.');
      return;
    }
    setFaceStatus('Look at the camera');
    await startCamera();
    await new Promise(r => setTimeout(r, 500));
    let attempts = 0;
    let isDetecting = false;
    faceIntervalRef.current = setInterval(async () => {
      if (isDetecting || !videoRef.current) return;
      isDetecting = true;
      attempts++;
      try {
        const det = await faceapi
          .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det) {
          if (attempts % 8 === 0) setFaceStatus('No face detected. Move closer.');
          return;
        }
        const saved = new Float32Array(Object.values(vol.faceDescriptor) as number[]);
        const dist = faceapi.euclideanDistance(det.descriptor, saved);
        if (dist < 0.5) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          // ✅ Face matched — delegate to shared sign-in/sign-out helper
          // so the direct-tap path (face verify OFF) and the face-verify
          // path land in exactly the same Firestore writes.
          setVerifyingVolunteer(null);
          setFaceStatus('');
          await toggleVolunteerSession(vol);
        } else if (attempts > 40) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          setFaceStatus('Face not recognised. Please try again.');
        } else {
          setFaceStatus(dist < 0.65 ? 'Almost... hold still' : 'Verifying...');
        }
      } catch {
      } finally {
        isDetecting = false;
      }
    }, 350);
  };

  // ─────────────────────────────
  // OTP TRIGGER
  // ─────────────────────────────
  const triggerOtp = async (member: any) => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(otp);
    await updateDoc(doc(db, 'clubs', clubId, 'members', member.id), {
      receptionOtp: otp,
      receptionOtpAt: serverTimestamp(),
      receptionOtpUsed: false,
    });
  };

  // ─────────────────────────────
  // OTP VERIFY
  // ─────────────────────────────
  const verifyOtp = async () => {
    if (otpInput !== generatedOtp) {
      setOtpError('Incorrect OTP');
      return;
    }
    if (otpPinInput !== clubPin) {
      setOtpError('Incorrect reception PIN');
      return;
    }
    const pendingOtp = pendingCheckins.find(p => p.memberId === selectedMember.id);
    setOtpInput('');
    setOtpPinInput('');
    setOtpError('');
    showSuccess(
      `Welcome, ${selectedMember.name?.split(' ')[0] || 'Member'}! 🎉`,
      'Verified via OTP ✅',
      () => setScreen('member_dashboard')
    );
    // Clear OTP + mark attendance in the background — these don't gate
    // the welcome screen, so don't make the receptionist wait on them.
    void Promise.all([
      updateDoc(doc(db, 'clubs', clubId, 'members', selectedMember.id), {
        receptionOtp: null,
        receptionOtpUsed: true,
      }),
      markAttendance(selectedMember, pendingOtp?.items),
    ]).catch((e) => console.error('[verifyOtp bg]', e));
  };

  // ─────────────────────────────
  // ORDER SHAKE
  // ─────────────────────────────
  const orderShake = async (item: any) => {
    if (!selectedMember || !memberWallet) return;
    const price = item.price || 0;
    const oldBalance = memberWallet.balance || 0;
    if (oldBalance < price) {
      setOrderMessage('❌ Insufficient balance');
      setTimeout(() => setOrderMessage(''), 3000);
      return;
    }
    const batch = writeBatch(db);
    batch.update(
      doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data'),
      { balance: increment(-price), updatedAt: serverTimestamp() }
    );
    const itemLabel = item.name || item.itemName || 'Shake';
    const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
    batch.set(txRef, {
      type: 'debit', amount: price, reason: 'shake_order',
      description: `Order: ${itemLabel}`,
      balanceAfter: oldBalance - price,
      createdAt: serverTimestamp(),
    });
    const orderRef = doc(collection(db, 'clubs', clubId, 'orders'));
    batch.set(orderRef, {
      memberId: selectedMember.id, memberName: selectedMember.name || selectedMember.fullName || '',
      memberPhoto: memberPhotoOf(selectedMember),
      items: [{ itemName: itemLabel, qty: 1, price }],
      totalAmount: price, totalCost: price, status: 'pending', source: 'reception',
      date: new Date().toISOString().slice(0, 10), clubId,
      createdAt: serverTimestamp(),
    });
    if (item.stockType === 'limited' && (item.remainingStock || 0) > 0) {
      batch.update(doc(db, 'clubs', clubId, 'todaysSpecial', item.id), { remainingStock: increment(-1) });
    }
    await batch.commit();

    // Invoice
    try {
      await logInvoice(clubId, selectedMember.id, {
        type: 'shake_order',
        title: `Shake — ${itemLabel}`,
        items: [{ description: itemLabel, qty: 1, rate: price, amount: price }],
        paymentMethod: 'wallet',
      });
    } catch (e) { console.warn('Invoice write failed', e); }

    setSessionLog(prev => [...prev, { type: 'shake', label: itemLabel, amount: price, oldBalance, newBalance: oldBalance - price }]);
    setOrderMessage(`✅ ${itemLabel} ordered!`);
    setTimeout(() => setOrderMessage(''), 3000);
  };

  // ─────────────────────────────
  // CART
  // ─────────────────────────────
  const addToCart = (item: any) => {
    setCart(prev => {
      const ex = prev.find(c => c.id === item.id);
      if (ex) return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const cartTotal = cart.reduce((s, c) => s + (c.price * c.qty), 0);

  const proceedCartCheckout = async () => {
    if (!selectedMember || !memberWallet) return;
    const oldBalance = memberWallet.balance || 0;
    if (oldBalance < cartTotal) {
      setOrderMessage('❌ Insufficient wallet balance');
      setShowCartCheckout(false);
      setShowBuyModal(false);
      setTimeout(() => setOrderMessage(''), 3000);
      return;
    }
    const batch = writeBatch(db);
    batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data'), {
      balance: increment(-cartTotal), updatedAt: serverTimestamp(),
    });
    for (const item of cart) {
      const itemLabel = item.name || item.itemName || 'Product';
      const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
      batch.set(txRef, {
        type: 'debit', amount: (item.price || 0) * item.qty, reason: 'product',
        description: `Bought: ${itemLabel} x${item.qty}`,
        balanceAfter: oldBalance - cartTotal,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();

    // Invoice for cart checkout
    try {
      await logInvoice(clubId, selectedMember.id, {
        type: 'product_sale',
        title: 'Cart Checkout',
        items: cart.map(c => ({
          description: c.name || c.itemName || 'Product',
          qty: c.qty,
          rate: c.price || 0,
          amount: (c.price || 0) * c.qty,
        })),
        paymentMethod: 'wallet',
      });
    } catch (e) { console.warn('Invoice write failed', e); }

    setSessionLog(prev => [...prev, {
      type: 'products',
      items: cart.map(c => ({ name: c.name || c.itemName, qty: c.qty, price: c.price })),
      total: cartTotal, oldBalance, newBalance: oldBalance - cartTotal,
    }]);
    setCart([]);
    setShowCartCheckout(false);
    setShowBuyModal(false);
    setOrderMessage(`✅ ${cart.length} item(s) purchased!`);
    setTimeout(() => setOrderMessage(''), 3000);
  };

  // ─────────────────────────────
  // WALLET TOP-UP (core logic — called after verification)
  // ─────────────────────────────
  const completeTopup = async (verifiedBy: string) => {
    const amount = Number(topupAmount);
    if (!amount || amount <= 0 || !selectedMember) return;
    const tp = topupPayment;
    const cashAmt = tp.method === 'cash' ? amount : tp.method === 'split' ? tp.cashAmount : 0;
    const upiAmt = tp.method === 'upi' ? amount : tp.method === 'split' ? tp.upiAmount : 0;
    const methodLabel = tp.method === 'split'
      ? `Split: Cash Rs.${cashAmt} + UPI Rs.${upiAmt}`
      : tp.method === 'upi' ? `UPI${tp.upiAccountName ? ` (${tp.upiAccountName})` : ''}` : 'Cash';
    const walletRef = doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data');
    const current = memberWallet?.balance || 0;

    // One batch (single round-trip) for wallet + transaction + first-topup
    // activation, instead of 3 sequential awaits. Invoice runs in background.
    const batch = writeBatch(db);
    batch.set(walletRef, { balance: current + amount, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions')), {
      type: 'credit',
      amount,
      reason: 'manual_topup',
      description: `Reception top-up (${methodLabel}) — verified by ${verifiedBy}`,
      balanceAfter: current + amount,
      approvedBy: verifiedBy,
      paymentMethod: tp.method,
      cashAmount: cashAmt,
      upiAmount: upiAmt,
      ...(tp.method !== 'cash' && tp.upiAccountId ? {
        upiAccountId: tp.upiAccountId,
        upiAccountName: tp.upiAccountName ?? null,
        upiNumber: tp.upiNumber ?? null,
      } : {}),
      createdAt: serverTimestamp(),
    });
    if (!selectedMember.isPermanent) {
      batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id), {
        isPermanent: true,
        isActiveMember: true,
        memberType: 'permanent',
        status: 'active',
        activatedAt: serverTimestamp(),
        activatedBy: 'first_topup',
      });
    }

    // Record the money. Cash was physically collected here but nothing was ever
    // written to `payments`, so a top-up taken at the desk added to the member's
    // balance and showed as zero revenue in Today's Report and in Reports.
    // Safe to record: this path never creates a `topupRequests` doc, so it
    // cannot double-count against the top-up tally Reports keeps from that
    // collection (the member-app request flow is the one that lives there).
    addPaymentToBatch(batch, {
      clubId,
      type: 'wallet_topup',
      amount,
      method: tp.method === 'upi' ? 'upi' : tp.method === 'split' ? 'split' : 'cash',
      cashAmount: cashAmt,
      upiAmount: upiAmt,
      ...(tp.upiAccountId ? {
        upiAccount: { id: tp.upiAccountId, accountName: tp.upiAccountName ?? undefined, number: tp.upiNumber ?? undefined },
      } : {}),
      memberId: selectedMember.id,
      memberName: selectedMember.name || '',
      humanMemberId: selectedMember.memberId || '',
      description: `Wallet top-up (${methodLabel}) — verified by ${verifiedBy}`,
      source: 'reception',
    });
    // Reflect success in the UI IMMEDIATELY from captured values (the success
    // screen reads the sessionLog entry below, not live wallet state), then
    // persist in the BACKGROUND so the receptionist never waits on the
    // (slow-network) write.
    setTopupVerifiedBy(verifiedBy);
    setSessionLog(prev => [...prev, {
      type: 'topup', amount, oldBalance: current, newBalance: current + amount,
      paymentMethod: tp.method, cashAmount: cashAmt, upiAmount: upiAmt, upiAccountName: tp.upiAccountName,
    }]);
    setTopupSuccess(true);
    setTopupAmount('');
    setTopupPin('');
    setTopupPayment({ method: 'cash', cashAmount: 0, upiAmount: 0 });

    // Persist wallet + transaction (+ first-topup activation) in the background.
    batch.commit()
      .then(() => {
        // Invoice — write-only, also background.
        void logInvoice(clubId, selectedMember.id, {
          type: 'wallet_topup',
          title: 'Wallet Top-up',
          items: [{ description: `Wallet top-up (${methodLabel})`, qty: 1, rate: amount, amount: amount }],
          paymentMethod: tp.method,
          paymentReference: tp.method === 'split'
            ? `Cash Rs.${cashAmt} + UPI Rs.${upiAmt}${tp.upiAccountName ? ` (${tp.upiAccountName})` : ''}`
            : tp.method === 'upi' && tp.upiAccountName
              ? `UPI · ${tp.upiAccountName} · ${tp.upiNumber ?? ''}`
              : undefined,
          notes: `Verified by ${verifiedBy}`,
        }).catch((e) => console.warn('Invoice write failed', e));
      })
      .catch((e) => console.error('[topup commit bg]', e));
  };

  // ─────────────────────────────
  // PLAN PURCHASE AT RECEPTION (cash — verified by accountant)
  // ─────────────────────────────
  const completePlanPurchase = async (verifiedBy: string, pmMethod?: 'cash' | 'upi', pmUpiAccount?: any) => {
    if (!selectedMember || !clubId) {
      console.error('[completePlanPurchase] missing member or clubId', { selectedMember, clubId });
      return;
    }
    // ── Sell once, whatever happens ──────────────────────────────────────
    // Three screens call this, and a firm press on a tablet can fire twice.
    // Each extra run added another set of credits, another payment and
    // another invoice for one renewal. Guarding here rather than at each
    // button means every present and future caller is covered.
    if (planPurchaseInFlightRef.current) {
      console.warn('[completePlanPurchase] ignored duplicate submit');
      return;
    }
    planPurchaseInFlightRef.current = true;
    try {
    if (!purchasePlanId) {
      console.error('[completePlanPurchase] no purchasePlanId set');
      alert('No plan selected. Please pick a plan again.');
      return;
    }
    // Always re-read the plan from Firestore to get the latest visits/price
    // (the cached clubMemberships list may be stale or missing fields).
    let plan: any = null;
    try {
      const planSnap = await getDoc(doc(db, 'clubs', clubId, 'memberships', purchasePlanId));
      plan = planSnap.exists() ? { id: planSnap.id, ...planSnap.data() } : null;
    } catch (e) {
      console.error('[completePlanPurchase] failed to load plan', e);
    }
    if (!plan) plan = clubMemberships.find(p => p.id === purchasePlanId);
    if (!plan) {
      console.error('[completePlanPurchase] plan not found', { purchasePlanId });
      alert('Plan not found. Please reselect.');
      return;
    }
    // Shared credit rule: totalVisits → visits → durationDays (a 25-day plan
    // with no explicit credit count grants 25 credits). See utils/planCredits.
    const planVisits = planCreditsOf(plan);
    // A plan marked "no shake credits" is a real product — membership access
    // without shakes — and must be sellable. Only stop when the plan grants
    // nothing AND nobody said that was intentional, which means the credit
    // count was simply never filled in.
    if (planVisits <= 0 && !planGrantsNoCredits(plan)) {
      console.error('[completePlanPurchase] plan has no visits set', plan);
      alert(`The plan "${plan.name}" has 0 shake credits configured. Open Settings → Memberships and either set the Shake Credits (or a Valid Duration), or tick "This plan gives no shake credits" if that is deliberate.`);
      return;
    }
    // The split selection is the source of truth when the desk used the
    // picker; the old single-method arguments still work for the PIN-fallback
    // and accountant callers that never had a split to offer.
    const rawMethod: 'cash' | 'upi' | 'split' = pmMethod || planPayment.method || paymentMethod || 'cash';
    const pUpi = pmUpiAccount || selectedUpiAccount;
    // Normalised against the price read fresh from Firestore a moment ago.
    // The split was validated in the picker against the plan price held in
    // `clubMemberships`, which is fetched ONCE when the screen mounts — a
    // reception tablet left open all day holds the morning's prices. If the
    // owner repriced the plan in between, the split described the old price
    // and the amount was the new one, so the parts did not add up to the whole.
    const tender = normalizeTender(
      Number(plan.price) || 0,
      rawMethod,
      planPayment.cashAmount,
      planPayment.upiAmount,
    );
    const pMethod = tender.paymentMethod;
    const planPrice = tender.amount;
    const cashAmount = tender.cashAmount;
    const upiAmount = tender.upiAmount;
    const batch = writeBatch(db);
    const memberRef = doc(db, 'clubs', clubId, 'members', selectedMember.id);

    // Capped denominator: shakeCreditsPlanTotal = current credits + new plan
    // visits (no longer grows forever). Also flag Lucky-Dip eligibility for
    // the Awards page if member still had ≥1 credit at renewal time AND the
    // plan opted in via its `luckyDipEligible` flag.
    // Net-add to the current balance, including negatives (−3 + 25 = 22).
    const currentCredits = Number((selectedMember as any).shakeCredits) || 0;
    const newPlanTotal = currentCredits + planVisits;
    const wasLuckyDipEligible = currentCredits >= 1 && (plan as any).luckyDipEligible === true;

    batch.update(memberRef, {
      status: 'active',
      isActiveMember: true,
      isPermanent: true,
      shakeCredits: newPlanTotal,
      shakeCreditsPlanTotal: newPlanTotal,
      // Renewing here used to set credits and status and nothing else — no
      // plan, no start, no expiry. The member ended up with credits but a blank
      // or stale expiry, showing as Expired in the admin list and leaving the
      // reception panel unable to price a shake at the plan rate. The same plan
      // bought through Add Credits or the voice assistant set the dates
      // correctly, which is why renewing "worked in one place and not another".
      ...membershipUpdate(plan, (selectedMember as any)?.membershipEndDate ?? (selectedMember as any)?.membershipEnd),
      updatedAt: serverTimestamp(),
    });
    const payDesc = pMethod === 'split'
      ? `${plan.name} plan (Split: Cash ₹${cashAmount} + UPI ₹${upiAmount}${pUpi ? ` — ${pUpi.app}` : ''}) — verified by ${verifiedBy}`
      : pMethod === 'upi' && pUpi
        ? `${plan.name} plan (UPI: ${pUpi.app} ${pUpi.number}) — verified by ${verifiedBy}`
        : `${plan.name} plan (cash) — verified by ${verifiedBy}`;
    const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
    batch.set(txRef, {
      type: 'credit',
      amount: plan.price || 0,
      reason: 'plan_purchase',
      description: payDesc,
      approvedBy: verifiedBy,
      planId: plan.id,
      planName: plan.name,
      paymentMethod: pMethod,
      ...(pUpi ? { upiAccountId: pUpi.id, upiApp: pUpi.app, upiNumber: pUpi.number, upiHolderName: pUpi.holderName } : {}),
      creditsAdded: planVisits,
      creditsBeforeRenewal: currentCredits,
      wasLuckyDipEligible,
      createdAt: serverTimestamp(),
    });
    // Daily-report payment record — add to the SAME batch so member + txn +
    // payment all commit in one round-trip (was a separate sequential addDoc).
    // LOCAL date: toISOString() is UTC, and IST is +5:30, so a renewal taken
    // before 05:30 was filed under the previous club day.
    const todayStr = todayLocal();
    batch.set(doc(collection(db, 'clubs', clubId, 'payments')), {
      type: 'plan_purchase',
      memberId: selectedMember.id,
      memberName: selectedMember.name,
      amount: planPrice,
      paymentMethod: pMethod,
      cashAmount,
      upiAmount,
      ...(pUpi ? { upiAccountId: pUpi.id, upiApp: pUpi.app, upiNumber: pUpi.number, upiHolderName: pUpi.holderName } : {}),
      description: payDesc,
      planName: plan.name,
      date: todayStr,
      creditsBeforeRenewal: currentCredits,
      wasLuckyDipEligible,
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (commitErr: any) {
      console.error('[completePlanPurchase] batch.commit failed', commitErr);
      alert(`Failed to add credits: ${commitErr?.message || commitErr}`);
      return;
    }

    // Invoice for plan purchase — background (write-only, not needed to proceed).
    void logInvoice(clubId, selectedMember.id, {
      type: 'plan_purchase',
      title: `${plan.name} Plan Purchase`,
      items: [{
        description: `${plan.name}${plan.durationDays ? ` — ${plan.durationDays} days` : ''}${planVisits ? ` · ${planVisits} shake credits` : ''}`,
        qty: 1,
        rate: plan.price || 0,
        amount: plan.price || 0,
      }],
      paymentMethod: pMethod,
      paymentReference: pUpi ? `UPI · ${pUpi.app} · ${pUpi.number}` : undefined,
      notes: `Verified by ${verifiedBy}`,
    }).catch((e) => console.warn('Invoice write failed', e));

    // Update local state so dashboard refreshes (accumulate credits)
    setSelectedMember((prev: any) => ({
      ...prev,
      // Mirror the Firestore write: both fields = newPlanTotal so the UI
      // shows "26/26" not "26/50" after a renewal.
      shakeCredits: newPlanTotal,
      shakeCreditsPlanTotal: newPlanTotal,
    }));
    setMemberPlan(plan);
    setPlanPurchaseVerifiedBy(verifiedBy);
    setPlanPurchaseSuccess(true);
    setSessionLog(prev => [...prev, { type: 'plan_purchase', planName: plan.name, amount: plan.price, verifiedBy, paymentMethod: pMethod }]);
    } finally {
      // Released on every exit, including the early returns above — a
      // validation failure must not lock the plan out for the rest of the day.
      planPurchaseInFlightRef.current = false;
    }
  };

  // ─────────────────────────────
  // ONE-DAY SHAKE PURCHASE
  // ─────────────────────────────
  const completeOneDayShake = async (verifiedBy: string) => {
    if (!oneDayShakeItem || oneDayShakeSaving) return;
    setOneDayShakeSaving(true);
    try {
      const ONEDAY_PRICE = 240;
      // Days the customer paid for upfront. 1 = today only. >1 = today
      // served + (days-1) carried forward as `oneDayShakeCredits` on the
      // member doc, auto-redeemed on future visits.
      const daysPaid = Math.max(1, oneDayShakeDays || 1);
      const totalPrice = ONEDAY_PRICE * daysPaid;
      const extraDays = daysPaid - 1;
      const daysSuffix = daysPaid > 1 ? ` × ${daysPaid} days (₹${totalPrice})` : '';
      const pMethod: 'cash' | 'upi' | 'split' = oneDayPayment.method || 'cash';
      const pUpi = (pMethod === 'upi' || pMethod === 'split') && oneDayPayment.upiAccountId
        ? upiAccounts.find((u: any) => u.id === oneDayPayment.upiAccountId) || null
        : null;
      const todayStr = todayLocal();
      // Through the shared rule, against the FULL price. Historic records here
      // stored one day's price beside a multi-day amount — a ₹480 two-day
      // shake taken in cash carrying cashAmount 240 — and the ₹240 shortfall
      // was then reported as UPI. Twenty-six such records exist.
      const oneDayTender = normalizeTender(totalPrice, pMethod, oneDayPayment.cashAmount, oneDayPayment.upiAmount);
      const cashAmount = oneDayTender.cashAmount;
      const upiAmount = oneDayTender.upiAmount;
      const payDesc = pMethod === 'split'
        ? `One-day shake: ${oneDayShakeItem.itemName || oneDayShakeItem.name}${daysSuffix} (Split: Cash ₹${cashAmount} + UPI ₹${upiAmount}) — verified by ${verifiedBy}`
        : pUpi
          ? `One-day shake: ${oneDayShakeItem.itemName || oneDayShakeItem.name}${daysSuffix} (UPI: ${pUpi.app} ${pUpi.number}) — verified by ${verifiedBy}`
          : `One-day shake: ${oneDayShakeItem.itemName || oneDayShakeItem.name}${daysSuffix} (Cash) — verified by ${verifiedBy}`;

      // Reserve a sequential token number for the kitchen + a receipt id for the customer.
      // Same pattern as proceedShakeCheckout / guest flow so the printed slip and the
      // KitchenDisplay card share the same identifier.
      const tokenNumber = await getNextOrderNumber(clubId);
      const receiptNumber = generateTxnId();
      const shakeName = oneDayShakeItem.itemName || oneDayShakeItem.name || 'Shake';

      // Everything that MUST persist for this sale goes in ONE batch — a single
      // round-trip instead of 5-6 sequential awaits. Chaining these awaits is
      // what made the accountant tap hang ~20-30s on a slow connection.
      const batch = writeBatch(db);

      // Payment record — amount is the FULL prepaid total (₹240 × days).
      batch.set(doc(collection(db, 'clubs', clubId, 'payments')), {
        type: 'oneday_shake',
        memberId: selectedMember?.id || null,
        memberName: selectedMember?.name || 'Walk-in',
        amount: totalPrice,
        daysPaid,
        unitPrice: ONEDAY_PRICE,
        paymentMethod: pMethod,
        cashAmount,
        upiAmount,
        ...(pUpi ? { upiAccountId: pUpi.id, upiApp: pUpi.app, upiNumber: pUpi.number, upiHolderName: pUpi.holderName } : {}),
        description: payDesc,
        shakeName: oneDayShakeItem.itemName || oneDayShakeItem.name,
        receiptNumber,
        tokenNumber,
        date: todayStr,
        createdAt: serverTimestamp(),
      });

      // Order record — match normal order structure so KitchenDisplay renders consistently
      batch.set(doc(collection(db, 'clubs', clubId, 'orders')), {
        memberId: selectedMember?.id || 'walk-in',
        memberName: selectedMember?.name || 'Walk-in',
        memberPhoto: memberPhotoOf(selectedMember),
        items: [{
          productId: oneDayShakeItem.id || '',
          itemName: shakeName,
          productName: shakeName,
          qty: 1,
          quantity: 1,
          price: ONEDAY_PRICE,
          pricePerUnit: ONEDAY_PRICE,
          notes: '',
        }],
        totalAmount: ONEDAY_PRICE,
        totalCost: ONEDAY_PRICE,
        status: 'pending',
        source: 'reception',
        paymentMethod: `oneday_${pMethod}`,
        tokenNumber,
        verifiedBy,
        date: todayStr,
        clubId,
        createdAt: serverTimestamp(),
      });

      // Deduct limited stock if needed
      if (oneDayShakeItem.stockType === 'limited' && oneDayShakeItem.id) {
        batch.update(doc(db, 'clubs', clubId, 'todaysSpecial', oneDayShakeItem.id), {
          remainingStock: increment(-1),
        });
      }

      // If member, record in their transactions, bump usage counters, and
      // bank the extra prepaid days (everything past today) on the member
      // doc as `oneDayShakeCredits` for future redeem.
      if (selectedMember?.id) {
        batch.set(doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions')), {
          type: 'debit',
          amount: totalPrice,
          reason: 'oneday_shake',
          daysPaid,
          description: payDesc,
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id), {
          lastOneDayShakeAt: serverTimestamp(),
          oneDayShakeCount: increment(1),
          // Today's shake is consumed now; the rest carry forward.
          ...(extraDays > 0 ? { oneDayShakeCredits: increment(extraDays) } : {}),
        });
      }

      await batch.commit();

      // Invoice — write-only and not needed for the next screen, so log it in
      // the background (don't make the receptionist wait on it).
      if (selectedMember?.id) {
        void logInvoice(clubId, selectedMember.id, {
          type: 'shake_order',
          title: daysPaid > 1
            ? `One-Day Shake × ${daysPaid} days — ${oneDayShakeItem.itemName || oneDayShakeItem.name}`
            : `One-Day Shake — ${oneDayShakeItem.itemName || oneDayShakeItem.name}`,
          items: [{
            description: daysPaid > 1
              ? `${oneDayShakeItem.itemName || oneDayShakeItem.name} (1 served today + ${extraDays} prepaid)`
              : oneDayShakeItem.itemName || oneDayShakeItem.name || 'One-day shake',
            qty: daysPaid,
            rate: ONEDAY_PRICE,
            amount: totalPrice,
          }],
          paymentMethod: pMethod,
          paymentReference: pUpi ? `UPI · ${pUpi.app} · ${pUpi.number}` : undefined,
          notes: `Verified by ${verifiedBy}`,
        }).catch((e) => console.warn('Invoice write failed', e));
      }

      // Auto-print kitchen token slip + customer payment receipt in one RawBT job —
      // same pattern as the guest order flow (ReceptionGuestWizard) and the regular
      // shake checkout (proceedShakeCheckout). Wrapped in try/catch so a printer error
      // never blocks the order itself, which has already been written above.
      try {
        const now = new Date();
        const printedName = selectedMember?.name || selectedMember?.fullName || 'Walk-in';
        const printedPhone = selectedMember?.phone || selectedMember?.mobile || '';
        const upiAccountName = pUpi ? `${pUpi.app}${pUpi.holderName ? ` (${pUpi.holderName})` : ''}` : undefined;

        const tokenToggles = getCachedShakeTokenToggles(clubId);
        fetchClubAndPrint(clubId, (freshClub) => {
          const lines: string[] = [];
          // 1. Kitchen shake token (suppressed if owner turned it off)
          if (tokenToggles.printShakeToken) {
            lines.push(...buildShakeTokenReceipt({
              memberName: printedName,
              items: [{ name: shakeName, qty: 1 }],
              tokenNumber,
              timestamp: now,
            }));
          }
          // 2. Afresh token (refreshment counter — suppressed if owner turned it off)
          if (tokenToggles.printRefreshmentToken) {
            lines.push(...buildAfreshToken({
              memberName: printedName,
              tokenNumber,
              timestamp: now,
            }));
          }
          // 3. Customer payment receipt (always printed — it's proof of payment).
          // Receipt line shows qty=daysPaid so a 2-day purchase prints as
          // "Shake × 2  ₹240  ₹480" rather than hiding the multiplier.
          lines.push(...buildGuestPaymentReceipt({
            club: freshClub,
            guestName: printedName,
            guestPhone: printedPhone,
            items: [{
              name: daysPaid > 1 ? `${shakeName} (1 today + ${extraDays} prepaid)` : shakeName,
              qty: daysPaid,
              unitPrice: ONEDAY_PRICE,
              total: totalPrice,
            }],
            totalAmount: totalPrice,
            amountPaid: totalPrice,
            paymentMethod: pMethod,
            cashAmount,
            upiAmount,
            upiAccountName,
            upiNumber: pUpi?.number,
            receiptNumber,
            tokenNumbers: [String(tokenNumber)],
            timestamp: now,
          }));
          return lines;
        });
      } catch (printErr) {
        console.error('[oneday shake print]', printErr);
      }

      setOneDayShakeVerifiedBy(verifiedBy);
      setOneDayShakeStep('done');
      setShowOneDayShake(true);
      if (selectedMember) {
        setSessionLog(prev => [...prev, {
          type: 'oneday_shake',
          label: daysPaid > 1
            ? `${oneDayShakeItem.itemName || oneDayShakeItem.name} × ${daysPaid} days`
            : (oneDayShakeItem.itemName || oneDayShakeItem.name),
          amount: totalPrice,
          verifiedBy,
        }]);
      }
    } catch (err: any) {
      setOrderMessage('❌ ' + (err?.message || 'Failed to save one-day shake'));
    } finally {
      setOneDayShakeSaving(false);
    }
  };

  // ─────────────────────────────
  // ONE-DAY SHAKE — REDEEM PREPAID DAY
  // Used when the member already has `oneDayShakeCredits > 0` from a
  // previous multi-day purchase. No payment doc, no accountant verify —
  // just decrement the credit, create the kitchen order, print the token.
  // ─────────────────────────────
  const redeemOneDayShake = async (shake?: any) => {
    // Accept the shake directly so callers don't have to wait for a
    // setOneDayShakeItem state-flush before invoking us. Falls back to
    // the state-held item for any future call site that already set it.
    const item = shake || oneDayShakeItem;
    if (!item || !selectedMember?.id || oneDayShakeRedeeming) return;
    setOneDayShakeItem(item); // keep state in sync for the 'done' screen
    setOneDayShakeRedeeming(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const tokenNumber = await getNextOrderNumber(clubId);
      const shakeName = item.itemName || item.name || 'Shake';

      // Order record — flagged as a redemption so reports can distinguish
      // a prepaid-day shake from a paid one (same kitchen flow either way).
      await addDoc(collection(db, 'clubs', clubId, 'orders'), {
        memberId: selectedMember.id,
        memberName: selectedMember.name || '',
        memberPhoto: memberPhotoOf(selectedMember),
        items: [{
          productId: item.id || '',
          itemName: shakeName,
          productName: shakeName,
          qty: 1,
          quantity: 1,
          price: 0,
          pricePerUnit: 0,
          notes: 'prepaid one-day shake',
        }],
        totalAmount: 0,
        totalCost: 0,
        status: 'pending',
        source: 'reception',
        paymentMethod: 'oneday_prepaid',
        oneDayShakeRedemption: true,
        tokenNumber,
        date: todayStr,
        clubId,
        createdAt: serverTimestamp(),
      });

      // Stock decrement (same as paid path)
      if (item.stockType === 'limited' && item.id) {
        await updateDoc(doc(db, 'clubs', clubId, 'todaysSpecial', item.id), {
          remainingStock: increment(-1),
        });
      }

      // Decrement prepaid credit + log to transactions for audit
      await updateDoc(doc(db, 'clubs', clubId, 'members', selectedMember.id), {
        oneDayShakeCredits: increment(-1),
        lastOneDayShakeAt: serverTimestamp(),
        oneDayShakeCount: increment(1),
      });
      await addDoc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'), {
        type: 'shake_redemption',
        amount: 0,
        reason: 'oneday_prepaid',
        description: `Redeemed prepaid one-day shake — ${shakeName}`,
        createdAt: serverTimestamp(),
      });

      // Print kitchen token (no payment receipt — nothing was charged)
      try {
        const now = new Date();
        const printedName = selectedMember.name || selectedMember.fullName || 'Member';
        const tokenToggles = getCachedShakeTokenToggles(clubId);
        fetchClubAndPrint(clubId, () => {
          const lines: string[] = [];
          if (tokenToggles.printShakeToken) {
            lines.push(...buildShakeTokenReceipt({
              memberName: printedName,
              items: [{ name: shakeName, qty: 1 }],
              tokenNumber,
              timestamp: now,
            }));
          }
          if (tokenToggles.printRefreshmentToken) {
            lines.push(...buildAfreshToken({
              memberName: printedName,
              tokenNumber,
              timestamp: now,
            }));
          }
          return lines;
        });
      } catch (printErr) {
        console.error('[oneday redeem print]', printErr);
      }

      // Refresh the in-memory member so the dashboard / button counts
      // reflect the new credit balance immediately (without a reload).
      setSelectedMember((prev: any) => prev ? {
        ...prev,
        oneDayShakeCredits: Math.max(0, (Number(prev.oneDayShakeCredits) || 0) - 1),
      } : prev);

      setOneDayShakeVerifiedBy('Prepaid redemption');
      setOneDayShakeStep('done');
      setSessionLog(prev => [...prev, {
        type: 'oneday_shake',
        label: `${shakeName} (prepaid day)`,
        amount: 0,
        verifiedBy: 'prepaid',
      }]);
    } catch (err: any) {
      setOrderMessage('❌ ' + (err?.message || 'Failed to redeem prepaid day'));
    } finally {
      setOneDayShakeRedeeming(false);
    }
  };

  // ─────────────────────────────
  // WALLET TOP-UP — PIN fallback
  // ─────────────────────────────
  const handleTopupPin = async () => {
    if (verifyActionRef.current !== 'plan_purchase' && verifyActionRef.current !== 'oneday_shake') {
      const amount = Number(topupAmount);
      if (!amount || amount <= 0) {
        setTopupPinError('Enter a valid amount');
        return;
      }
    }
    if (walletPin && topupPin !== walletPin) {
      setTopupPinError('Incorrect wallet PIN');
      return;
    }
    if (!walletPin && topupPin !== clubPin) {
      setTopupPinError('Incorrect PIN');
      return;
    }
    if (verifyActionRef.current === 'plan_purchase') {
      await completePlanPurchase('PIN (fallback)');
      verifyActionRef.current = 'topup';
      setPlanPurchaseSuccess(true);
      setShowPlanPurchase(true);
      setScreen('member_dashboard');
    } else if (verifyActionRef.current === 'oneday_shake') {
      await completeOneDayShake('PIN (fallback)');
      verifyActionRef.current = 'topup';
      setScreen(selectedMember ? 'member_dashboard' : 'home');
    } else {
      await completeTopup('PIN (fallback)');
    }
  };

  // ─────────────────────────────
  // ACCOUNTANT FACE VERIFICATION
  // ─────────────────────────────
  const startAccountantFaceVerification = async (accountant: any) => {
    if (!modelsLoaded) {
      setFaceStatus('Face models still loading...');
      return;
    }
    // Accountants are loaded from clubs/{clubId}/accountants with their full
    // doc (including faceDescriptor) via the snapshot listener, so the
    // descriptor is already on the object when enrolled. Fail fast if it's
    // missing — do NOT fall back to a getDoc against the members collection:
    // an accountant's id is not a member id, so that read either misses or
    // hangs on a pending auth/network state, freezing on "Starting camera…".
    const faceDescriptor = accountant.faceDescriptor;
    if (!faceDescriptor) {
      setFaceStatus(`No face enrolled for ${accountant.name || 'this accountant'}. Enroll their face in Settings first.`);
      return;
    }
    const accWithFace = { ...accountant, faceDescriptor };
    setVerifyingAccountant(accWithFace);
    setFaceStatus('Look at the camera');
    await startCamera();
    await new Promise(r => setTimeout(r, 500));
    let attempts = 0;
    let isDetecting = false;
    faceIntervalRef.current = setInterval(async () => {
      if (isDetecting || !videoRef.current) return;
      isDetecting = true;
      attempts++;
      try {
        const det = await faceapi
          .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det) {
          if (attempts % 8 === 0) setFaceStatus('No face detected. Move closer.');
          return;
        }
        const saved = new Float32Array(Object.values(accWithFace.faceDescriptor) as number[]);
        const dist = faceapi.euclideanDistance(det.descriptor, saved);
        if (dist < 0.5) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          const accountantName = accWithFace.name || 'Accountant';
          setFaceStatus('');
          setVerifyingAccountant(null);
          if (verifyActionRef.current === 'plan_purchase') {
            await completePlanPurchase(accountantName);
            verifyActionRef.current = 'topup';
            setPlanPurchaseSuccess(true);
            setShowPlanPurchase(true);
            setScreen('member_dashboard');
          } else if (verifyActionRef.current === 'oneday_shake') {
            await completeOneDayShake(accountantName);
            verifyActionRef.current = 'topup';
            setScreen(selectedMember ? 'member_dashboard' : 'home');
          } else {
            await completeTopup(accountantName);
            setScreen('topup');
          }
        } else if (attempts > 40) {
          clearInterval(faceIntervalRef.current);
          stopCamera();
          setFaceStatus('Face not recognised. Please try again.');
        } else if (attempts % 12 === 0) {
          setFaceStatus('Still scanning... hold steady');
        }
      } catch {
      } finally {
        isDetecting = false;
      }
    }, 300);
  };

  // Face verification disabled for accountants: tapping an accountant records
  // them as the approver and completes the action immediately. Same routing as
  // the (now-skipped) face-match path. Guarded against double-taps so the
  // payment write can't fire twice.
  const completeWithAccountant = async (accountant: any) => {
    if (accountantApprovingRef.current) return;
    accountantApprovingRef.current = true;
    try {
      stopCamera();
      const accountantName = accountant?.name || 'Accountant';
      setFaceStatus('');
      setVerifyingAccountant(null);
      const action = verifyActionRef.current;
      verifyActionRef.current = 'topup';
      // Navigate to the success/next screen IMMEDIATELY and run the payment
      // writes in the BACKGROUND. The complete* fns read their inputs
      // synchronously when called, so backgrounding them is safe — this is what
      // removes the multi-second wait after tapping the accountant (the writes
      // are slow only because of network latency, not logic).
      // The payment writes run in the background so the screen stays instant.
      // The guard must therefore be released when the WRITE finishes, not when
      // this function returns — the body is synchronous, so the old `finally`
      // cleared the flag microseconds after setting it and two quick taps on
      // the accountant's name produced TWO payments for one renewal. Credits are
      // written as an absolute total, so the member looked correct and only the
      // report showed the doubled amount.
      const release = () => { accountantApprovingRef.current = false; };

      if (action === 'plan_purchase') {
        setPlanPurchaseSuccess(true);
        setShowPlanPurchase(true);
        setScreen('member_dashboard');
        void completePlanPurchase(accountantName)
          .catch((e) => console.error('[plan purchase bg]', e))
          .finally(release);
      } else if (action === 'oneday_shake') {
        setScreen(selectedMember ? 'member_dashboard' : 'home');
        void completeOneDayShake(accountantName)
          .catch((e) => console.error('[oneday bg]', e))
          .finally(release);
      } else {
        setScreen('topup');
        void completeTopup(accountantName)
          .catch((e) => console.error('[topup bg]', e))
          .finally(release);
      }
    } catch (e) {
      // Something threw before a write was even started — let the next tap try.
      accountantApprovingRef.current = false;
      throw e;
    }
  };

  // ─────────────────────────────
  // FACE ENROLLMENT
  // ─────────────────────────────
  const captureEnrollPhoto = async () => {
    // Enrollment is ALWAYS available — it does not depend on the face
    // verification toggle (you can enrol faces even while verification is off).
    if (!videoRef.current) { setEnrollStatus('⚠️ Camera not ready. Go back and try again.'); return; }
    if (!modelsLoaded) { setEnrollStatus('⏳ Face models loading, please wait…'); return; }
    try {
      const det = await faceapi
        .detectSingleFace(videoRef.current, FACE_DETECTOR_OPTS)
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!det) {
        setEnrollStatus('No face detected. Move closer and try again.');
        return;
      }
      const updated = [...enrollPhotos, Array.from(det.descriptor)];
      setEnrollPhotos(updated);
      setEnrollStatus(`Photo ${updated.length}/3 ✅`);
      if (updated.length >= 3) {
        setEnrollStatus('Saving… please wait');
        const avg = updated[0].map((_, i) =>
          updated.reduce((s, d) => s + d[i], 0) / updated.length
        );
        // Capture profile photo from video frame
        let photoUrl: string | null = null;
        try {
          if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 200;
            const ctx2d = canvas.getContext('2d');
            if (ctx2d) {
              const v = videoRef.current;
              const size = Math.min(v.videoWidth, v.videoHeight);
              const sx = (v.videoWidth - size) / 2;
              const sy = (v.videoHeight - size) / 2;
              ctx2d.drawImage(v, sx, sy, size, size, 0, 0, 200, 200);
              photoUrl = canvas.toDataURL('image/jpeg', 0.6);
            }
          }
        } catch {}
        // Build update payload
        const updatePayload: any = {
          // Keep the average for anything still reading the old single field.
          faceDescriptor: avg,
          // …but also keep the three captures themselves, and match against the
          // CLOSEST one rather than the average.
          //
          // Averaging is why enrolment got worse the more carefully staff
          // followed the "three different angles" instruction. A face
          // descriptor is a point in 128 dimensions; the mean of three poses
          // is a point that can sit between all of them and resemble none —
          // so the better the angle spread, the worse the stored template.
          // Some members ended up permanently unrecognisable.
          // Wrapped one level, as [{v:[…]}, {v:[…]}, {v:[…]}]. Firestore
          // refuses an array that directly contains another array — writing
          // the raw [[…],[…],[…]] threw "Nested arrays are not supported" and
          // took the whole enrolment down with it. An array of maps is fine,
          // and a map may hold an array.
          faceDescriptors: updated.map(d => ({ v: d })),
          faceEnrolledAt: serverTimestamp(),
          // Both field names, via the shared writer. Enrolment used to set only
          // `photoUrl`, and the member app only sets `photo` — with most
          // screens reading `photoUrl` first, an enrolment here permanently
          // overrode whatever the member later uploaded on their phone.
          ...(photoUrl ? memberPhotoFields(photoUrl) : {}),
        };
        // Save shake credits if plan selected during enrollment
        if (enrollPlanId) {
          const plan = clubMemberships.find(p => p.id === enrollPlanId);
          if (plan) {
            // Net-add to any existing balance (same rule as every other
            // renewal path) instead of overwriting it.
            const planCredits = planCreditsOf(plan);
            const existingMember = members.find(m => m.id === enrollMemberId);
            const currentCredits = Number((existingMember as any)?.shakeCredits) || 0;
            const newTotal = currentCredits + planCredits;
            updatePayload.status = 'active';
            updatePayload.isActiveMember = true;
            updatePayload.isPermanent = true;
            updatePayload.shakeCredits = newTotal;
            updatePayload.shakeCreditsPlanTotal = newTotal;
          }
        }
        try {
          await updateDoc(doc(db, 'clubs', clubId, 'members', enrollMemberId), updatePayload);

          // Record the enrollment payment so the money shows up in Today's
          // Report and Reports. The member update alone never logged it — this
          // mirrors completePlanPurchase's payment + transaction writes.
          if (enrollPlanId) {
            const payPlan = clubMemberships.find(p => p.id === enrollPlanId);
            const payMember = members.find(m => m.id === enrollMemberId);
            const payAmount = Number(payPlan?.price) || 0;
            if (payPlan && payAmount > 0) {
              const todayStr = todayLocal();
              const enrolTender = normalizeTender(payAmount, enrollPayMethod);
              const planCredits = planCreditsOf(payPlan);
              const payDesc = `${payPlan.name} plan (${enrollPayMethod}) — face enrollment`;
              try {
                await addDoc(collection(db, 'clubs', clubId, 'payments'), {
                  type: 'plan_purchase',
                  memberId: enrollMemberId,
                  memberName: payMember?.name || '',
                  humanMemberId: payMember?.memberId || '',
                  amount: enrolTender.amount,
                  paymentMethod: enrolTender.paymentMethod,
                  cashAmount: enrolTender.cashAmount,
                  upiAmount: enrolTender.upiAmount,
                  description: payDesc,
                  planName: payPlan.name,
                  planId: payPlan.id,
                  date: todayStr,
                  source: 'face_enrollment',
                  createdAt: serverTimestamp(),
                });
                await addDoc(collection(db, 'clubs', clubId, 'members', enrollMemberId, 'transactions'), {
                  type: 'credit',
                  amount: payAmount,
                  reason: 'plan_purchase',
                  description: payDesc,
                  planId: payPlan.id,
                  planName: payPlan.name,
                  paymentMethod: enrollPayMethod,
                  creditsAdded: planCredits,
                  createdAt: serverTimestamp(),
                });
              } catch (payErr) {
                console.error('[enroll payment write]', payErr);
              }
            }
          }
          stopCamera();

          // Auto-print welcome slip — gives the new member a paper proof of
          // enrollment with their member ID and (if assigned) plan details.
          try {
            const enrolledMember = members.find(m => m.id === enrollMemberId);
            const plan = enrollPlanId ? clubMemberships.find(p => p.id === enrollPlanId) : null;
            const endDate = plan ? new Date() : undefined;
            if (endDate && plan) endDate.setDate(endDate.getDate() + (plan.durationDays || 30));
            fetchClubAndPrint(clubId, (freshClub) => buildMemberWelcomeSlip({
              club: freshClub,
              memberName: enrolledMember?.name || 'Member',
              memberId: enrolledMember?.memberId || enrollMemberId,
              phone: enrolledMember?.phone,
              planName: plan?.name,
              planValidUntil: endDate,
              shakeCredits: plan ? planCreditsOf(plan) : undefined,
              timestamp: new Date(),
            }));
          } catch (printErr) {
            console.error('[welcome slip print]', printErr);
          }

          showSuccess('Face Enrolled!', enrollPlanId ? 'Face + shake credits saved' : 'Member can now use face login', () => {
            setScreen('home');
            setEnrollMemberId('');
            setEnrollPhotos([]);
            setEnrollStatus('');
            setEnrollPlanId('');
            setEnrollPayMethod('cash');
            setEnrollDaysUsed('');
            setEnrollSearch('');
          });
        } catch (saveErr: any) {
          setEnrollPhotos([]);
          setEnrollStatus('❌ Save failed: ' + (saveErr?.message || 'please try again'));
        }
      }
    } catch (detectErr: any) {
      setEnrollStatus('❌ Detection error: ' + (detectErr?.message || 'please try again'));
    }
  };

  // ─────────────────────────────
  // SHAKE CART
  // ─────────────────────────────
  const shakeCartTotal = shakeCart.reduce((s, c) => s + (c.price * c.qty), 0);

  const selectShake = (item: any, ice: 'with ice' | 'without ice') => {
    setShakeCart(prev => {
      // toggle off if same item + same ice
      if (prev.length === 1 && prev[0].id === item.id && prev[0].icePreference === ice) return [];
      return [{ ...item, qty: 1, icePreference: ice }];
    });
  };

  const proceedShakeCheckout = async (cartOverride?: any[], opts?: { skipFinalize?: boolean }) => {
    const cart = cartOverride ?? shakeCart;
    if (!selectedMember || isCheckingOut || cart.length === 0) return;
    const totalQty = cart.reduce((s: number, i: any) => s + (i.qty || 1), 0);
    const GRACE_LIMIT = -5;

    // ── Guard against double-charging one shake ──────────────────────────
    // A member who pre-ordered on the app has already had credits deducted
    // when reception confirmed their queue card (completePendingCheckin).
    // Ordering again at the desk deducts a SECOND time for the same shake.
    // Reception can't see the earlier order from here, so ask outright.
    const priorShakes = todayOrders.filter((o: any) =>
      o.paymentMethod === 'shake_credits' && o.status !== 'cancelled' && o.status !== 'rejected');
    if (priorShakes.length > 0) {
      const tokens = priorShakes.map((o: any) => `#${o.tokenNumber ?? '—'}`).join(', ');
      const ok = window.confirm(
        `${selectedMember.name || 'This member'} already has ${priorShakes.length} shake order(s) today (${tokens}).\n\n` +
        `Ordering again will use ${totalQty} more credit${totalQty === 1 ? '' : 's'}.\n\n` +
        `Is this an ADDITIONAL shake?`
      );
      if (!ok) return;
    }

    setIsCheckingOut(true);
    const cachedCredits: number = Number(selectedMember.shakeCredits ?? 0);

    // ── Optimistic UI: update credits + close modal immediately so the
    // receptionist sees the result before any network round-trips. The
    // authoritative balance is read below; this is display only.
    setSelectedMember((prev: any) => prev ? { ...prev, shakeCredits: cachedCredits - totalQty } : prev);
    setShakeCart([]); setShowShakeCheckout(false); setShowOrderModal(false);
    setOrderMessage(`✅ Shake ordered!`);

    let currentCredits = cachedCredits;
    try {
      // Read the LIVE credit balance rather than trusting the copy held on
      // screen — that copy goes stale the moment credits change on another
      // device, which made both the grace check and the `creditsAfter`
      // written into the member's history wrong. Runs in parallel with the
      // token reservation, so it costs nothing.
      //
      // One token per shake unit: a 4-shake cart yields [101,102,103,104],
      // not a single "person ×4" card.
      const [memberSnap, tokenNumbers] = await Promise.all([
        getDoc(doc(db, 'clubs', clubId, 'members', selectedMember.id)),
        getNextOrderNumbers(clubId, totalQty),
      ]);
      currentCredits = Number(memberSnap.data()?.shakeCredits ?? cachedCredits);

      // Unified grace credit validation — same rule as mobile app
      if ((currentCredits - totalQty) < GRACE_LIMIT) {
        setSelectedMember((prev: any) => prev ? { ...prev, shakeCredits: currentCredits } : prev);
        setShakeCart(cart);   // give the cart back so it needn't be re-keyed
        setOrderMessage('❌ No shake credits remaining. Please renew plan.');
        setIsCheckingOut(false);
        setTimeout(() => setOrderMessage(''), 3000);
        return;
      }
      setSelectedMember((prev: any) => prev ? { ...prev, shakeCredits: currentCredits - totalQty } : prev);

      const batch = writeBatch(db);

      // Always deduct from shake credits (can go negative up to grace limit)
      batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id), {
        shakeCredits: increment(-totalQty),
      });

      const todayStr = new Date().toISOString().slice(0, 10);
      // Track per-unit (item, ice, tokenNumber) for the print job.
      const printUnits: Array<{ name: string; ice: string; tokenNumber: string | number }> = [];
      let tIdx = 0;
      for (const item of cart) {
        const itemLabel = item.name || item.itemName || 'Shake';
        const perShakePrice = memberPlan && (memberPlan.visits || 0) > 0
          ? Math.round((memberPlan.price || 0) / memberPlan.visits)
          : (item.price || 0);
        // One transaction + one order doc per individual shake — kitchen
        // and audit trails should both see distinct units.
        for (let q = 0; q < (item.qty || 1); q++) {
          const tokenNumber = tokenNumbers[tIdx++];
          const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
          batch.set(txRef, { type: 'shake_credit', amount: 1, reason: 'shake_order', description: `Shake: ${itemLabel}`, creditsAfter: currentCredits - totalQty, tokenNumber, createdAt: serverTimestamp() });
          const orderRef = doc(collection(db, 'clubs', clubId, 'orders'));
          batch.set(orderRef, { memberId: selectedMember.id, memberName: selectedMember.name || selectedMember.fullName || '', memberPhoto: memberPhotoOf(selectedMember), items: [{ productId: item.id || item.itemId || '', itemName: itemLabel, productName: itemLabel, qty: 1, quantity: 1, price: perShakePrice, pricePerUnit: perShakePrice, notes: item.icePreference || '' }], totalAmount: perShakePrice, totalCost: perShakePrice, status: 'pending', source: 'reception', paymentMethod: 'shake_credits', creditsUsed: 1, tokenNumber, date: todayStr, clubId, createdAt: serverTimestamp() });
          printUnits.push({ name: itemLabel, ice: item.icePreference || '', tokenNumber });
        }
        if (item.stockType === 'limited' && (item.remainingStock || 0) > 0) {
          batch.update(doc(db, 'clubs', clubId, 'todaysSpecial', item.id), { remainingStock: increment(-item.qty) });
        }
      }

      // Fire print job in parallel with the commit. One slip per token
      // so the kitchen and refreshment counter get distinct chits.
      const printPromise = (async () => {
        try {
          const printedName = selectedMember.name || selectedMember.fullName || '';
          const now = new Date();
          for (const u of printUnits) {
            printShakeAndAfresh(clubId, {
              shake: buildShakeTokenReceipt({
                memberName: printedName,
                items: [{ name: u.name, qty: 1, ice: u.ice }],
                tokenNumber: String(u.tokenNumber),
                timestamp: now,
              }),
              afresh: buildAfreshToken({
                memberName: printedName,
                tokenNumber: String(u.tokenNumber),
                timestamp: now,
              }),
            });
          }
        } catch (printErr) {
          console.error('[shake token print]', printErr);
        }
      })();

      await Promise.all([batch.commit(), printPromise]);

      // Navigate home after a brief beat so the receptionist can see
      // the success toast before the screen swaps. Skipped when called
      // from the unified confirmAllPending flow so the caller can
      // commit other carts (products) before navigating away.
      if (!opts?.skipFinalize) {
        trackTimer(setTimeout(() => { goHome(); }, 600));
      }
    } catch (e: any) {
      // Roll back optimistic state if Firestore commit fails, and hand the
      // cart back so the receptionist doesn't have to re-key the order.
      setSelectedMember((prev: any) => prev ? { ...prev, shakeCredits: currentCredits } : prev);
      setShakeCart(cart);
      setOrderMessage(`❌ ${e?.message || 'Order failed — please try again'}`);
      setTimeout(() => setOrderMessage(''), 3000);
    } finally {
      setIsCheckingOut(false);
    }
  };

  // ─────────────────────────────
  // COMMIT PRODUCTS CART (wallet · cash · upi · split)
  // ─────────────────────────────
  // Single-batch commit for the pending products cart. Handles all four
  // payment methods. Wallet path debits the member's wallet; cash/UPI/split
  // record a `payments/` doc instead. Inventory + per-member transactions
  // are written for every method.
  const commitProductsCart = async (
    pCart: any[],
    payMethod: 'wallet' | 'cash' | 'upi' | 'split',
    pay: TopupPaymentSelection,
  ) => {
    if (!selectedMember || pCart.length === 0) return;
    const total = pCart.reduce((s, c) => s + (c.price || 0) * c.qty, 0);
    const oldBalance = memberWallet?.balance || 0;
    if (payMethod === 'wallet' && oldBalance < total) {
      throw new Error('Insufficient wallet balance');
    }
    const batch = writeBatch(db);
    const now = serverTimestamp();
    const todayStr = todayLocal();

    if (payMethod === 'wallet') {
      batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data'), {
        balance: increment(-total), updatedAt: now,
      });
    }

    // Which cart lines exist in `inventory`. Checked up front because a batch
    // update against a document that isn't there rejects the entire batch — the
    // sale, the payment and the member transaction would all vanish together.
    const inventoryIds = new Set<string>();
    await Promise.all(pCart.map(async (item: any) => {
      if (!item?.id) return;
      try {
        const s = await getDoc(doc(db, 'clubs', clubId, 'inventory', item.id));
        if (s.exists()) inventoryIds.add(item.id);
      } catch { /* not in inventory — skip the stock step, keep the sale */ }
    }));

    // Per-product: member transaction, a sale record, and the stock coming off
    // the shelf.
    //
    // This flow used to write only the money. Nothing landed in `productSales`
    // and nothing left inventory — which is why a report could show
    // "Products ₹2,700" next to "Products sold: 0 units", and why stock counts
    // drifted from reality whenever items were sold at the desk rather than
    // through the Sell Product screen.
    const todayForSales = new Date().toISOString().slice(0, 10);
    for (const item of pCart) {
      const itemLabel = item.name || item.itemName || 'Product';
      const lineTotal = (item.price || 0) * item.qty;
      const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
      batch.set(txRef, {
        type: 'debit', amount: lineTotal, reason: 'product',
        description: `Bought: ${itemLabel} x${item.qty} (${payMethod})`,
        ...(payMethod === 'wallet' ? { balanceAfter: oldBalance - total } : {}),
        paymentMethod: payMethod,
        productId: item.id, productName: itemLabel,
        createdAt: now,
      });

      // Sale record, so "products sold" and the product breakdown are real.
      const saleRef = doc(collection(db, 'clubs', clubId, 'productSales'));
      batch.set(saleRef, {
        id: saleRef.id,
        clubId,
        productId: item.id || '',
        productName: itemLabel,
        quantity: item.qty,
        unit: item.unit || '',
        price: item.price || 0,
        totalAmount: lineTotal,
        buyerId: selectedMember.id,
        buyerName: selectedMember.name || '',
        isGift: false,
        paymentMethod: payMethod,
        soldBy: 'reception',
        date: todayForSales,
        createdAt: now,
      });

      // Take it off the shelf. Only for items that exist in `inventory` — the
      // cart can also hold entries from the older `products` list, and an
      // update against a missing document would reject the whole batch and
      // lose the sale.
      if (item.id && inventoryIds.has(item.id)) {
        batch.update(doc(db, 'clubs', clubId, 'inventory', item.id), {
          quantity: increment(-item.qty),
          updatedAt: now,
        });
      }
    }

    // Single payment record (covers the whole cart) when not wallet
    if (payMethod !== 'wallet') {
      // Normalised against the LIVE cart total. The split was validated when
      // the payment chooser was open, but the summary screen behind it still
      // has +/- buttons and "Add more" — so the cart could change afterwards
      // and this wrote, say, amount 800 with a 200/300 split. The parts are
      // forced to equal the whole here; the guard above stops it silently.
      const tender = normalizeTender(total, payMethod, pay.cashAmount, pay.upiAmount);
      const upiFields: Record<string, string> = {};
      if (tender.upiAmount > 0 && pay.upiAccountId) {
        upiFields.upiAccountId = pay.upiAccountId;
        if (pay.upiAccountName) upiFields.upiAccountName = pay.upiAccountName;
        if (pay.upiNumber) upiFields.upiNumber = pay.upiNumber;
      }
      const payRef = doc(collection(db, 'clubs', clubId, 'payments'));
      batch.set(payRef, {
        type: 'product_sale',
        memberId: selectedMember.id,
        memberName: selectedMember.name || '',
        amount: tender.amount,
        paymentMethod: tender.paymentMethod,
        cashAmount: tender.cashAmount,
        upiAmount: tender.upiAmount,
        ...upiFields,
        description: `Cart: ${pCart.map(c => `${c.name || c.itemName}×${c.qty}`).join(', ')}`,
        date: todayStr, createdAt: now,
      });
    }

    await batch.commit();

    // Invoice + session log (post-commit, fire-and-forget)
    try {
      await logInvoice(clubId, selectedMember.id, {
        type: 'product_sale',
        title: 'Cart Checkout',
        items: pCart.map(c => ({
          description: c.name || c.itemName || 'Product',
          qty: c.qty, rate: c.price || 0, amount: (c.price || 0) * c.qty,
        })),
        paymentMethod: payMethod === 'wallet' ? 'wallet' : payMethod,
      });
    } catch (e) { console.warn('Invoice write failed', e); }

    setSessionLog(prev => [...prev, {
      type: 'products',
      items: pCart.map(c => ({ name: c.name || c.itemName, qty: c.qty, price: c.price })),
      total,
      ...(payMethod === 'wallet' ? { oldBalance, newBalance: oldBalance - total } : {}),
      paymentMethod: payMethod,
    }]);
  };

  // ─────────────────────────────
  // CONFIRM ALL PENDING (Done ✓ → final review → confirm)
  // ─────────────────────────────
  const confirmAllPending = async () => {
    if (isCheckingOut) return;
    setIsCheckingOut(true);
    try {
      // Products first so we can rely on proceedShakeCheckout's navigate
      // behavior (or our own goHome below) to wrap up.
      if (cart.length > 0 && productsPayMethod) {
        await commitProductsCart(cart, productsPayMethod, productsPayment);
        setCart([]);
        setProductsPayMethod(null);
        setProductsPayment(emptyPaymentSelection);
      }
      if (shakeCart.length > 0) {
        await proceedShakeCheckout(shakeCart, { skipFinalize: true });
      }
      setOrderMessage('✅ Order confirmed!');
      trackTimer(setTimeout(() => { goHome(); }, 600));
    } catch (e: any) {
      setOrderMessage(`❌ ${e?.message || 'Confirm failed — please try again'}`);
      setTimeout(() => setOrderMessage(''), 3000);
    } finally {
      setIsCheckingOut(false);
    }
  };

  // ─────────────────────────────
  // VISIT EMOJI
  // ─────────────────────────────
  const getVisitEmoji = (remaining: number): string => {
    if (remaining > 5) return '😊';
    if (remaining === 5) return '🙂';
    if (remaining === 4) return '😐';
    if (remaining === 3) return '🙁';
    if (remaining === 2) return '😤';
    if (remaining === 1) return '😠';
    return '😱';
  };

  // ─────────────────────────────
  // (printReceipt removed — was dead code, use printSummary via RawBT below)

  // ─────────────────────────────
  // BUY PRODUCT
  // ─────────────────────────────
  const buyProduct = async (item: any) => {
    if (!selectedMember || !memberWallet) return;
    const price = item.price || 0;
    if ((memberWallet.balance || 0) < price) {
      setOrderMessage('❌ Insufficient wallet balance');
      setShowBuyModal(false);
      setTimeout(() => setOrderMessage(''), 3000);
      return;
    }
    const batch = writeBatch(db);
    batch.update(doc(db, 'clubs', clubId, 'members', selectedMember.id, 'wallet', 'data'), {
      balance: increment(-price), updatedAt: serverTimestamp(),
    });
    const txRef = doc(collection(db, 'clubs', clubId, 'members', selectedMember.id, 'transactions'));
    batch.set(txRef, {
      type: 'debit', amount: price, reason: 'product',
      description: `Bought: ${item.name || item.itemName}`,
      balanceAfter: (memberWallet.balance || 0) - price,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    setOrderMessage(`✅ ${item.name || item.itemName} purchased!`);
    setShowBuyModal(false);
    setTimeout(() => setOrderMessage(''), 3000);
  };

  // ─────────────────────────────
  // RESET to home
  // ─────────────────────────────
  const rejectOrder = useRejectOrder();
  const addGuestEntry = useAddGuestEntry();

  // ─────────────────────────────
  // EDIT FROM TODAY'S ACTIVITY DRAWER
  // ─────────────────────────────
  // When the receptionist taps Edit on a row in the home-page drawer,
  // we want to drop them back into that member's profile review screen
  // with the order's items restored as pending — so they can change
  // shake type, qty, add a product, etc., then Confirm All to re-commit.
  // The original record is reversed (rejected/soft-deleted) so credits
  // and stock refund cleanly before the new commit.
  const editFromTodayHistory = async (row: { kind: 'order' | 'payment'; raw: any }) => {
    const r = row.raw;
    const memberId: string | undefined = r.memberId;
    if (!memberId) {
      setOrderMessage('❌ Cannot edit walk-in / guest entries — cancel and re-create.');
      setTimeout(() => setOrderMessage(''), 3000);
      return;
    }
    try {
      // 1. Load the member doc + wallet so the dashboard renders correctly.
      const memSnap = await getDoc(doc(db, 'clubs', clubId, 'members', memberId));
      if (!memSnap.exists()) {
        setOrderMessage('❌ Member not found');
        setTimeout(() => setOrderMessage(''), 3000);
        return;
      }
      const member = { id: memSnap.id, ...memSnap.data() } as any;
      setSelectedMember(member);

      // 2. Restore the cart from the row.
      if (row.kind === 'order') {
        // Shake-credit / oneday order — restore shakeCart from items.
        const items = r.items || [];
        const restored = items.map((it: any) => ({
          id: it.productId || it.id || '',
          name: it.itemName || it.productName || 'Shake',
          itemName: it.itemName || it.productName || 'Shake',
          price: it.price || it.pricePerUnit || 0,
          qty: it.qty || it.quantity || 1,
          icePreference: '',
        }));
        setShakeCart(prev => [...prev, ...restored]);

        // 3. Reverse the original order so credits/stock refund.
        await rejectOrder.mutateAsync({
          clubId,
          orderId: r.id,
          rejectedBy: 'reception_edit',
          reason: 'Edit from today activity',
        });
      } else if (row.kind === 'payment') {
        const t = String(r.type || '');
        if (t === 'product_sale') {
          // Restore product cart with one line for the sold product.
          // Payment record only has aggregate info; pre-fill what we know.
          const restored = {
            id: r.productId || '',
            name: r.productName || (r.description || '').replace(/^Sold:\s*/i, '').replace(/\s*to .*/i, '').replace(/\s*x\d+.*/i, '') || 'Product',
            price: r.amount && r.quantity ? Math.round(r.amount / Math.max(1, r.quantity)) : (r.amount || 0),
            qty: r.quantity || 1,
          };
          setCart(prev => [...prev, restored]);
          setProductsPayMethod((r.paymentMethod as any) || 'cash');
          setProductsPayment({
            method: (r.paymentMethod === 'wallet' ? 'cash' : r.paymentMethod) as any,
            cashAmount: r.cashAmount ?? 0,
            upiAmount: r.upiAmount ?? 0,
            upiAccountId: r.upiAccountId,
            upiAccountName: r.upiAccountName,
            upiNumber: r.upiNumber,
          });
          // Soft-delete the original payment so it isn't double-counted.
          try {
            await updateDoc(doc(db, `clubs/${clubId}/payments`, r.id), {
              deleted: true, deletedAt: serverTimestamp(), deletedBy: 'reception_edit',
            });
            await deleteDoc(doc(db, `clubs/${clubId}/payments`, r.id));
          } catch {}
        } else {
          // Plan purchase / one-day shake / guest payment — these flows
          // have their own commit path that we don't restage here.
          setOrderMessage('ℹ️ Cancel and re-create from the member profile to change a plan / one-day shake.');
          setTimeout(() => setOrderMessage(''), 4000);
          return;
        }
      }

      // 4. Jump straight to the summary so the cashier can edit and confirm.
      setScreen('done_summary');
    } catch (err: any) {
      console.error('[editFromTodayHistory]', err);
      setOrderMessage(`❌ ${err?.message || 'Edit failed'}`);
      setTimeout(() => setOrderMessage(''), 3000);
    }
  };

  const goHome = () => {
    stopCamera();
    setScreen('home');
    setViewOnlyMode(false);
    setSelectedMember(null);
    setMemberWallet(null);
    setMemberPlan(null);
    setMemberAttendanceCount(0);
    setTodayOrders([]);
    setShowOrderModal(false);
    setShowBuyModal(false);
    setCart([]);
    setShowCartCheckout(false);
    setShakeCart([]);
    setShowShakeCheckout(false);
    setShowProductsPayment(false);
    setProductsPayMethod(null);
    setProductsPayment(emptyPaymentSelection);
    setPlanPayment(emptyPaymentSelection);
    setIsCheckingOut(false);
    setSessionLog([]);
    setMemberSearch('');
    setFaceStatus('');
    setFailCount(0);
    setOtpInput('');
    setOtpPinInput('');
    setOtpError('');
    setOrderMessage('');
    setTopupAmount('');
    setTopupPin('');
    setTopupPinError('');
    setTopupSuccess(false);
    setTopupVerifiedBy('');
    setShowPinFallback(false);
    setVerifyingAccountant(null);
    setShowNoCreditOptions(false);
    setShowPlanPurchase(false);
    setPurchasePlanId('');
    setPlanPurchaseSuccess(false);
    setPlanPurchaseVerifiedBy('');
    verifyActionRef.current = 'topup';
  };

  // ─────────────────────────────
  // SHARED STYLES
  // ─────────────────────────────
  const S = {
    page: { minHeight: '100vh', fontFamily: 'Nunito, sans-serif' } as React.CSSProperties,
    darkPage: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg,#0a1f14,#1a3a2a)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Nunito, sans-serif',
    } as React.CSSProperties,
    card: {
      background: 'white',
      borderRadius: 20,
      padding: '32px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
    } as React.CSSProperties,
    btn: (color = '#2d9653') => ({
      background: color,
      color: 'white',
      border: 'none',
      borderRadius: 12,
      padding: '14px 24px',
      fontSize: 15,
      fontWeight: 800,
      cursor: 'pointer',
      fontFamily: 'Nunito, sans-serif',
    } as React.CSSProperties),
    backBtn: {
      background: 'rgba(255,255,255,0.15)',
      border: 'none',
      color: 'white',
      borderRadius: 10,
      padding: '8px 18px',
      fontSize: 14,
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'Nunito, sans-serif',
      position: 'absolute',
      top: 20,
      left: 20,
    } as React.CSSProperties,
  };

  // ─────────────────────────────
  // SUCCESS OVERLAY
  // ─────────────────────────────
  if (successData) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#2d9653', zIndex: 999999,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Nunito, sans-serif', animation: 'fadeIn 0.3s ease',
      }}>
        <div style={{
          width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 72, marginBottom: 28, animation: 'popIn 0.4s ease',
        }}>✓</div>
        <div style={{ color: 'white', fontSize: 28, fontWeight: 900, textAlign: 'center', padding: '0 40px', marginBottom: 10 }}>
          {successData.message}
        </div>
        {successData.sub && (
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: 600 }}>{successData.sub}</div>
        )}
        <style>{`
          @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
          @keyframes popIn {
            0%  { transform:scale(0.5); opacity:0 }
            70% { transform:scale(1.15) }
            100%{ transform:scale(1); opacity:1 }
          }
        `}</style>
      </div>
    );
  }

  // ─────────────────────────────
  // PIN LOCK SCREEN
  // ─────────────────────────────
  if (!pinUnlocked) {
    return (
      <div style={S.darkPage}>
        <div style={{ ...S.card, width: 340, textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🖥️</div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>Reception</h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 28 }}>{clubName}</p>
          <PinDots value={pinInput} total={6} />
          <NumPad
            value={pinInput}
            maxLength={6}
            onChange={v => {
              setPinInput(v);
              setPinError('');
              if (v.length === 6) {
                setTimeout(() => {
                  if (v === clubPin) { setPinUnlocked(true); }
                  else { setPinError('Incorrect PIN'); setPinInput(''); }
                }, 200);
              }
            }}
          />
          {pinError && <p style={{ color: '#ef4444', fontSize: 14, fontWeight: 600, marginTop: 12 }}>{pinError}</p>}
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // HOME SCREEN
  // ─────────────────────────────
  if (screen === 'purchase_requests') {
    return (
      <PurchaseRequestsScreen
        clubId={contextClub?.id ?? clubId}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'home') {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good Morning ☀️' : hour < 17 ? 'Good Afternoon 🌤️' : 'Good Evening 🌙';
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg,#0a1f14 0%,#1a4a2e 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Nunito, sans-serif', padding: 40, position: 'relative',
      }}>
        {/* Hot Reload button — top-right corner */}
        <button
          onClick={() => window.location.reload()}
          title="Hot Reload — clears memory & resets face scanner"
          style={{
            position: 'absolute', top: 18, right: 18,
            background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.18)',
            borderRadius: 12, padding: '8px 14px', color: 'rgba(255,255,255,0.7)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif',
            display: 'flex', alignItems: 'center', gap: 6, letterSpacing: 0.5,
          }}
        >
          🔄 Hot Reload
        </button>

        {/* Lucky Dip counter — members running low on credits (top-left).
            Nudge them to renew before they hit 0 to keep Lucky Dip eligibility. */}
        <LuckyDipCounter
          members={members}
          onPick={(m) => { setSelectedMember(m); setScreen('member_dashboard'); }}
        />

        {/* Today's activity drawer (real-time orders + payments at this club) */}
        {clubId && <TodayActivityDrawer clubId={clubId} onEditRow={editFromTodayHistory} />}

        {/* Teams modal */}
        {showTeams && clubId && (
          <TeamsManager clubId={clubId} members={members} onClose={() => setShowTeams(false)} />
        )}

        {/* New Customer Gift Card Checklist (referral accountability) */}
        {showGiftCards && clubId && (
          <GiftCardChecklist clubId={clubId} members={members} onClose={() => setShowGiftCards(false)} />
        )}

        {/* Daily Club Usage — record product usage from Reception */}
        {showDailyUsage && clubId && (
          <DailyClubUsage clubId={clubId} onClose={() => setShowDailyUsage(false)} />
        )}

        {/* Magician — voice attendance & shake ordering (bottom-right floating mic) */}
        {clubId && (
          <MagicianButton
            clubId={clubId}
            receptionistId="reception_desk"
            receptionistName="Reception Desk"
            members={members}
            todaysSpecials={todaysSpecials}
            onOpenTodayReport={() => setShowTodayReport(true)}
            onOpenMemberProfile={(memberId) => {
              const m = members.find((x: any) => x.id === memberId);
              if (m) { setSelectedMember(m); setScreen('member_dashboard'); }
            }}
            onPrintTodayReport={() => {
              // Reuse the same "Print" affordance the modal uses by opening it —
              // the modal has its own print button. Future: trigger print directly.
              setShowTodayReport(true);
            }}
          />
        )}

        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 }}>{clubName}</div>
          <h1 style={{ color: 'white', fontSize: 42, fontWeight: 900, margin: 0, lineHeight: 1.1 }}>{greeting}</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 8 }}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Birthday / Anniversary wishes — today's celebrants at this club */}
        {clubId && (
          <div style={{ maxWidth: 560, width: '100%', marginBottom: 16 }}>
            <BirthdayWishBanner clubId={clubId} theme="dark" />
          </div>
        )}

        {/* Requests inbox button — appears prominently above the main grid when something is pending */}
        <button
          onClick={() => setScreen('purchase_requests')}
          style={{
            position: 'relative',
            maxWidth: 560,
            width: '100%',
            marginBottom: 20,
            background: pendingRequestCount > 0
              ? 'linear-gradient(135deg,#f59e0b,#d97706)'
              : 'rgba(255,255,255,0.07)',
            border: pendingRequestCount > 0 ? 'none' : '1px solid rgba(255,255,255,0.12)',
            borderRadius: 16,
            padding: '14px 20px',
            cursor: 'pointer',
            fontFamily: 'Nunito, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            boxShadow: pendingRequestCount > 0
              ? '0 8px 24px rgba(245,158,11,0.35)'
              : 'none',
            color: 'white',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 32, flexShrink: 0 }}>📨</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.2 }}>
              Requests
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600, marginTop: 2 }}>
              {pendingRequestCount > 0
                ? `${pendingRequestCount} member${pendingRequestCount !== 1 ? 's' : ''} waiting to pay`
                : 'No pending requests'}
            </div>
          </div>
          {pendingRequestCount > 0 && (
            <span
              style={{
                background: 'white',
                color: '#d97706',
                borderRadius: 999,
                minWidth: 28,
                height: 28,
                padding: '0 8px',
                fontSize: 13,
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {pendingRequestCount}
            </span>
          )}
          <span style={{ fontSize: 18, opacity: 0.6, flexShrink: 0 }}>›</span>
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 20, maxWidth: 560, width: '100%', marginBottom: 32 }}>
          <button
            onClick={() => { setViewOnlyMode(false); setMemberSearch(''); setScreen('member_grid'); }}
            style={{
              background: 'linear-gradient(135deg,#2d9653,#1a6e3c)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(45,150,83,0.4)', transition: 'transform 0.1s',
              position: 'relative',
            }}
          >
            {/* Pending pre-orders from member mobile app — count of members
                 waiting at reception with an unconfirmed shake order. */}
            {pendingCheckins.length > 0 && (
              <span
                style={{
                  position: 'absolute', top: -10, right: -10,
                  minWidth: 36, height: 36, borderRadius: 18,
                  background: '#ef4444', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 900,
                  padding: '0 10px',
                  boxShadow: '0 4px 12px rgba(239,68,68,0.5), 0 0 0 4px rgba(239,68,68,0.15)',
                  animation: 'magicianBadgePulse 1.6s ease-in-out infinite',
                  border: '2px solid white',
                  fontFamily: 'Nunito, sans-serif',
                }}
                aria-label={`${pendingCheckins.length} pre-order${pendingCheckins.length === 1 ? '' : 's'} waiting`}
              >
                {pendingCheckins.length > 99 ? '99+' : pendingCheckins.length}
              </span>
            )}
            <span style={{ fontSize: 52 }}>👤</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Member Check-in</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>
              {pendingCheckins.length > 0
                ? `${pendingCheckins.length} pre-order${pendingCheckins.length === 1 ? '' : 's'} waiting`
                : 'Face Recognition'}
            </span>
            <style>{`
              @keyframes magicianBadgePulse {
                0%, 100% { transform: scale(1); }
                50%      { transform: scale(1.1); }
              }
            `}</style>
          </button>

          <button
            onClick={() => setScreen('volunteer_grid')}
            style={{
              background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(99,102,241,0.4)',
            }}
          >
            <span style={{ fontSize: 52 }}>🙌</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Volunteer</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>Check-in / Check-out</span>
          </button>

          <button
            onClick={() => {
              setFdName(''); setFdPhone(''); setFdInviter(null);
              setFdInviterSearch(''); setFdLimitInfo(null); setFdResult(null);
              setScreen('first_day');
            }}
            style={{
              background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(245,158,11,0.4)',
            }}
          >
            <span style={{ fontSize: 52 }}>☀️</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>First Day</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>Complimentary Shake</span>
          </button>

          <button
            onClick={() => setScreen('virtual_grid')}
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(124,58,237,0.4)',
            }}
          >
            <span style={{ fontSize: 52 }}>💳</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Virtual Member</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>Add / Renew</span>
          </button>

          {/* Renewal — its own door at the desk. Renewing used to mean going
              into a member's profile and finding Buy Plan, which is why it was
              missed. Rose, so it is never confused with check-in (green),
              volunteer (indigo), first day (amber) or virtual (purple). */}
          <button
            onClick={() => { setRenewSearch(''); setSelectedMember(null); setScreen('renew_grid'); }}
            style={{
              background: 'linear-gradient(135deg,#e11d48,#9f1239)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(225,29,72,0.4)',
            }}
          >
            <span style={{ fontSize: 52 }}>🔄</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Renewal</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>Pick member → plan → accountant</span>
          </button>

          {/* Night Shake — the evening operation. Its own passes, its own
              money, its own report. Near-black indigo so it reads as a
              different part of the business, not another day-club action. */}
          <button
            onClick={() => setScreen('night_shake')}
            style={{
              background: 'linear-gradient(135deg,#312e81,#0b0f2a)', color: 'white', border: 'none',
              borderRadius: 20, padding: '36px 20px', cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              boxShadow: '0 8px 32px rgba(49,46,129,0.45)',
              gridColumn: '1 / -1',
            }}
          >
            <span style={{ fontSize: 52 }}>🌙</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>Night Shake</span>
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>Members · Passes · Tonight</span>
          </button>
        </div>

        {todaysSpecials.length > 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px 24px',
            maxWidth: 560, width: '100%', marginBottom: 20, backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ color: '#86efac', fontSize: 13, fontWeight: 800, marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
              ⭐ Today's Special
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {todaysSpecials.map(item => (
                <div key={item.id} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {item.imageUrl && <img src={item.imageUrl} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />}
                  <div>
                    <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{item.itemName}</div>
                    <div style={{ fontSize: 11, color: item.remainingStock === 0 ? '#fca5a5' : '#86efac', fontWeight: 600 }}>
                      {item.stockType === 'unlimited' ? '✅ Available' : item.remainingStock <= 0 ? '⛔ Sold Out' : `${item.remainingStock} left`}
                      {item.price ? `  ·  ₹${item.price}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Early Bird Photo ── */}
        {earlyBirdPhoto && (
          <div style={{
            maxWidth: 560, width: '100%', marginBottom: 20,
            borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(251,191,36,0.25)',
          }}>
            <img
              src={earlyBirdPhoto.photoUrl}
              alt="Early Bird"
              style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }}
            />
            <div style={{
              background: 'linear-gradient(135deg,#78350f,#d97706)',
              padding: '10px 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🐦</span>
                <span style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>Early Birds Today</span>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 700 }}>
                {(() => {
                  try {
                    const d = earlyBirdPhoto.uploadedAt?.toDate
                      ? earlyBirdPhoto.uploadedAt.toDate()
                      : new Date(earlyBirdPhoto.uploadedAt);
                    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                  } catch { return ''; }
                })()}
              </span>
            </div>
          </div>
        )}

        {/* ── Top Performer Banner ── */}
        {receptionLeaderboard[0] && (
          <div style={{ maxWidth: 560, width: '100%', marginBottom: 20 }}>
            <button
              onClick={() => setShowLeaderboard(true)}
              style={{
                width: '100%', background: 'linear-gradient(135deg,#1a3a2a,#2d9653)',
                border: 'none', borderRadius: 16, padding: '16px 20px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'Nunito, sans-serif',
                boxShadow: '0 4px 20px rgba(45,150,83,0.35)', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 28, flexShrink: 0 }}>🏆</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>This Week's Top Performer</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {receptionLeaderboard[0].memberPhoto ? (
                    <img src={receptionLeaderboard[0].memberPhoto} style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                      {receptionLeaderboard[0].memberName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>{receptionLeaderboard[0].memberName.split(' ')[0]}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                      {receptionLeaderboard[0].fatLost != null && (
                        <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>↓ {receptionLeaderboard[0].fatLost}% fat</span>
                      )}
                      {receptionLeaderboard[0].weightLost > 0 && (
                        <span style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>↓ {receptionLeaderboard[0].weightLost} kg</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18, flexShrink: 0 }}>›</div>
            </button>
          </div>
        )}

        {/* ── Leaderboard Overlay ── */}
        {showLeaderboard && (
          <div
            onClick={() => setShowLeaderboard(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: 'white', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 500, maxHeight: '80vh', overflowY: 'auto', padding: 24 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>🏆 This Week's Leaderboard</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Ranked by fat loss</p>
                </div>
                <button onClick={() => setShowLeaderboard(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {receptionLeaderboard.slice(0, 10).map((entry, idx) => (
                  <div key={entry.memberId} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    background: idx === 0 ? '#f0fdf4' : '#f9fafb',
                    border: `1.5px solid ${idx === 0 ? '#86efac' : '#e5e7eb'}`,
                    borderRadius: 14,
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 900, fontSize: 16, flexShrink: 0,
                      background: idx === 0 ? '#fef3c7' : idx === 1 ? '#f1f5f9' : idx === 2 ? '#fff7ed' : '#f9fafb',
                      color: idx === 0 ? '#d97706' : idx === 1 ? '#475569' : idx === 2 ? '#c2410c' : '#9ca3af',
                    }}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </div>
                    {entry.memberPhoto ? (
                      <img src={entry.memberPhoto} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#2d9653', flexShrink: 0 }}>
                        {entry.memberName.charAt(0)}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: '#1a3a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.memberName.split(' ')[0]}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, marginTop: 2 }}>
                        {entry.fatLost != null ? `↓ ${entry.fatLost}% fat` : ''}{entry.weightLost > 0 ? ` · ↓ ${entry.weightLost} kg` : ''}
                      </div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 18, color: '#2d9653', flexShrink: 0 }}>
                      {entry.fatLost != null ? `-${entry.fatLost}%` : `-${entry.weightLost} kg`}
                    </div>
                  </div>
                ))}
                {receptionLeaderboard.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>No data yet for this week</div>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => setScreen('enroll_select')}
          style={{
            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 24px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
          }}
        >
          📸 Enroll / Update Face
        </button>

        {modelsLoading && (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>
            Loading face recognition...
          </div>
        )}

        {/* Weight Check-in button */}
        {(() => {
          const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
          const isWeighInDay = (contextClub as any)?.weighInDays?.includes(todayDay) ?? false;
          const weighInActive = weighInOverride !== null ? weighInOverride : isWeighInDay;
          return weighInActive ? (
            <button
              onClick={() => setShowWeighIn(true)}
              style={{
                marginTop: 12,
                background: 'linear-gradient(135deg,#059669,#2d9653)', border: 'none',
                borderRadius: 12, padding: '12px 32px', color: 'white',
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
                boxShadow: '0 4px 16px rgba(5,150,105,0.4)',
              }}
            >⚖️ Weight Check-in</button>
          ) : null;
        })()}

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          style={{
            marginTop: 16,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 12, padding: '12px 32px', color: 'rgba(255,255,255,0.7)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
          }}
        >⚙️ Settings</button>

        {/* Weight Check-in Modal */}
        <BulkWeighIn open={showWeighIn} onClose={() => setShowWeighIn(false)} />

        {/* Add Shake Credits Modal */}
        {receptionAction === 'add_shake_credits' && clubId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}
            onClick={() => setReceptionAction(null)}
          >
            <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 0, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <AddShakeCredits clubId={clubId} upiAccounts={upiAccounts} onClose={() => setReceptionAction(null)} />
            </div>
          </div>
        )}

        {/* Sell Product Modal */}
        {receptionAction === 'sell_product' && clubId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}
            onClick={() => { setReceptionAction(null); setSellProductInitialName(null); }}
          >
            <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 0, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <SellProduct
                clubId={clubId}
                initialProductName={sellProductInitialName || undefined}
                onClose={() => { setReceptionAction(null); setSellProductInitialName(null); }}
              />
            </div>
          </div>
        )}

        {/* Add Guest Wizard */}
        {receptionAction === 'add_guest' && clubId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}
            onClick={() => setReceptionAction(null)}
          >
            <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 0, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <ReceptionGuestWizard clubId={clubId} faceVerificationEnabled={faceVerificationEnabled} onClose={() => setReceptionAction(null)} />
            </div>
          </div>
        )}

        {/* Today's Report Modal (reception → fully editable view) */}
        {showTodayReport && (
          <TodayReportModal onClose={() => setShowTodayReport(false)} />
        )}

        {/* Audit Entry Modal (manual payment for missed plan/shake) */}
        {showManualEntry && (
          <ManualEntryModal onClose={() => setShowManualEntry(false)} />
        )}

        {/* Remove Today's Volunteering — pick a present volunteer and clear ONLY
            their volunteer attendance for today (member check-in stays). */}
        {showRemoveVolunteer && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}
            onClick={() => setShowRemoveVolunteer(false)}>
            <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#1a3a2a' }}>🙅 Remove Today's Volunteering</h2>
                <button onClick={() => setShowRemoveVolunteer(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>✕</button>
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, marginTop: 0, marginBottom: 14 }}>
                Removes only today's volunteer attendance. The member's check-in stays marked.
              </p>
              {(() => {
                const todays = volunteerSessions.filter((s: any) => s.status === 'signed_in');
                if (todays.length === 0) {
                  return <div style={{ textAlign: 'center', color: '#9ca3af', padding: '24px 0', fontSize: 14 }}>No volunteers marked present today.</div>;
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {todays.map((s: any) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '10px 12px' }}>
                        {s.memberPhoto ? (
                          <img src={s.memberPhoto} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900 }}>{(s.memberName || '?').charAt(0).toUpperCase()}</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a2a' }}>{s.memberName || 'Volunteer'}</div>
                          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✅ Present{s.signInTime ? ` · ${s.signInTime}` : ''}{s.autoCheckedIn ? ' · auto' : ''}</div>
                        </div>
                        <button onClick={() => { void removeTodayVolunteering(s); }}
                          style={{ background: '#fee2e2', color: '#dc2626', border: '1.5px solid #fecaca', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Biometric Settings Panel */}
        {showSettings && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999,
          }}
            onClick={() => setShowSettings(false)}
          >
            <div
              style={{
                background: '#fff', borderRadius: '20px 20px 0 0', padding: 28,
                width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>⚙️ Settings</h2>
                <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>✕</button>
              </div>

              {/* ── Welcome voice ──────────────────────────────────
                   The tablet at the desk has its own set of installed
                   voices, so the automatic choice can only pick from what
                   is there. This lets the club overrule it without a code
                   change. Saved to this device only. */}
              <div style={{ background: '#fdf2f8', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#9d174d', marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>Welcome voice</div>
                <div style={{ fontSize: 12, color: '#9f1239', opacity: 0.8, marginBottom: 10, fontWeight: 600 }}>
                  Read aloud when you tap a member's face.
                </div>
                <select
                  value={preferredVoiceName}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPreferredVoiceName(v);
                    try { v ? localStorage.setItem('mnh_voice', v) : localStorage.removeItem('mnh_voice'); } catch { /* private mode */ }
                    speakWelcome('Ravi', v || null);
                  }}
                  style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1.5px solid #fbcfe8', fontSize: 14, fontWeight: 700, fontFamily: 'Nunito,sans-serif', background: 'white', color: '#9d174d' }}
                >
                  <option value="">Choose automatically (Indian female first)</option>
                  {availableVoices.map(v => (
                    <option key={v.name} value={v.name}>{v.name} · {v.lang}</option>
                  ))}
                </select>
                <button
                  onClick={() => speakWelcome('Ravi', preferredVoiceName || null)}
                  style={{ marginTop: 10, width: '100%', padding: '10px', background: 'white', border: '1.5px solid #fbcfe8', borderRadius: 10, fontSize: 13, fontWeight: 800, color: '#9d174d', cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                >
                  🔊 Hear it
                </button>
                {availableVoices.length === 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#9f1239', fontWeight: 600 }}>
                    This device has no English voices installed. Add one in the
                    device settings under Text-to-speech, then reopen this page.
                  </div>
                )}
              </div>

              {/* ── Quick Actions (most-used, top of panel) ── */}
              <div style={{ background: '#eff6ff', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#1e40af', marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>Quick Actions</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  <button
                    onClick={() => { setShowSettings(false); setReceptionAction('add_shake_credits'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🔄</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Renewal</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setSellProductInitialName(null); setReceptionAction('sell_product'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🛒</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Sell Product</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setSellProductInitialName('Dino'); setReceptionAction('sell_product'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🥤</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Dino Shake</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowTodayReport(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>📋</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Today's Report</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setReceptionAction('add_guest'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🧑‍🤝‍🧑</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Add Guest</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setOneDayShakeMemberSearch(''); setShowOneDayShakeMemberPicker(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>☕</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>One-Day Shake</div>
                  </button>
                  <button
                    onClick={() => { setShowVirtualSection(true); setVirtualTab('list'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>👤</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Virtual Members</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowManualEntry(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>📝</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Audit Entry</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowTeams(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>👥</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Teams</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); window.open('/owner/awards', '_blank'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🏆</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Awards</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); window.open('/owner/btc', '_blank'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🔥</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>BTC</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowGiftCards(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🎁</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Gift Cards</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowDailyUsage(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>📦</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Daily Club Usage</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setViewOnlyMode(true); setMemberSearch(''); setScreen('member_grid'); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🔍</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>View Member</div>
                  </button>
                  <button
                    onClick={() => { setShowSettings(false); setShowRemoveVolunteer(true); }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 8px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    <span style={{ fontSize: 28 }}>🙅</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', textAlign: 'center' }}>Remove Volunteering</div>
                  </button>
                </div>
              </div>

              {/* UPI Accounts Management */}
              {(() => {
                const [showUpiForm, setShowUpiForm] = [false, () => {}]; // placeholder — use inline state below
                return (
                  <div style={{ background: '#faf5ff', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: '#7c3aed', marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>UPI Accounts</div>
                    {upiAccounts.length === 0 ? (
                      <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>No UPI accounts added yet</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                        {upiAccounts.map((u: any) => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', borderRadius: 10, padding: '10px 12px', border: '1px solid #e9d5ff' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a' }}>{u.app}</div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>{u.number} · {u.holderName}</div>
                            </div>
                            <button onClick={async () => {
                              const updated = upiAccounts.filter((a: any) => a.id !== u.id);
                              setUpiAccounts(updated);
                              if (clubId) await updateDoc(doc(db, 'clubs', clubId), { upiAccounts: updated });
                            }} style={{ background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <UpiAddForm clubId={clubId} upiAccounts={upiAccounts} setUpiAccounts={setUpiAccounts} />
                  </div>
                );
              })()}

              {/* Weight Check-in Section */}
              {(() => {
                const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                const isWeighInDay = (contextClub as any)?.weighInDays?.includes(todayDay) ?? false;
                const weighInActive = weighInOverride !== null ? weighInOverride : isWeighInDay;
                const toggleWeighIn = async () => {
                  const newVal = !weighInActive;
                  setWeighInOverride(newVal);
                  // Persist to Firestore so member app can read it
                  if (clubId) {
                    try {
                      await updateDoc(doc(db, 'clubs', clubId), { weighInOpen: newVal });
                    } catch (e) { console.error('Failed to update weighInOpen', e); }
                  }
                };
                return (
                  <div style={{ background: '#f0fdf4', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: '#1a3a2a' }}>⚖️ Weight Check-in</div>
                        <div style={{ fontSize: 12, color: weighInActive ? '#16a34a' : '#6b7280', fontWeight: 600, marginTop: 3 }}>
                          {weighInActive
                            ? 'Weight check-in is OPEN — members can log weight'
                            : 'Weight check-in is CLOSED — members cannot log weight'}
                        </div>
                      </div>
                      <button
                        onClick={toggleWeighIn}
                        style={{
                          background: weighInActive ? '#fee2e2' : '#dcfce7',
                          color: weighInActive ? '#dc2626' : '#16a34a',
                          border: 'none', borderRadius: 8, padding: '8px 14px',
                          fontWeight: 700, cursor: 'pointer', fontSize: 12, flexShrink: 0,
                        }}
                      >{weighInActive ? 'Disable' : 'Enable'}</button>
                    </div>
                    {weighInActive && (
                      <button
                        onClick={() => { setShowSettings(false); setShowWeighIn(true); }}
                        style={{
                          width: '100%', background: '#2d9653', color: 'white', border: 'none',
                          borderRadius: 10, padding: '12px 0', fontWeight: 800, fontSize: 14,
                          cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
                        }}
                      >Open Weight Check-in →</button>
                    )}
                  </div>
                );
              })()}

              {/* Virtual Members (expandable) */}
              <div style={{ background: '#f0fdf4', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#1a3a2a' }}>👤 Virtual Members</div>
                  <button
                    onClick={() => setShowVirtualSection(!showVirtualSection)}
                    style={{ background: showVirtualSection ? '#fee2e2' : '#2d9653', color: showVirtualSection ? '#dc2626' : 'white', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >{showVirtualSection ? 'Close' : `Manage (${virtualMembers.length})`}</button>
                </div>
                {showVirtualSection && (
                  <div>
                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      {(['list', 'add', 'payment'] as const).map(tab => (
                        <button key={tab} onClick={() => setVirtualTab(tab)}
                          style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif',
                            background: virtualTab === tab ? '#2d9653' : '#e5e7eb', color: virtualTab === tab ? 'white' : '#374151' }}
                        >{tab === 'list' ? '📋 Members' : tab === 'add' ? '➕ Add New' : '💸 Payment'}</button>
                      ))}
                    </div>

                    {/* List tab */}
                    {virtualTab === 'list' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {virtualMembers.length === 0 ? (
                          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '12px 0' }}>No virtual members yet. Add one →</div>
                        ) : virtualMembers.map(vm => {
                          const vmEnd = vm.membershipEnd ? (vm.membershipEnd.toDate ? vm.membershipEnd.toDate() : new Date(vm.membershipEnd)) : null;
                          const vmDays = vmEnd ? Math.ceil((vmEnd.getTime() - Date.now()) / 86400000) : null;
                          return (
                          <div key={vm.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', borderRadius: 8, padding: '10px 12px', border: `1px solid ${vmDays !== null && vmDays > 0 ? '#86efac' : vmDays !== null ? '#fca5a5' : '#e5e7eb'}` }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: '#1a3a2a' }}>{vm.name}</div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>{vm.memberId} · {vm.phone}</div>
                              {vm.planName && (
                                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: vmDays !== null && vmDays > 0 ? '#16a34a' : vmDays !== null ? '#dc2626' : '#9ca3af' }}>
                                  {vm.planName} · {vmDays !== null ? (vmDays > 0 ? `${vmDays}d left` : 'Expired') : 'No plan'}
                                </div>
                              )}
                            </div>
                            <button onClick={() => { setSelectedVirtualMember(vm); setVirtualTab('payment'); }}
                              style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 7, padding: '6px 10px', fontWeight: 700, fontSize: 11, color: '#16a34a', cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                              Pay →
                            </button>
                          </div>
                          );
                        }
                        )}
                      </div>
                    )}

                    {/* Add new tab */}
                    {virtualTab === 'add' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <input
                          placeholder="Full name"
                          value={newVirtualName}
                          onChange={e => setNewVirtualName(e.target.value)}
                          style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito,sans-serif' }}
                        />
                        <input
                          placeholder="Mobile number"
                          type="tel"
                          value={newVirtualPhone}
                          onChange={e => setNewVirtualPhone(e.target.value)}
                          style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito,sans-serif' }}
                        />
                        <button
                          disabled={newVirtualSaving || !newVirtualName.trim() || !newVirtualPhone.trim()}
                          onClick={async () => {
                            if (!clubId || !newVirtualName.trim() || !newVirtualPhone.trim()) return;
                            setNewVirtualSaving(true);
                            try {
                              const nextNum = (virtualMembers.length + 1).toString().padStart(3, '0');
                              const memberId = `MNC-B-${nextNum}`;
                              await addDoc(collection(db, 'clubs', clubId, 'virtualMembers'), {
                                memberId,
                                name: newVirtualName.trim(),
                                phone: newVirtualPhone.trim(),
                                createdAt: serverTimestamp(),
                              });
                              setNewVirtualName(''); setNewVirtualPhone('');
                              setVirtualTab('list');
                            } catch {}
                            setNewVirtualSaving(false);
                          }}
                          style={{ padding: '12px', background: (!newVirtualName.trim() || !newVirtualPhone.trim()) ? '#d1d5db' : '#2d9653', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: (!newVirtualName.trim() || !newVirtualPhone.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}
                        >{newVirtualSaving ? 'Adding…' : 'Add Virtual Member'}</button>
                      </div>
                    )}

                    {/* Payment tab */}
                    {virtualTab === 'payment' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Member selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>SELECT MEMBER</div>
                          {virtualMembers.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#9ca3af' }}>No virtual members. Add one first.</div>
                          ) : (
                            <select
                              value={selectedVirtualMember?.id || ''}
                              onChange={e => {
                                const vm = virtualMembers.find(v => v.id === e.target.value) || null;
                                setSelectedVirtualMember(vm);
                              }}
                              style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito,sans-serif', background: 'white' }}
                            >
                              <option value="">— Select virtual member —</option>
                              {virtualMembers.map(vm => {
                                const vmEnd = vm.membershipEnd ? (vm.membershipEnd.toDate ? vm.membershipEnd.toDate() : new Date(vm.membershipEnd)) : null;
                                const vmDays = vmEnd ? Math.ceil((vmEnd.getTime() - Date.now()) / 86400000) : null;
                                return (
                                  <option key={vm.id} value={vm.id}>
                                    {vm.name} ({vm.memberId}){vmDays !== null ? ` — ${vmDays > 0 ? `${vmDays}d left` : 'expired'}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                          )}
                        </div>
                        {/* Plan selector */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>SELECT PLAN (optional)</div>
                          <select
                            value={virtualPlanId}
                            onChange={e => {
                              const plan = clubMemberships.find(p => p.id === e.target.value);
                              setVirtualPlanId(e.target.value);
                              if (plan) setVirtualAmount(String(plan.price || ''));
                            }}
                            style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 13, fontFamily: 'Nunito,sans-serif', background: 'white' }}
                          >
                            <option value="">— No plan (payment only) —</option>
                            {clubMemberships.map(p => (
                              <option key={p.id} value={p.id}>{p.name} — ₹{p.price} ({p.durationDays}d)</option>
                            ))}
                          </select>
                          {virtualPlanId && (() => {
                            const plan = clubMemberships.find(p => p.id === virtualPlanId);
                            if (!plan) return null;
                            const end = new Date(Date.now() + (plan.durationDays || 29) * 86400000);
                            return (
                              <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, background: '#f0fdf4', borderRadius: 8, padding: '6px 10px' }}>
                                Plan active: Today → {end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ({plan.durationDays} days)
                              </div>
                            );
                          })()}
                        </div>
                        <input
                          placeholder="Amount (₹)"
                          type="number"
                          value={virtualAmount}
                          onChange={e => setVirtualAmount(e.target.value)}
                          style={{ padding: '10px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito,sans-serif' }}
                        />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => { setVirtualPayMethod('cash'); setVirtualUpiAccount(null); }}
                            style={{ flex: 1, padding: '10px', border: `2px solid ${virtualPayMethod === 'cash' ? '#2d9653' : '#e5e7eb'}`, background: virtualPayMethod === 'cash' ? '#f0fdf4' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                          >💵 Cash</button>
                          {upiAccounts.map(u => (
                            <button
                              key={u.id}
                              onClick={() => { setVirtualPayMethod('upi'); setVirtualUpiAccount(u); }}
                              style={{ flex: 1, padding: '10px', border: `2px solid ${virtualPayMethod === 'upi' && virtualUpiAccount?.id === u.id ? '#2d9653' : '#e5e7eb'}`, background: virtualPayMethod === 'upi' && virtualUpiAccount?.id === u.id ? '#f0fdf4' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                            >📱 {u.name || u.app || 'UPI'}</button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            disabled={virtualSaving || !selectedVirtualMember || !virtualAmount || !virtualPayMethod}
                            onClick={async () => {
                              if (!clubId || !selectedVirtualMember || !virtualAmount || !virtualPayMethod) return;
                              setVirtualSaving(true);
                              try {
                                const todayStr = todayLocal();
                                const vpTender = normalizeTender(Number(virtualAmount), virtualPayMethod);
                                const selectedPlan = virtualPlanId ? clubMemberships.find(p => p.id === virtualPlanId) : null;
                                const planStart = selectedPlan ? new Date() : null;
                                const planEnd = selectedPlan ? new Date(Date.now() + (selectedPlan.durationDays || 29) * 86400000) : null;

                                // Record payment
                                await addDoc(collection(db, 'clubs', clubId, 'payments'), {
                                  type: 'virtual_member',
                                  virtualMemberId: selectedVirtualMember.id,
                                  virtualMemberDocId: selectedVirtualMember.memberId,
                                  memberName: selectedVirtualMember.name,
                                  memberPhone: selectedVirtualMember.phone,
                                  amount: vpTender.amount,
                                  paymentMethod: vpTender.paymentMethod,
                                  cashAmount: vpTender.cashAmount,
                                  upiAmount: vpTender.upiAmount,
                                  ...(virtualUpiAccount ? { upiAccountId: virtualUpiAccount.id, upiAccountName: virtualUpiAccount.name || virtualUpiAccount.app, upiNumber: virtualUpiAccount.number, upiHolderName: virtualUpiAccount.holderName } : {}),
                                  ...(selectedPlan ? { planId: selectedPlan.id, planName: selectedPlan.name, planDurationDays: selectedPlan.durationDays } : {}),
                                  description: `Virtual member payment — ${selectedVirtualMember.name} (${selectedVirtualMember.memberId})${selectedPlan ? ` — ${selectedPlan.name}` : ''}`,
                                  date: todayStr,
                                  createdAt: serverTimestamp(),
                                });

                                // If plan selected, update virtual member with membership dates
                                if (selectedPlan && planStart && planEnd) {
                                  await updateDoc(doc(db, 'clubs', clubId, 'virtualMembers', selectedVirtualMember.id), {
                                    membershipPlanId: selectedPlan.id,
                                    planName: selectedPlan.name,
                                    membershipStart: Timestamp.fromDate(planStart),
                                    membershipEnd: Timestamp.fromDate(planEnd),
                                    planDurationDays: selectedPlan.durationDays,
                                    updatedAt: serverTimestamp(),
                                  });
                                }

                                // Auto-deduct virtual product set from inventory
                                try {
                                  const vpsSnap = await getDocs(collection(db, 'clubs', clubId, 'virtualProductSets'));
                                  const activeSets = vpsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive);
                                  if (activeSets.length > 0) {
                                    const vps = activeSets[0] as any;
                                    const now = Timestamp.now();
                                    const batch = writeBatch(db);
                                    for (const item of vps.items || []) {
                                      const prodRef = doc(db, 'clubs', clubId, 'inventory', item.productId);
                                      const prodSnap = await getDoc(prodRef);
                                      if (prodSnap.exists()) {
                                        const current = prodSnap.data().quantity ?? 0;
                                        const newQty = Math.max(0, current - (item.quantity || 0));
                                        batch.update(prodRef, { quantity: newQty, lastUpdated: now });
                                        const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                                        batch.set(doc(collection(db, 'clubs', clubId, 'inventoryLogs')), {
                                          id: logId, clubId, type: 'virtual_deduction',
                                          productId: item.productId, productName: item.productName,
                                          quantityChange: -(item.quantity || 0), quantityBefore: current, quantityAfter: newQty,
                                          referenceId: vps.id,
                                          performedBy: 'Virtual: ' + selectedVirtualMember.name,
                                          date: todayStr, createdAt: now,
                                        });
                                      }
                                    }
                                    await batch.commit();
                                  }
                                } catch { /* non-blocking: don't fail payment if deduction fails */ }

                                setSelectedVirtualMember(null); setVirtualAmount(''); setVirtualPayMethod(''); setVirtualUpiAccount(null); setVirtualPlanId('');
                              } catch {}
                              setVirtualSaving(false);
                            }}
                            style={{ flex: 1, padding: '12px', background: (!selectedVirtualMember || !virtualAmount || !virtualPayMethod) ? '#d1d5db' : '#2d9653', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: (!selectedVirtualMember || !virtualAmount || !virtualPayMethod) ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}
                          >{virtualSaving ? 'Saving…' : '✅ Save Payment'}</button>
                          <button onClick={() => { setSelectedVirtualMember(null); setVirtualAmount(''); setVirtualPayMethod(''); setVirtualUpiAccount(null); setVirtualPlanId(''); }}
                            style={{ padding: '12px 16px', background: '#f3f4f6', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', color: '#6b7280' }}>Clear</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ══ ONE-DAY SHAKE — MEMBER PICKER (from Settings) ══ */}
        {showOneDayShakeMemberPicker && (() => {
          const q = oneDayShakeMemberSearch.toLowerCase().trim();
          const ts = (v: any) => (v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0));
          const list = (members as any[])
            .filter((m) => {
              if (!q) return true;
              return (
                (m.name || '').toLowerCase().includes(q) ||
                (m.phone || '').toLowerCase().includes(q) ||
                (m.memberId || '').toString().toLowerCase().includes(q)
              );
            })
            .sort((a, b) => {
              const ca = Number(a.oneDayShakeCount || 0);
              const cb = Number(b.oneDayShakeCount || 0);
              if (ca !== cb) return cb - ca;
              const la = ts(a.lastOneDayShakeAt);
              const lb = ts(b.lastOneDayShakeAt);
              if (la !== lb) return lb - la;
              const idA = (a.memberId || '').toString().padStart(10, '0');
              const idB = (b.memberId || '').toString().padStart(10, '0');
              return idA.localeCompare(idB);
            });
          return (
            <div
              onClick={() => { setShowOneDayShakeMemberPicker(false); setOneDayShakeMemberSearch(''); }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 999 }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', fontFamily: 'Nunito, sans-serif' }}
              >
                <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>☕ One-Day Shake</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Select a member · recent users on top</div>
                  </div>
                  <button
                    onClick={() => { setShowOneDayShakeMemberPicker(false); setOneDayShakeMemberSearch(''); }}
                    style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >✕</button>
                </div>
                <div style={{ padding: '12px 24px 0' }}>
                  <input
                    placeholder="🔍 Member ID / Name / Mobile..."
                    value={oneDayShakeMemberSearch}
                    onChange={e => setOneDayShakeMemberSearch(e.target.value)}
                    style={{ width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: 12, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none', background: 'white' }}
                  />
                </div>
                <div style={{ overflowY: 'auto', padding: '12px 24px 24px', flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    {list.length} member{list.length !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(108px,1fr))', gap: 10 }}>
                    {list.map((m: any) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedMember(m);
                          setShowOneDayShakeMemberPicker(false);
                          setOneDayShakeMemberSearch('');
                          setOneDayShakeStep('select');
                          setOneDayShakeItem(null);
                          setOneDayShakeVerifiedBy('');
                          setOneDayShakeDays(1);
                          // Default into redeem mode when prepaid credits exist
                          setOneDayShakeRedeemMode((Number(m.oneDayShakeCredits) || 0) > 0);
                          setShowOneDayShake(true);
                          setScreen('member_dashboard');
                        }}
                        style={{ background: 'white', border: '2px solid #e5e7eb', borderRadius: 14, padding: '12px 6px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', fontFamily: 'Nunito,sans-serif' }}
                      >
                        {m.memberId && (
                          <div style={{ fontSize: 12, fontWeight: 900, color: '#f59e0b', letterSpacing: 0.4 }}>{m.memberId}</div>
                        )}
                        {memberPhotoOf(m) ? (
                          <img src={memberPhotoOf(m)} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e7eb' }} />
                        ) : (
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'white', fontWeight: 900 }}>
                            {(m.name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a2a', textAlign: 'center', lineHeight: 1.2 }}>{m.name}</div>
                        {Number(m.oneDayShakeCount || 0) > 0 && (
                          <div style={{ fontSize: 10, color: '#d97706', fontWeight: 800 }}>×{Number(m.oneDayShakeCount)}</div>
                        )}
                      </button>
                    ))}
                    {list.length === 0 && (
                      <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                        <div style={{ fontSize: 40 }}>🥤</div>
                        <p>No members found</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ─────────────────────────────
  // MEMBER GRID
  // ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════
  // RENEWAL — pick a member, pick a plan, accountant verifies
  // ═══════════════════════════════════════════════════════════════════
  // Renewing was buried inside a member's profile behind "Buy Plan", so it got
  // missed and people carried on with an expired membership. It is its own
  // door at the desk now. The writing is still `completePlanPurchase` — the
  // same pipe the profile screen uses — so this is a new door, not a new copy.
  // ═══════════════════════════════════════════════════════════════════
  // NIGHT SHAKE — the evening operation
  // ═══════════════════════════════════════════════════════════════════
  // Its own component and its own collections, sharing only the member list.
  // A night shake never touches a member's day-club shake credits.
  if (screen === 'night_shake') {
    return (
      <NightShakeScreen
        clubId={clubId}
        members={members}
        upiAccounts={upiAccounts}
        onClose={goHome}
      />
    );
  }

  if (screen === 'renew_grid') {
    const rq = renewSearch.toLowerCase().trim();
    const expiryOf = (m: any): Date | null => {
      const raw = m.membershipEndDate ?? m.membershipEnd;
      if (!raw) return null;
      try { return raw?.toDate?.() ?? new Date(raw); } catch { return null; }
    };
    const daysLeftOf = (m: any): number | null => {
      const d = expiryOf(m);
      if (!d || isNaN(d.getTime())) return null;
      return Math.ceil((d.getTime() - Date.now()) / 86400000);
    };
    const renewList = members
      .filter(m => {
        if (!rq) return true;
        return (
          (m.name || '').toLowerCase().includes(rq) ||
          (m.phone || '').toLowerCase().includes(rq) ||
          (m.memberId || '').toString().toLowerCase().includes(rq)
        );
      })
      // Whoever needs renewing most comes first: expired, then soonest to
      // expire, then everyone else. The receptionist rarely has to search.
      .sort((a, b) => {
        const da = daysLeftOf(a), dbb = daysLeftOf(b);
        if (da === null && dbb === null) return (a.name || '').localeCompare(b.name || '');
        if (da === null) return 1;
        if (dbb === null) return -1;
        return da - dbb;
      });

    return (
      <div style={{ minHeight: '100vh', background: '#fff1f2', fontFamily: 'Nunito, sans-serif' }}>
        <div style={{ background: 'linear-gradient(135deg,#4c0519,#9f1239)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={goHome} style={S.backBtn}>← Back</button>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'white', fontSize: 20, fontWeight: 900 }}>🔄 Renewal</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600 }}>
              Tap a member to renew their plan
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px 0' }}>
          <input
            value={renewSearch}
            onChange={e => setRenewSearch(e.target.value)}
            placeholder="Search name, phone or member ID…"
            style={{
              width: '100%', padding: '14px 18px', borderRadius: 14, fontSize: 15,
              border: '2px solid #fecdd3', outline: 'none', fontFamily: 'Nunito, sans-serif',
              fontWeight: 600, background: 'white', color: '#4c0519',
            }}
          />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
          gap: 16, padding: 24,
        }}>
          {renewList.map(m => {
            const days = daysLeftOf(m);
            const expired = days !== null && days <= 0;
            const soon = days !== null && days > 0 && days <= 5;
            const credits = Number((m as any).shakeCredits) || 0;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setSelectedMember(m);
                  setPurchasePlanId('');
                  setPlanPurchaseSuccess(false);
                  setPlanPurchaseVerifiedBy('');
                  setShowPlanPurchase(true);
                  // The plan-purchase modal is rendered inside the
                  // member_dashboard branch, so opening it from here without
                  // also moving screens set a flag nobody was rendering —
                  // the tap did nothing at all. Go where the modal lives.
                  setScreen('member_dashboard');
                }}
                style={{
                  background: 'white',
                  border: expired ? '2px solid #e11d48' : soon ? '2px solid #fb923c' : '2px solid #fecdd3',
                  borderRadius: 20, padding: '20px 14px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  boxShadow: '0 2px 12px rgba(159,18,57,0.08)', position: 'relative',
                  fontFamily: 'Nunito, sans-serif',
                }}
              >
                {memberPhotoOf(m) ? (
                  <img
                    src={memberPhotoOf(m)}
                    alt={m.name}
                    style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid #fecdd3' }}
                  />
                ) : (
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg,#e11d48,#9f1239)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, fontWeight: 900,
                  }}>
                    {(m.name || '?')[0].toUpperCase()}
                  </div>
                )}
                <div style={{ fontSize: 14, fontWeight: 800, color: '#4c0519', textAlign: 'center', lineHeight: 1.2 }}>
                  {m.name}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9f1239', opacity: 0.7 }}>
                  {credits} credit{credits === 1 ? '' : 's'}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
                  background: expired ? '#e11d48' : soon ? '#fb923c' : '#f1f5f9',
                  color: expired || soon ? 'white' : '#64748b',
                }}>
                  {days === null ? 'No plan'
                    : expired ? 'Expired'
                    : `${days} day${days === 1 ? '' : 's'} left`}
                </div>
              </button>
            );
          })}
          {renewList.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#9f1239', fontWeight: 700 }}>
              No members match "{renewSearch}"
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'member_grid') {
    const q = memberSearch.toLowerCase().trim();
    // Pending checkin memberIds sorted by createdAt (queue order)
    const sortedPending = [...pendingCheckins].sort((a, b) => {
      const tA = a.createdAt?.toMillis?.() ?? 0;
      const tB = b.createdAt?.toMillis?.() ?? 0;
      return tA - tB;
    });
    const pendingMemberIds = sortedPending.map(p => p.memberId);

    const filtered = members
      .filter(m => {
        if (!q) return true;
        return (
          (m.name || '').toLowerCase().includes(q) ||
          (m.phone || '').toLowerCase().includes(q) ||
          (m.memberId || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aIdx = pendingMemberIds.indexOf(a.id);
        const bIdx = pendingMemberIds.indexOf(b.id);
        // Pending first, ordered by queue position
        if (aIdx !== -1 && bIdx === -1) return -1;
        if (aIdx === -1 && bIdx !== -1) return 1;
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        // Regular members: sort by memberId
        const idA = (a.memberId || '').toString().padStart(10, '0');
        const idB = (b.memberId || '').toString().padStart(10, '0');
        return idA.localeCompare(idB);
      });

    return (
      <div style={{ minHeight: '100vh', background: '#f0fdf4', fontFamily: 'Nunito, sans-serif' }}>
        <div style={{ background: 'linear-gradient(135deg,#0a1f14,#1a3a2a)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={goHome} style={S.backBtn}>← Back</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 900, margin: 0 }}>👤 Select Your Profile</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '4px 0 0' }}>Search by ID, name or mobile</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            title="Reload page"
            style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.22)', borderRadius: 12, color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >↺</button>
        </div>
        <div style={{ padding: '16px 24px 0' }}>
          {/* No autoFocus on this input: opening the grid used to throw the
              on-screen keyboard up over half the faces. The keyboard now
              appears only when the receptionist taps the search box itself. */}
          <div className="rx-search-wrap" style={{ position: 'relative' }}>
            <input
              ref={memberSearchRef}
              className="rx-search"
              placeholder={searchKeyboardMode === 'numeric' ? '🔍 Member ID or Mobile number…' : '🔍 Type member name…'}
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              inputMode={searchKeyboardMode}
              type={searchKeyboardMode === 'numeric' ? 'tel' : 'text'}
              style={{
                width: '100%', padding: '15px 92px 15px 18px', border: '2.5px solid #2d9653', borderRadius: 14,
                fontSize: 17, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none', background: 'white',
              }}
            />
            <button
              type="button"
              onClick={toggleSearchKeyboard}
              title={searchKeyboardMode === 'numeric' ? 'Switch to letters' : 'Switch to numbers'}
              style={{
                position: 'absolute', top: '50%', right: memberSearch ? 48 : 12, transform: 'translateY(-50%)',
                background: '#f0fdf4', border: '1.5px solid #86efac', color: '#15803d',
                borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                fontFamily: 'Nunito, sans-serif', letterSpacing: 0.5,
              }}
            >{searchKeyboardMode === 'numeric' ? '123' : 'ABC'}</button>
            {memberSearch && (
              <button
                type="button"
                className="rx-clear-btn"
                onClick={() => setMemberSearch('')}
                title="Clear"
              >✕</button>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 18, padding: '16px 24px' }}>
          {filtered.map(member => {
            const pendingEntry = sortedPending.find(p => p.memberId === member.id);
            const queueNum = pendingEntry ? pendingMemberIds.indexOf(member.id) + 1 : null;
            const isPending = !!pendingEntry;
            return (
              <button
                key={member.id}
                onClick={() => {
                  // View-only mode (Settings → "View Member"): open the member's
                  // profile but DON'T write attendance — for looking up a member's
                  // history when they aren't actually present.
                  if (viewOnlyMode) {
                    setSelectedMember(member);
                    setScreen('member_dashboard');
                    return;
                  }

                  // ── Already been in today? ────────────────────────────
                  // Someone who ordered on the app and was served can be
                  // tapped a second time by mistake — a busy desk, a similar
                  // face, a member coming back to ask something. That second
                  // tap used to run the whole check-in again, silently.
                  //
                  // A member sitting in the queue is NOT a repeat: their card
                  // is the whole point of the tap, and it disappears once it
                  // is confirmed.
                  if (!pendingEntry && member.lastVisit === todayLocal()) {
                    const first = (member.name || 'This member').split(' ')[0];
                    const ok = window.confirm(
                      `${first} has already been checked in today.\n\n` +
                      `If they ordered a shake on the app it has already been counted.\n\n` +
                      `Check them in again anyway?`,
                    );
                    if (!ok) return;
                  }

                  // When face verification is OFF, two cases:
                  //
                  //   1) Plain check-in (no pre-order): no confirmation —
                  //      attendance is cheap to write and easily undone
                  //      from the Today drawer if the wrong tile was hit.
                  //      Removing this prompt cuts the typical flow from
                  //      3 confirmations down to ≤2 (per owner request).
                  //
                  //   2) Pre-order pending: keep the modal — confirming
                  //      it irreversibly debits the wallet / shake credits
                  //      and prints a kitchen token, so we want a final
                  //      "Is this really the right person?" guard.
                  //
                  // Reads live Firestore state so toggling face verify in
                  // Admin Settings takes effect immediately (no reload).
                  if (faceVerificationEnabled === false) {
                    if (pendingEntry) {
                      setConfirmingMember(member);
                      setConfirmingPending(pendingEntry);
                      return;
                    }
                    // Couple member? Show the Both / Only-A / Only-B prompt
                    // before writing attendance. (Tapping ANY couple member's
                    // tile opens the same prompt — it's a couple-unit action.)
                    if (member.couplePartnerId) {
                      const partner = members.find(m => m.id === member.couplePartnerId);
                      if (partner) {
                        setCouplePrompt({ member, partner });
                        return;
                      }
                    }
                    // Single-account couple (one membership) → ask who's present
                    // before recording attendance, so the day isn't assumed "both".
                    if (member.isCouple) {
                      setCoupleSinglePrompt(member);
                      return;
                    }
                    // One-Day Shake member → offer Deduct Credits vs One-Day Shake
                    // before deducting a credit.
                    if (member.isOneDayShakeMember) {
                      setOneDayRoutePrompt(member);
                      return;
                    }
                    // Direct check-in — no money moves, no token prints.
                    void runBypassedCheckIn(member);
                    return;
                  }

                  // Couple tiles are a couple-unit action: ask "who's present?"
                  // first. This check used to live ONLY in the face-OFF branch,
                  // so whenever face verification was ON the prompt was skipped
                  // entirely — that's why couple attendance "disappeared".
                  // Pending pre-orders still go straight to face verify so the
                  // order is completed on a face match.
                  if (!pendingEntry) {
                    if (member.couplePartnerId) {
                      const partner = members.find(m => m.id === member.couplePartnerId);
                      if (partner) { setCouplePrompt({ member, partner }); return; }
                    }
                    if (member.isCouple) { setCoupleSinglePrompt(member); return; }
                  }

                  setSelectedMember(member);
                  setFailCount(0);
                  setFaceStatus('');
                  setScreen('face_verify');
                  setTimeout(() => startFaceVerification(member), 600);
                }}
                style={{
                  background: isPending ? '#fffbeb' : 'white',
                  border: isPending ? '2px solid #f59e0b' : member.hasFace ? '2px solid #86efac' : '2px solid #fde047',
                  borderRadius: 20, padding: '20px 14px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  boxShadow: isPending ? '0 4px 16px rgba(245,158,11,0.25)' : '0 2px 12px rgba(0,0,0,0.06)',
                  transition: 'all 0.15s', position: 'relative',
                }}
              >
                {/* Queue number badge */}
                {isPending && (
                  <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#f59e0b', color: 'white', fontSize: 12, fontWeight: 900, padding: '3px 12px', borderRadius: 20, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                    #{queueNum} in queue
                  </div>
                )}

                {/* Already been in today — visible BEFORE the tap, so the
                    common mistake is prevented rather than warned about. */}
                {!isPending && member.lastVisit === todayLocal() && (
                  <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#0ea5e9', color: 'white', fontSize: 11, fontWeight: 900, padding: '3px 11px', borderRadius: 20, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                    ✓ In today
                  </div>
                )}

                {/* Check-in burst — pops over the face and fades, so the
                    receptionist never leaves the grid for the next person. */}
                {checkInBurst?.id === member.id && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 5, pointerEvents: 'none', overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: 20,
                      background: checkInBurst.failed
                        ? 'radial-gradient(circle at 50% 45%, rgba(220,38,38,0.96), rgba(153,27,27,0.92))'
                        : 'radial-gradient(circle at 50% 45%, rgba(16,185,129,0.96), rgba(5,150,105,0.92))',
                      // A failure is held for 6s on purpose, so its backdrop
                      // must last that long too — at 2.6s the keyframe fades to
                      // nothing and the warning became white text on white.
                      animation: checkInBurst.failed
                        ? 'mncBurstBg 6s ease-out forwards'
                        : 'mncBurstBg 2.6s ease-out forwards',
                    }} />
                    {!checkInBurst.failed && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <span key={i} style={{
                        position: 'absolute', top: '45%', left: '50%', width: 7, height: 7, borderRadius: '50%',
                        background: i % 2 ? '#fde047' : 'white',
                        animation: `mncSpark 900ms ease-out forwards`,
                        transform: `rotate(${i * 45}deg)`,
                        ['--mnc-angle' as any]: `${i * 45}deg`,
                      }} />
                    ))}
                    <div style={{ fontSize: 34, lineHeight: 1, animation: 'mncBurstPop 700ms cubic-bezier(.2,1.4,.4,1) both', zIndex: 1 }}>
                      {checkInBurst.failed ? '⚠️' : '✓'}
                    </div>
                    <div style={{
                      color: 'white', fontSize: 13, fontWeight: 900, textAlign: 'center', padding: '0 8px',
                      fontFamily: 'Nunito, sans-serif', textShadow: '0 1px 3px rgba(0,0,0,0.35)', zIndex: 1,
                      animation: 'mncBurstPop 700ms cubic-bezier(.2,1.4,.4,1) both', animationDelay: '80ms',
                    }}>
                      {checkInBurst.msg}
                    </div>
                    <style>{`
                      @keyframes mncBurstPop {
                        0%  { transform: scale(0.4); opacity: 0 }
                        60% { transform: scale(1.12); opacity: 1 }
                        100%{ transform: scale(1); opacity: 1 }
                      }
                      @keyframes mncBurstBg {
                        0%  { opacity: 0; transform: scale(0.85) }
                        12% { opacity: 1; transform: scale(1) }
                        70% { opacity: 1 }
                        100%{ opacity: 0 }
                      }
                      @keyframes mncSpark {
                        0%   { transform: rotate(var(--mnc-angle)) translateY(0) scale(1); opacity: 1 }
                        100% { transform: rotate(var(--mnc-angle)) translateY(-58px) scale(0.2); opacity: 0 }
                      }
                    `}</style>
                  </div>
                )}
                {/* Member ID — big and prominent */}
                {member.memberId && (
                  <div style={{ fontSize: 17, fontWeight: 900, color: isPending ? '#d97706' : '#2d9653', letterSpacing: 0.5 }}>{member.memberId}</div>
                )}
                {memberPhotoOf(member) ? (
                  <img src={memberPhotoOf(member)} alt={member.name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: isPending ? '4px solid #f59e0b' : '4px solid #d8f3dc' }} />
                ) : (
                  <div style={{
                    width: 96, height: 96, borderRadius: '50%', background: isPending ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#2d9653,#1a6e3c)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, color: 'white', fontWeight: 900,
                  }}>
                    {(member.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a', textAlign: 'center', lineHeight: 1.25 }}>{member.name || 'Member'}</div>
                {member.phone && <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{member.phone}</div>}
                {/* Lucky Dip renewal nudge — shows when credits are running low (1..3 left) */}
                {(() => {
                  const n = luckyDipNudge(member.shakeCredits);
                  return n ? (
                    <div style={{ fontSize: 11, fontWeight: 800, color: n.color, background: n.bg, border: `1px solid ${n.border}`, padding: '3px 10px', borderRadius: 10 }}>
                      🎲 {n.label}
                    </div>
                  ) : null;
                })()}
                {isPending && (
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', background: '#fef3c7', padding: '3px 10px', borderRadius: 10 }}>
                    🥤 {(pendingEntry.items || []).map((i: any) => i.name).join(', ') || 'Order pending'}
                  </div>
                )}
                {!member.hasFace && !isPending && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⚠️ Not enrolled</div>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#9ca3af' }}>
              <div style={{ fontSize: 48 }}>👤</div>
              <p>No members found</p>
            </div>
          )}
        </div>

        {/* ── Couple prompt (when a couple-linked tile is tapped) ── */}
        {couplePrompt && (() => {
          const { member, partner } = couplePrompt;
          // Identify male/female by the explicit gender we wrote at link time.
          // Fall back to original tile order if missing.
          const isThisMale = member.gender === "male";
          const malePerson  = isThisMale ? member : (partner.gender === "male" ? partner : member);
          const femalePerson = isThisMale ? partner : member;
          const closePrompt = () => setCouplePrompt(null);

          const checkInBoth = async () => {
            closePrompt();
            // Both partners now go through the SAME path. The partner used to
            // be written straight to attendance instead, which meant they got
            // no duplicate-tap guard, no burst, no name read out, and any
            // failure passed in silence — and if the partner had pre-ordered a
            // shake of their own, it was left sitting in the queue.
            //
            // `couplePresence: 'both'` is recorded on each, so a report can
            // tell a couple visit from two people who happened to arrive
            // together. It was previously dropped here entirely, even though
            // the prompt exists purely to ask the question.
            // The PARTNER goes first and silently — checked in with the same
            // guard, order completion and failure alerts, but without taking
            // the screen. Then the tapped member, who does take it.
            //
            // Order and silence both matter. Running two visible check-ins
            // meant the second won: the receptionist tapped the husband, saw
            // his profile, and 900ms later it became the wife's — so a plan
            // sold immediately afterwards was charged to the wrong person.
            await runBypassedCheckIn(partner, { couplePresence: 'both', silent: true });
            await runBypassedCheckIn(member, { couplePresence: 'both' });
          };
          const checkInOnly = (whichMember: any) => {
            closePrompt();
            // Only one of them came. These are two separate member records, so
            // the single attendance document IS the statement of who was here —
            // no couplePresence needed, and inventing one would read as though
            // a couple visit had been logged.
            void runBypassedCheckIn(whichMember);
          };

          return (
            <div onClick={closePrompt} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200, fontFamily: 'Nunito, sans-serif' }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 24, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 32, marginBottom: 4 }}>💑</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Couple Check-in</div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 4 }}>
                    Who is present today?
                  </div>
                </div>

                {/* Both partners visual */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
                  {[
                    { p: malePerson, color: '#1d4ed8', symbol: '♂', bg: '#dbeafe' },
                    { p: femalePerson, color: '#be185d', symbol: '♀', bg: '#fce7f3' },
                  ].map(({ p, color, symbol, bg }) => (
                    <div key={p.id} style={{ textAlign: 'center' }}>
                      <div style={{ width: 80, height: 80, borderRadius: '50%', overflow: 'hidden', background: bg, border: `3px solid ${color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                        {memberPhotoOf(p) ? (
                          <img src={memberPhotoOf(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 32, fontWeight: 900, color }}>{(p.name || '?')[0].toUpperCase()}</span>
                        )}
                        <span style={{ position: 'absolute', bottom: -4, right: -4, background: color, color: 'white', width: 24, height: 24, borderRadius: '50%', fontSize: 14, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>{symbol}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginTop: 8 }}>{p.name?.split(' ')[0] || '—'}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={checkInBoth}
                    style={{ padding: 16, background: 'linear-gradient(135deg,#be185d,#9d174d)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                    💑 Both Present
                  </button>
                  <button onClick={() => checkInOnly(malePerson)}
                    style={{ padding: 14, background: 'white', color: '#1d4ed8', border: '2px solid #93c5fd', borderRadius: 14, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                    ♂ Only {malePerson.name?.split(' ')[0] || 'Male'}
                  </button>
                  <button onClick={() => checkInOnly(femalePerson)}
                    style={{ padding: 14, background: 'white', color: '#be185d', border: '2px solid #f9a8d4', borderRadius: 14, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                    ♀ Only {femalePerson.name?.split(' ')[0] || 'Female'}
                  </button>
                  <button onClick={closePrompt}
                    style={{ padding: 10, background: 'transparent', color: '#64748b', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Single-account couple: "Who is present today?" ── */}
        {coupleSinglePrompt && (() => {
          const m = coupleSinglePrompt;
          const husband = (m.husbandName || '').trim() || 'Husband';
          const wife = (m.wifeName || '').trim() || 'Wife';
          const close = () => setCoupleSinglePrompt(null);
          const go = (presence: 'both' | 'husband' | 'wife') => { close(); void runBypassedCheckIn(m, { couplePresence: presence }); };
          return (
            <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200, fontFamily: 'Nunito, sans-serif' }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 24, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: 32, marginBottom: 4 }}>💑</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Couple Check-in</div>
                  <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 800, marginTop: 6 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 2 }}>Who is present today?</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={() => go('both')} style={{ padding: 16, background: 'linear-gradient(135deg,#be185d,#9d174d)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>💑 Both Present</button>
                  <button onClick={() => go('husband')} style={{ padding: 14, background: 'white', color: '#1d4ed8', border: '2px solid #93c5fd', borderRadius: 14, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>♂ Only {husband}</button>
                  <button onClick={() => go('wife')} style={{ padding: 14, background: 'white', color: '#be185d', border: '2px solid #f9a8d4', borderRadius: 14, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>♀ Only {wife}</button>
                  <button onClick={close} style={{ padding: 10, background: 'transparent', color: '#64748b', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>Cancel</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── One-Day Shake member: Deduct Credits vs One-Day Shake ── */}
        {oneDayRoutePrompt && (() => {
          const m = oneDayRoutePrompt;
          const close = () => setOneDayRoutePrompt(null);
          const deduct = () => { close(); void runBypassedCheckIn(m); };
          const oneDay = () => {
            close();
            // Route into the EXISTING one-day-shake flow (select → 1/2/3-day →
            // Cash/UPI/Split), same launch the Settings picker uses.
            setSelectedMember(m);
            setOneDayShakeStep('select');
            setOneDayShakeItem(null);
            setOneDayShakeVerifiedBy('');
            setOneDayShakeDays(1);
            setOneDayShakeRedeemMode((Number(m.oneDayShakeCredits) || 0) > 0);
            setShowOneDayShake(true);
            setScreen('member_dashboard');
          };
          return (
            <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200, fontFamily: 'Nunito, sans-serif' }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 24, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: 32, marginBottom: 4 }}>🥤</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 6 }}>How is this shake being taken today?</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={deduct} style={{ padding: 16, background: 'white', color: '#1d4ed8', border: '2px solid #93c5fd', borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>💳 Deduct Credits</button>
                  <button onClick={oneDay} style={{ padding: 16, background: 'linear-gradient(135deg,#16a34a,#15803d)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>🥤 One-Day Shake</button>
                  <button onClick={close} style={{ padding: 10, background: 'transparent', color: '#64748b', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>Cancel</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Confirmation modal (face verification disabled) ── */}
        {confirmingMember && (
          <div
            onClick={() => !confirmingBusy && setConfirmingMember(null)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20, zIndex: 100,
              fontFamily: 'Nunito, sans-serif',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'white', borderRadius: 24, width: '100%', maxWidth: 420,
                padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              }}
            >
              {/* Photo — large */}
              {memberPhotoOf(confirmingMember) ? (
                <img
                  src={memberPhotoOf(confirmingMember)}
                  alt=""
                  style={{
                    width: 180, height: 180, borderRadius: '50%',
                    objectFit: 'cover', border: '4px solid #2d9653',
                    boxShadow: '0 8px 24px rgba(45,150,83,0.25)',
                  }}
                />
              ) : (
                <div style={{
                  width: 180, height: 180, borderRadius: '50%',
                  background: 'linear-gradient(135deg,#2d9653,#1a6e3c)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: 72, fontWeight: 900,
                  border: '4px solid #2d9653',
                  boxShadow: '0 8px 24px rgba(45,150,83,0.25)',
                }}>
                  {(confirmingMember.name || '?').charAt(0).toUpperCase()}
                </div>
              )}

              {/* Member ID — bold pill */}
              {confirmingMember.memberId && (
                <div style={{
                  background: '#f0fdf4', color: '#166534',
                  padding: '4px 14px', borderRadius: 999,
                  fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
                  border: '1.5px solid #bbf7d0',
                }}>
                  ID · {confirmingMember.memberId}
                </div>
              )}

              {/* Question */}
              <div style={{ textAlign: 'center', padding: '4px 0' }}>
                <p style={{ margin: 0, fontSize: 14, color: '#6b7280', fontWeight: 600 }}>
                  Is this person entered?
                </p>
                <p style={{
                  margin: '6px 0 0', fontSize: 26, fontWeight: 900,
                  color: '#0a1f14', lineHeight: 1.2,
                }}>
                  {confirmingMember.name || 'Member'}
                </p>
              </div>

              {/* Pending order hint */}
              {confirmingPending && (
                <div style={{
                  width: '100%', background: '#fffbeb', border: '1.5px solid #fde68a',
                  borderRadius: 12, padding: '10px 14px',
                  fontSize: 12, color: '#92400e', textAlign: 'center', fontWeight: 700,
                }}>
                  📋 Has a pending pre-order — confirming will print the receipt.
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setConfirmingMember(null)}
                  disabled={confirmingBusy}
                  style={{
                    flex: 1, padding: '14px 0', borderRadius: 14,
                    border: '2px solid #e5e7eb', background: 'white',
                    color: '#475569', fontSize: 15, fontWeight: 800,
                    cursor: confirmingBusy ? 'not-allowed' : 'pointer',
                    fontFamily: 'Nunito, sans-serif',
                    opacity: confirmingBusy ? 0.5 : 1,
                  }}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirmingBusy || !confirmingMember) return;
                    setConfirmingBusy(true);
                    const member = confirmingMember;
                    try {
                      await runBypassedCheckIn(member);
                      setConfirmingMember(null);
                      setConfirmingPending(null);
                    } catch (err) {
                      console.error('[bypass check-in]', err);
                    } finally {
                      setConfirmingBusy(false);
                    }
                  }}
                  disabled={confirmingBusy}
                  style={{
                    flex: 2, padding: '14px 0', borderRadius: 14, border: 'none',
                    background: confirmingBusy ? '#9ca3af' : 'linear-gradient(135deg,#2d9653,#1a6e3c)',
                    color: 'white', fontSize: 15, fontWeight: 900,
                    cursor: confirmingBusy ? 'not-allowed' : 'pointer',
                    fontFamily: 'Nunito, sans-serif',
                    boxShadow: '0 4px 16px rgba(45,150,83,0.35)',
                  }}
                >
                  {confirmingBusy ? 'Opening…' : 'Yes, open profile'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────
  // FACE VERIFY SCREEN
  // ─────────────────────────────
  if (screen === 'face_verify') {
    return (
      <div style={{
        minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', position: 'relative',
      }}>
        <button onClick={() => { stopCamera(); setScreen('member_grid'); }} style={S.backBtn}>← Back</button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: 'white', fontSize: 22, fontWeight: 900 }}>{selectedMember?.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4 }}>
            {faceStatus || 'Position your face in the frame'}
          </div>
        </div>
        <div style={{ position: 'relative', width: 300, height: 300 }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 300, height: 300, borderRadius: 20, objectFit: 'cover', transform: 'scaleX(-1)' }} />
          {[
            { top: 0, left: 0, borderTop: '4px solid #2d9653', borderLeft: '4px solid #2d9653', borderRadius: '16px 0 0 0' },
            { top: 0, right: 0, borderTop: '4px solid #2d9653', borderRight: '4px solid #2d9653', borderRadius: '0 16px 0 0' },
            { bottom: 0, left: 0, borderBottom: '4px solid #2d9653', borderLeft: '4px solid #2d9653', borderRadius: '0 0 0 16px' },
            { bottom: 0, right: 0, borderBottom: '4px solid #2d9653', borderRight: '4px solid #2d9653', borderRadius: '0 0 16px 0' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 44, height: 44, pointerEvents: 'none', ...s }} />
          ))}
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 3,
            background: 'linear-gradient(90deg,transparent,#2d9653,transparent)',
            animation: 'scanLine 2s linear infinite', pointerEvents: 'none',
          }} />
        </div>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 24, fontWeight: 600, textAlign: 'center', padding: '0 40px' }}>
          {faceStatus || 'Look straight at the camera'}
        </div>
        {/* Restart camera button */}
        <button
          onClick={() => {
            stopCamera();
            setFaceStatus('Restarting camera…');
            setTimeout(() => startFaceVerification(selectedMember), 800);
          }}
          style={{
            marginTop: 20, background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.3)',
            color: 'white', borderRadius: 12, padding: '10px 24px',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          ↺ Restart Camera
        </button>
        <button
          onClick={async () => { stopCamera(); await triggerOtp(selectedMember); setScreen('otp_fallback'); }}
          style={{
            marginTop: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.45)', borderRadius: 10, padding: '8px 20px',
            fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
          }}
        >
          Can't scan? Use OTP
        </button>
        <style>{`@keyframes scanLine { 0% { top:10% } 50% { top:85% } 100% { top:10% } }`}</style>
      </div>
    );
  }

  // ─────────────────────────────
  // MEMBER DASHBOARD
  // ─────────────────────────────
  if (screen === 'member_dashboard' && selectedMember) {
    const memberSince = (() => { try { const c = selectedMember.createdAt; if (!c) return '—'; const d = c?.toDate ? c.toDate() : new Date(c); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); } catch { return '—'; } })();
    const walBal = memberWallet?.balance || 0;
    const GRACE_LIMIT = -5;
    const shakeCredits: number = selectedMember.shakeCredits ?? 0;
    const shakeCreditsPlanTotal: number = selectedMember.shakeCreditsPlanTotal ?? 0;
    const creditsUsed = Math.max(0, shakeCreditsPlanTotal - shakeCredits);
    const creditsPct = shakeCreditsPlanTotal > 0 ? Math.round((Math.max(0, shakeCredits) / shakeCreditsPlanTotal) * 100) : 0;
    const hasShakeCredits = shakeCredits > GRACE_LIMIT;
    const isGraceCredits = shakeCredits <= 0 && shakeCredits > GRACE_LIMIT;
    const graceUsed = Math.abs(Math.min(0, shakeCredits));

    // Reusable modal shell with slide-up animation
    const ModalShell = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.28)', transform: 'translateY(0)', animation: 'mnc-slide-up 0.28s cubic-bezier(0.16,1,0.3,1)' }}>
          {children}
        </div>
      </div>
    );

    // Checkout summary component (shared)
    const CheckoutSummary = ({ items, total, onBack, onProceed, mode }: { items: any[]; total: number; onBack: () => void; onProceed: () => void; mode?: 'wallet' | 'shake' }) => (
      <div style={{ padding: '28px 24px' }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a', marginBottom: 18 }}>🧾 Confirm Order</div>
        <div style={{ background: '#f8fafc', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
          {items.map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, color: '#374151', padding: '4px 0', borderBottom: i < items.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <span>{c.name || c.itemName}{c.icePreference ? ` (${c.icePreference})` : ''} × {c.qty}</span>
              {mode === 'shake' ? <span style={{ color: '#d97706' }}>1 credit</span> : <span>₹{c.price * c.qty}</span>}
            </div>
          ))}
        </div>
        {mode === 'shake' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, color: '#1a3a2a', marginBottom: 6 }}><span>Credits used</span><span>{items.reduce((s: number, c: any) => s + (c.qty || 1), 0)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: shakeCredits <= 0 ? '#ef4444' : '#6b7280', marginBottom: 4 }}><span>Current shake credits</span><span>{shakeCredits}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 900, color: (shakeCredits - items.reduce((s: number, c: any) => s + (c.qty || 1), 0)) < 0 ? '#ef4444' : '#d97706', marginBottom: 24 }}><span>Credits after</span><span>{shakeCredits - items.reduce((s: number, c: any) => s + (c.qty || 1), 0)}</span></div>
            {isGraceCredits && <div style={{ background: '#fef3c7', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e', fontWeight: 600, marginBottom: 16 }}>Grace period: {graceUsed}/5 used</div>}
            {!hasShakeCredits && <div style={{ background: '#fde8e8', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#ef4444', fontWeight: 600, marginBottom: 16 }}>Credits exhausted — please renew plan</div>}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15, color: '#1a3a2a', marginBottom: 6 }}><span>Subtotal</span><span>₹{total}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280', marginBottom: 4 }}><span>Current Balance</span><span>₹{walBal}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 900, color: total > walBal ? '#ef4444' : '#2d9653', marginBottom: 24 }}><span>New Balance</span><span>₹{walBal - total}</span></div>
            {total > walBal && <div style={{ background: '#fde8e8', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#ef4444', fontWeight: 600, marginBottom: 16 }}>Insufficient balance</div>}
          </>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onBack} disabled={isCheckingOut} style={{ flex: 1, padding: '14px', background: '#f3f4f6', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: isCheckingOut ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}>← Back</button>
          {mode === 'shake' ? (
            <button onClick={onProceed} disabled={!hasShakeCredits || isCheckingOut} style={{ flex: 2, padding: '14px', background: !hasShakeCredits || isCheckingOut ? '#e5e7eb' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: !hasShakeCredits || isCheckingOut ? '#9ca3af' : 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: !hasShakeCredits || isCheckingOut ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}>{isCheckingOut ? 'Placing...' : 'Use Credit'}</button>
          ) : (
            <button onClick={onProceed} disabled={total > walBal || isCheckingOut} style={{ flex: 2, padding: '14px', background: total > walBal || isCheckingOut ? '#e5e7eb' : 'linear-gradient(135deg,#2d9653,#16a34a)', color: total > walBal || isCheckingOut ? '#9ca3af' : 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: total > walBal || isCheckingOut ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}>{isCheckingOut ? 'Placing...' : 'Place Order'}</button>
          )}
        </div>
      </div>
    );

    // ── Products payment chooser (Wallet · Cash · UPI · Split) ─────────
    // Stages the chosen payment method and (for cash/UPI/split) the
    // PaymentMethodPicker selection. Nothing is committed here — the
    // selection is held in state and finalised on the Done ✓ screen.
    const ProductsPaymentChooser = ({
      cart, cartTotal, walletBalance, upiAccounts, method, onMethodChange,
      payment, onPaymentChange, onBack, onConfirm,
    }: {
      cart: any[]; cartTotal: number; walletBalance: number; upiAccounts: any[];
      method: 'wallet' | 'cash' | 'upi' | 'split' | null;
      onMethodChange: (m: 'wallet' | 'cash' | 'upi' | 'split') => void;
      payment: TopupPaymentSelection;
      onPaymentChange: (p: TopupPaymentSelection) => void;
      onBack: () => void; onConfirm: () => void;
    }) => {
      const walletEnough = walletBalance >= cartTotal;
      let canConfirm = false;
      let blockReason: string | null = null;
      if (method === 'wallet') {
        canConfirm = walletEnough;
        if (!walletEnough) blockReason = 'Insufficient wallet balance';
      } else if (method === 'cash' || method === 'upi' || method === 'split') {
        const v = validateTopupPayment(payment, cartTotal, { requireUpiAccount: upiAccounts.length > 0 });
        canConfirm = v.ok;
        if (!v.ok && v.reason) blockReason = v.reason;
      } else {
        blockReason = 'Choose a payment method';
      }
      return (
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a' }}>💳 Choose Payment</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>{cart.reduce((s, c) => s + (c.qty || 1), 0)} item(s) · ₹{cartTotal}</div>
            </div>
            <button onClick={onBack} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* 4-button method picker */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
              <button onClick={() => onMethodChange('wallet')} style={{ padding: '14px 10px', borderRadius: 12, border: `2px solid ${method === 'wallet' ? '#16a34a' : '#e5e7eb'}`, background: method === 'wallet' ? '#f0fdf4' : 'white', cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left' }}>
                <div style={{ fontSize: 22 }}>💳</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', marginTop: 4 }}>Wallet</div>
                <div style={{ fontSize: 10, color: walletEnough ? '#16a34a' : '#ef4444', fontWeight: 700, marginTop: 2 }}>₹{walletBalance} {walletEnough ? '' : '(low)'}</div>
              </button>
              <button onClick={() => onMethodChange('cash')} style={{ padding: '14px 10px', borderRadius: 12, border: `2px solid ${method === 'cash' ? '#16a34a' : '#e5e7eb'}`, background: method === 'cash' ? '#f0fdf4' : 'white', cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left' }}>
                <div style={{ fontSize: 22 }}>💵</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', marginTop: 4 }}>Cash</div>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, marginTop: 2 }}>Physical cash</div>
              </button>
              <button onClick={() => onMethodChange('upi')} style={{ padding: '14px 10px', borderRadius: 12, border: `2px solid ${method === 'upi' ? '#16a34a' : '#e5e7eb'}`, background: method === 'upi' ? '#f0fdf4' : 'white', cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left' }}>
                <div style={{ fontSize: 22 }}>📱</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', marginTop: 4 }}>UPI</div>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, marginTop: 2 }}>PhonePe / GPay</div>
              </button>
              <button onClick={() => onMethodChange('split')} style={{ padding: '14px 10px', borderRadius: 12, border: `2px solid ${method === 'split' ? '#16a34a' : '#e5e7eb'}`, background: method === 'split' ? '#f0fdf4' : 'white', cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left' }}>
                <div style={{ fontSize: 22 }}>⚡</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', marginTop: 4 }}>Split</div>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, marginTop: 2 }}>Cash + UPI</div>
              </button>
            </div>

            {/* Detailed picker for cash/UPI/split */}
            {(method === 'cash' || method === 'upi' || method === 'split') && (
              <div style={{ marginBottom: 12 }}>
                <PaymentMethodPicker
                  total={cartTotal}
                  upiAccounts={upiAccounts}
                  value={payment.method !== method ? { ...payment, method } : payment}
                  onChange={onPaymentChange}
                />
              </div>
            )}

            {method === 'wallet' && (
              <div style={{ background: walletEnough ? '#f0fdf4' : '#fde8e8', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: walletEnough ? '#166534' : '#991b1b', fontWeight: 700, marginBottom: 12 }}>
                {walletEnough
                  ? `Wallet ₹${walletBalance} → ₹${walletBalance - cartTotal} after`
                  : `Wallet has only ₹${walletBalance} — short by ₹${cartTotal - walletBalance}`}
              </div>
            )}

            {blockReason && method != null && (
              <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700, marginBottom: 8 }}>{blockReason}</div>
            )}
          </div>

          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{ width: '100%', padding: '14px', background: canConfirm ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : '#d1d5db', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: canConfirm ? 'pointer' : 'not-allowed', fontFamily: 'Nunito,sans-serif', marginTop: 8 }}
          >
            Done · Add to Order →
          </button>
          <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6, fontWeight: 600 }}>
            Tap "Done ✓" at top to review & confirm
          </div>
        </div>
      );
    };

    return (
      <div style={{ minHeight: '100vh', background: '#0f1f17', fontFamily: 'Nunito, sans-serif', overflowY: 'auto' }}>
        <style>{`@keyframes mnc-slide-up { from { opacity:0; transform:scale(0.94) translateY(20px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>

        {/* ══ ORDER SHAKES MODAL ══ */}
        {showOrderModal && (() => {
          // Cart helpers — one line per shake (matched by item id).
          const cartTotalQty = shakeCart.reduce((s: number, c: any) => s + (c.qty || 1), 0);
          const addToShakeCart = (item: any) => {
            setShakeCart(prev => {
              const idx = prev.findIndex(c => c.id === item.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], qty: (next[idx].qty || 1) + 1 };
                return next;
              }
              return [...prev, { ...item, qty: 1 }];
            });
          };
          const adjustQty = (idx: number, delta: number) => {
            setShakeCart(prev => {
              const next = [...prev];
              const newQty = (next[idx].qty || 1) + delta;
              if (newQty <= 0) return next.filter((_, i) => i !== idx);
              next[idx] = { ...next[idx], qty: newQty };
              return next;
            });
          };

          return (
            <ModalShell onClose={() => { setShowOrderModal(false); setShowShakeCheckout(false); }}>
              <>
                  <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>🥤 Today's Shakes</div>
                      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Tap to add • Credits: <strong style={{ color: '#d97706' }}>{shakeCredits} remaining</strong></div>
                    </div>
                    <button onClick={() => { setShowOrderModal(false); }} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                  <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1 }}>
                    {todaysSpecials.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}><div style={{ fontSize: 48 }}>☕</div><p>No specials available today</p></div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {todaysSpecials.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0).map(item => {
                          const inCart = shakeCart.filter(c => c.id === item.id);
                          const totalForItem = inCart.reduce((s, c) => s + (c.qty || 1), 0);
                          return (
                            <div key={item.id} style={{ background: totalForItem > 0 ? '#f0fdf4' : '#f8fafc', border: `2px solid ${totalForItem > 0 ? '#86efac' : '#e2e8f0'}`, borderRadius: 16, padding: '14px 16px', transition: 'all 0.15s' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                {item.imageUrl ? <img src={item.imageUrl} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>🥤</div>}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a' }}>{item.name || item.itemName || 'Shake'}</div>
                                  <div style={{ fontSize: 13, color: '#6b7280', marginTop: 1 }}>₹{item.price || 0}{item.stockType === 'limited' ? ` · ${item.remainingStock} left` : ''}</div>
                                </div>
                                {totalForItem > 0 && (
                                  <div style={{ background: '#16a34a', color: 'white', borderRadius: 100, padding: '2px 10px', fontSize: 12, fontWeight: 900 }}>×{totalForItem}</div>
                                )}
                              </div>
                              <button onClick={() => addToShakeCart(item)} style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: '1.5px solid #86efac', background: '#f0fdf4', color: '#16a34a', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                                + Add
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Cart strip with qty +/- and proceed */}
                  {shakeCart.length > 0 && (
                    <div style={{ borderTop: '1px solid #e5e7eb', background: 'white', padding: '12px 16px 16px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Your order ({cartTotalQty} shake{cartTotalQty !== 1 ? 's' : ''})</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 140, overflowY: 'auto' }}>
                        {shakeCart.map((c, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', borderRadius: 10, padding: '8px 10px' }}>
                            <span style={{ fontSize: 18 }}>🥤</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: '#1a3a2a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || c.itemName || 'Shake'}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button onClick={() => adjustQty(idx, -1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1.5px solid #e5e7eb', background: 'white', fontSize: 16, fontWeight: 900, cursor: 'pointer', color: '#1a3a2a' }}>−</button>
                              <span style={{ minWidth: 20, textAlign: 'center', fontSize: 14, fontWeight: 900, color: '#1a3a2a' }}>{c.qty}</span>
                              <button onClick={() => adjustQty(idx, +1)} style={{ width: 28, height: 28, borderRadius: 8, border: '1.5px solid #86efac', background: '#f0fdf4', fontSize: 16, fontWeight: 900, cursor: 'pointer', color: '#16a34a' }}>+</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowOrderModal(false)}
                        disabled={isCheckingOut}
                        style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}
                      >
                        Done · {cartTotalQty} shake{cartTotalQty !== 1 ? 's' : ''} added →
                      </button>
                      <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6, fontWeight: 600 }}>
                        Tap "Done ✓" at top to review & confirm
                      </div>
                    </div>
                  )}
                </>
            </ModalShell>
          );
        })()}

        {/* ══ BUY PRODUCTS MODAL ══ */}
        {showBuyModal && (
          <ModalShell onClose={() => { setShowBuyModal(false); setShowCartCheckout(false); setShowProductsPayment(false); }}>
            {showProductsPayment ? (
              <ProductsPaymentChooser
                cart={cart}
                cartTotal={cartTotal}
                walletBalance={walBal}
                upiAccounts={upiAccounts}
                method={productsPayMethod}
                onMethodChange={setProductsPayMethod}
                payment={productsPayment}
                onPaymentChange={setProductsPayment}
                onBack={() => setShowProductsPayment(false)}
                onConfirm={() => { setShowProductsPayment(false); setShowBuyModal(false); }}
              />
            ) : showCartCheckout ? (
              <CheckoutSummary items={cart} total={cartTotal} onBack={() => setShowCartCheckout(false)} onProceed={proceedCartCheckout} />
            ) : (
              <>
                <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>🛍️ Buy Products</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Wallet: <strong style={{ color: '#2d9653' }}>₹{walBal}</strong></div>
                  </div>
                  <button onClick={() => { setShowBuyModal(false); }} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1 }}>
                  {clubMemberships.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Membership Plans</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                        {clubMemberships.map(plan => {
                          const inCart = cart.find(c => c.id === plan.id);
                          return (
                            <div key={plan.id} style={{ background: inCart ? '#f0fdf4' : '#f8fafc', border: `2px solid ${inCart ? '#86efac' : '#e2e8f0'}`, borderRadius: 14, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div><div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a2a' }}>{plan.name}</div><div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>{planCreditsLabel(plan)} · ₹{plan.price}</div></div>
                              <button onClick={() => inCart ? removeFromCart(plan.id) : addToCart(plan)} style={{ background: inCart ? '#fee2e2' : '#6366f1', color: inCart ? '#ef4444' : 'white', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>{inCart ? '✕ Remove' : '+ Add'}</button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {clubProducts.filter(p => p.isAvailableToday && (p.stock || 0) > 0).length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Products</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {clubProducts.filter(p => p.isAvailableToday && (p.stock || 0) > 0).map(product => {
                          const inCart = cart.find(c => c.id === product.id);
                          return (
                            <div key={product.id} style={{ background: inCart ? '#f0fdf4' : '#f8fafc', border: `2px solid ${inCart ? '#86efac' : '#e2e8f0'}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                              {product.photo && <img src={product.photo} style={{ width: 42, height: 42, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a2a' }}>{product.name}</div><div style={{ fontSize: 12, color: '#6b7280' }}>{product.category} · ₹{product.price}</div></div>
                              {inCart ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <button onClick={() => { if (inCart.qty > 1) setCart(p => p.map(c => c.id === product.id ? { ...c, qty: c.qty - 1 } : c)); else removeFromCart(product.id); }} style={{ width: 30, height: 30, background: '#fee2e2', border: 'none', borderRadius: 7, color: '#ef4444', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>−</button>
                                  <span style={{ fontSize: 14, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{inCart.qty}</span>
                                  <button onClick={() => setCart(p => p.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c))} style={{ width: 30, height: 30, background: '#dcfce7', border: 'none', borderRadius: 7, color: '#2d9653', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>+</button>
                                </div>
                              ) : (
                                <button onClick={() => addToCart(product)} style={{ background: '#2d9653', color: 'white', border: 'none', borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>+ Add</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                {cart.length > 0 && (
                  <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f1f5f9' }}>
                    <button onClick={() => setShowProductsPayment(true)} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>🛒 {cart.reduce((s, c) => s + c.qty, 0)} item(s)</span><span>₹{cartTotal} → Choose Payment</span>
                    </button>
                    <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6, fontWeight: 600 }}>
                      Tap "Done ✓" at top to review & confirm
                    </div>
                  </div>
                )}
              </>
            )}
          </ModalShell>
        )}

        {/* ══ NO CREDITS — CHOICE MODAL ══ */}
        {showNoCreditOptions && (
          <ModalShell onClose={() => setShowNoCreditOptions(false)}>
            <div style={{ padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🤔</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', marginBottom: 6 }}>No Shake Credits</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 28, lineHeight: 1.6 }}>
                {shakeCredits <= GRACE_LIMIT
                  ? 'Grace limit reached. Member must purchase a new plan to continue.'
                  : 'Credits are running low. Purchase a plan to add more credits.'}
              </div>
              <button
                onClick={() => { setShowNoCreditOptions(false); setPurchasePlanId(''); setPlanPurchaseSuccess(false); setPlanPurchaseVerifiedBy(''); setShowPlanPurchase(true); }}
                style={{ width: '100%', padding: '20px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 16, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', boxShadow: '0 4px 16px rgba(45,150,83,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              >
                <span style={{ fontSize: 24 }}>📋</span> Buy Shake Credits
              </button>
            </div>
          </ModalShell>
        )}

        {/* ══ ONE-DAY SHAKE MODAL ══ */}
        {showOneDayShake && (() => {
          const ONEDAY_PRICE = 240;
          const prepaidDays = Number(selectedMember?.oneDayShakeCredits) || 0;
          const canRedeem = prepaidDays > 0 && oneDayShakeRedeemMode;
          const closeModal = () => {
            setShowOneDayShake(false);
            setOneDayShakeStep('select');
            setOneDayShakeItem(null);
            setOneDayShakeVerifiedBy('');
            setOneDayShakeDays(1);
            setOneDayShakeRedeemMode(false);
          };
          return (
          <ModalShell onClose={closeModal}>
            {oneDayShakeStep === 'done' ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 16px' }}>✅</div>
                {oneDayShakeVerifiedBy === 'Prepaid redemption' ? (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#166534', marginBottom: 6 }}>Prepaid Day Redeemed</div>
                    <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
                      {oneDayShakeItem?.itemName || oneDayShakeItem?.name || 'Shake'} — One-Day Shake
                    </div>
                    <div style={{ fontSize: 13, color: '#2d9653', fontWeight: 700, marginBottom: 20 }}>
                      {Math.max(0, prepaidDays - 1)} prepaid day{Math.max(0, prepaidDays - 1) !== 1 ? 's' : ''} remaining
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#166534', marginBottom: 6 }}>Payment Collected!</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: '#2d9653', marginBottom: 8 }}>₹{ONEDAY_PRICE * (oneDayShakeDays || 1)}</div>
                    <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
                      {oneDayShakeItem?.itemName || oneDayShakeItem?.name || 'Shake'} — One-Day Shake{oneDayShakeDays > 1 ? ` × ${oneDayShakeDays} days` : ''}
                    </div>
                    {oneDayShakeDays > 1 && (
                      <div style={{ fontSize: 12, color: '#0284c7', fontWeight: 700, marginBottom: 4 }}>
                        ✨ {oneDayShakeDays - 1} prepaid day{oneDayShakeDays - 1 !== 1 ? 's' : ''} banked for future visits
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: '#2d9653', fontWeight: 700, marginBottom: 20 }}>
                      Collected by: {oneDayShakeVerifiedBy}
                    </div>
                  </>
                )}
                <button onClick={closeModal} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                  Done
                </button>
              </div>
            ) : oneDayShakeStep === 'payment' ? (() => {
              const totalPrice = ONEDAY_PRICE * (oneDayShakeDays || 1);
              const v = validateTopupPayment(oneDayPayment, totalPrice, { requireUpiAccount: upiAccounts.length > 0 });
              return (
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a' }}>☕ One-Day Shake</div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>{oneDayShakeItem?.itemName || oneDayShakeItem?.name}</div>
                  </div>
                  <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '8px 14px', textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#2d9653', lineHeight: 1 }}>₹{totalPrice}</div>
                    {oneDayShakeDays > 1 && (
                      <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>₹{ONEDAY_PRICE} × {oneDayShakeDays} days</div>
                    )}
                  </div>
                </div>

                {/* Days picker — defaults to 1, but customer can prepay 2 or 3 days at once */}
                <div style={{ marginBottom: 14, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>How many days are they paying for?</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {[1, 2, 3].map(d => {
                      const active = oneDayShakeDays === d;
                      return (
                        <button
                          key={d}
                          onClick={() => {
                            setOneDayShakeDays(d);
                            // Reset payment amounts so split totals re-calc cleanly
                            setOneDayPayment(emptyPaymentSelection);
                          }}
                          style={{
                            padding: '12px 8px',
                            border: `2.5px solid ${active ? '#2d9653' : '#e5e7eb'}`,
                            background: active ? '#f0fdf4' : 'white',
                            borderRadius: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                          }}
                        >
                          <div style={{ fontSize: 18, fontWeight: 900, color: active ? '#166534' : '#1a3a2a' }}>{d} day{d > 1 ? 's' : ''}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#2d9653' : '#6b7280' }}>₹{ONEDAY_PRICE * d}</div>
                          {d > 1 && <div style={{ fontSize: 9, color: '#0284c7', fontWeight: 700 }}>1 today + {d - 1} prepaid</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ overflowY: 'auto', flex: 1, marginBottom: 12 }}>
                  <PaymentMethodPicker
                    total={totalPrice}
                    upiAccounts={upiAccounts}
                    value={oneDayPayment}
                    onChange={setOneDayPayment}
                  />
                  {!v.ok && v.reason && (
                    <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700, marginTop: 8 }}>{v.reason}</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => { setOneDayShakeStep('select'); setOneDayPayment(emptyPaymentSelection); setOneDayShakeDays(1); }}
                    style={{ flex: 1, padding: '14px', background: '#f3f4f6', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >← Back</button>
                  <button
                    disabled={!v.ok}
                    onClick={() => {
                      // Sync legacy paymentMethod state so completeOneDayShake's
                      // existing branches still see the chosen method.
                      setPaymentMethod(oneDayPayment.method);
                      setSelectedUpiAccount(oneDayPayment.upiAccountId
                        ? upiAccounts.find((u: any) => u.id === oneDayPayment.upiAccountId) || null
                        : null);
                      setShowOneDayShake(false);
                      verifyActionRef.current = 'oneday_shake';
                      setScreen('accountant_select');
                    }}
                    style={{ flex: 2, padding: '14px', background: !v.ok ? '#d1d5db' : 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: !v.ok ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    Verify ₹{totalPrice} →
                  </button>
                </div>
              </div>
              );
            })() : (
              /* Step: select shake */
              <>
                <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>☕ One-Day Shake</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                      {canRedeem
                        ? <>Pick a shake to <strong style={{ color: '#0284c7' }}>redeem 1 prepaid day</strong></>
                        : <>Select a shake · <strong style={{ color: '#2d9653' }}>₹{ONEDAY_PRICE}</strong> per day</>}
                    </div>
                  </div>
                  <button onClick={closeModal} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                {/* Prepaid credits banner — appears when member has banked days from a previous multi-day purchase */}
                {prepaidDays > 0 && (
                  <div style={{ margin: '12px 24px 0', padding: '12px 14px', background: oneDayShakeRedeemMode ? '#eff6ff' : '#fffbeb', border: `2px solid ${oneDayShakeRedeemMode ? '#3b82f6' : '#f59e0b'}`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{oneDayShakeRedeemMode ? '🎟️' : '💰'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: oneDayShakeRedeemMode ? '#1e40af' : '#92400e' }}>
                        {prepaidDays} prepaid day{prepaidDays !== 1 ? 's' : ''} available
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 1 }}>
                        {oneDayShakeRedeemMode
                          ? 'Pick any shake — no payment needed.'
                          : 'Currently buying new days. Tap "Redeem" to use prepaid instead.'}
                      </div>
                    </div>
                    <button
                      onClick={() => setOneDayShakeRedeemMode(m => !m)}
                      style={{
                        padding: '8px 14px',
                        background: oneDayShakeRedeemMode ? '#3b82f6' : 'white',
                        color: oneDayShakeRedeemMode ? 'white' : '#0284c7',
                        border: `2px solid ${oneDayShakeRedeemMode ? '#3b82f6' : '#bfdbfe'}`,
                        borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        fontFamily: 'Nunito,sans-serif',
                      }}
                    >
                      {oneDayShakeRedeemMode ? 'Buying new' : 'Redeem'}
                    </button>
                  </div>
                )}

                <div style={{ overflowY: 'auto', padding: '16px 24px 24px', flex: 1 }}>
                  {todaysSpecials.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
                      <div style={{ fontSize: 40, marginBottom: 8 }}>🥤</div>
                      <div>No shakes available today</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {todaysSpecials.filter(i => i.stockType !== 'limited' || (i.remainingStock || 0) > 0).map(shake => (
                        <button
                          key={shake.id}
                          disabled={oneDayShakeRedeeming}
                          onClick={() => {
                            if (canRedeem) {
                              // Prepaid redeem path — no payment, no accountant verify.
                              // Pass the shake directly to avoid relying on state flush.
                              void redeemOneDayShake(shake);
                            } else {
                              setOneDayShakeItem(shake);
                              setOneDayShakeStep('payment');
                              setOneDayShakeDays(1);
                              setPaymentMethod('');
                              setSelectedUpiAccount(null);
                            }
                          }}
                          style={{ width: '100%', padding: '14px 16px', background: 'white', border: `2px solid ${canRedeem ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 14, cursor: oneDayShakeRedeeming ? 'not-allowed' : 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: oneDayShakeRedeeming ? 0.5 : 1 }}
                        >
                          {shake.imageUrl && <img src={shake.imageUrl} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a' }}>{shake.itemName || shake.name}</div>
                            {shake.stockType === 'limited' && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>{shake.remainingStock} left</div>}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: canRedeem ? '#0284c7' : '#2d9653' }}>
                            {canRedeem ? '🎟️ Redeem' : '₹240'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </ModalShell>
          );
        })()}

        {/* ══ PAYMENT METHOD MODAL ══ */}
        {showPaymentModal && (() => {
          const planTotal = (clubMemberships.find(p => p.id === purchasePlanId)?.price || 0);
          const v = validatePayment(planPayment, planTotal, { requireUpiAccount: upiAccounts.length > 0 });
          return (
          <ModalShell onClose={() => setShowPaymentModal(false)}>
            <div style={{ padding: 24, overflowY: 'auto' }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', marginBottom: 6 }}>💳 Payment Method</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>
                How is {selectedMember?.name?.split(' ')[0]} paying for ₹{planTotal}?
              </div>

              {/* The shared picker — same Cash / UPI / Split control used by
                  guests, product sales and top-ups, so renewal cannot drift
                  from them again. */}
              <PaymentMethodPicker
                total={planTotal}
                upiAccounts={upiAccounts}
                value={planPayment}
                onChange={setPlanPayment}
              />

              {!v.ok && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>
                  {v.reason}
                </div>
              )}

              <button
                disabled={!v.ok}
                onClick={() => {
                  // Keep the legacy single-method state in step, because the
                  // accountant screen and the receipt still read it.
                  setPaymentMethod(planPayment.method === 'upi' ? 'upi' : 'cash');
                  setSelectedUpiAccount(
                    planPayment.upiAccountId
                      ? upiAccounts.find((u: any) => u.id === planPayment.upiAccountId) || null
                      : null,
                  );
                  setShowPaymentModal(false);
                  verifyActionRef.current = 'plan_purchase';
                  setScreen('accountant_select');
                }}
                style={{ width: '100%', padding: 16, marginTop: 16, background: v.ok ? 'linear-gradient(135deg,#2d9653,#16a34a)' : '#d1d5db', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: v.ok ? 'pointer' : 'not-allowed', fontFamily: 'Nunito,sans-serif' }}
              >
                Proceed to Verify →
              </button>
            </div>
          </ModalShell>
          );
        })()}

        {/* ══ PLAN PURCHASE MODAL ══ */}
        {showPlanPurchase && (
          <ModalShell onClose={() => setShowPlanPurchase(false)}>
            {planPurchaseSuccess ? (
              /* ── Success state ── */
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 16px' }}>✅</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#166534', marginBottom: 6 }}>Plan Activated!</div>
                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
                  {clubMemberships.find(p => p.id === purchasePlanId)?.name} — ₹{clubMemberships.find(p => p.id === purchasePlanId)?.price}
                </div>
                <div style={{ fontSize: 13, color: '#2d9653', fontWeight: 700, marginBottom: 20 }}>
                  Verified by: {planPurchaseVerifiedBy}
                </div>
                <button onClick={() => { setShowPlanPurchase(false); setPlanPurchaseSuccess(false); }} style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                  Done
                </button>
              </div>
            ) : (
              /* ── Plan selection ── */
              <>
                <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a' }}>📋 Buy Subscription</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>Member pays cash — accountant verifies</div>
                  </div>
                  <button onClick={() => setShowPlanPurchase(false)} style={{ width: 36, height: 36, background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
                  {/* Plan search — the club has enough plans that scrolling for
                      the right one at a busy desk was slow. */}
                  {(
                    <input
                      value={planSearch}
                      onChange={e => setPlanSearch(e.target.value)}
                      placeholder="Search plans…"
                      style={{
                        width: '100%', padding: '12px 16px', borderRadius: 12, fontSize: 14,
                        border: '2px solid #e5e7eb', outline: 'none', fontFamily: 'Nunito,sans-serif',
                        fontWeight: 600, marginBottom: 14,
                      }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                    {clubMemberships
                      .filter(plan => {
                        const pq = planSearch.toLowerCase().trim();
                        if (!pq) return true;
                        return (plan.name || '').toLowerCase().includes(pq)
                          || String(plan.durationDays ?? '').includes(pq)
                          || String(plan.price ?? '').includes(pq);
                      })
                      .map(plan => {
                      const isSelected = purchasePlanId === plan.id;
                      const tierColor = (plan.name || '').toLowerCase().includes('gold') ? '#d97706'
                        : (plan.name || '').toLowerCase().includes('silver') ? '#64748b'
                        : (plan.name || '').toLowerCase().includes('bronze') ? '#b45309' : '#2d9653';
                      // Show what the member will actually receive, using the
                      // same rule the sale uses — so the desk can see before
                      // committing that an access-only plan adds no credits.
                      const grants = planCreditsOf(plan);
                      const noCredits = planGrantsNoCredits(plan);
                      return (
                        <button
                          key={plan.id}
                          onClick={() => setPurchasePlanId(plan.id)}
                          style={{ width: '100%', padding: '18px', background: isSelected ? '#f0fdf4' : 'white', border: `2.5px solid ${isSelected ? '#2d9653' : '#e5e7eb'}`, borderRadius: 16, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left', position: 'relative' }}
                        >
                          {isSelected && <div style={{ position: 'absolute', top: 14, right: 16, fontSize: 18 }}>✅</div>}
                          <div style={{ fontSize: 16, fontWeight: 800, color: tierColor }}>{plan.name}</div>
                          <div style={{ fontSize: 13, color: noCredits ? '#b45309' : '#6b7280', marginTop: 3, fontWeight: noCredits ? 700 : 400 }}>
                            {planCreditsLabel(plan)} · {plan.durationDays || 30} days
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', marginTop: 6 }}>₹{plan.price}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {purchasePlanId && (() => {
                  const plan = clubMemberships.find(p => p.id === purchasePlanId);
                  return (
                    <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ background: '#fffbeb', borderRadius: 12, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #fde68a' }}>
                        <span style={{ fontSize: 20 }}>💳</span>
                        <div style={{ fontSize: 13, color: '#92400e', fontWeight: 700 }}>
                          Collect <strong>₹{plan?.price}</strong> from {selectedMember?.name?.split(' ')[0]}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setPaymentMethod('');
                          setSelectedUpiAccount(null);
                          // Start from nothing selected. Without this the picker
                          // opened holding the PREVIOUS member's choice — and if
                          // their plan cost the same, a carried-over split even
                          // validated, so one tap wrote someone's cash payment
                          // as UPI, or as a split they never made.
                          setPlanPayment(emptyPaymentSelection);
                          setShowPlanPurchase(false);
                          setShowPaymentModal(true);
                        }}
                        style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', boxShadow: '0 4px 16px rgba(45,150,83,0.4)' }}
                      >
                        Select Payment Method →
                      </button>
                    </div>
                  );
                })()}
              </>
            )}
          </ModalShell>
        )}

        {/* ══ HERO ══ */}
        <div style={{ background: 'linear-gradient(160deg,#0a1f14 0%,#1a3a2a 60%,#0f2d1e 100%)', padding: '32px 24px 28px', textAlign: 'center', position: 'relative' }}>
          <button
            onClick={() => {
              // Returning to the member grid — wipe selection so the dashboard
              // doesn't briefly flash the previous member if reopened.
              setSelectedMember(null);
              setMemberWallet(null);
              setScreen('member_grid');
            }}
            style={{ position: 'absolute', top: 20, left: 20, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
          >
            ← Back
          </button>
          <button onClick={() => setScreen('done_summary')} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>Done ✓</button>
          {/* Avatar */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
            <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'linear-gradient(135deg, #22c55e, #16a34a)', padding: 3, display: 'inline-block' }}>
              {selectedMember.photoUrl ? (
                <img src={selectedMember.photoUrl} style={{ width: 86, height: 86, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ width: 86, height: 86, borderRadius: '50%', background: '#1a3a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, color: 'white', fontWeight: 900 }}>
                  {(selectedMember.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, background: '#22c55e', borderRadius: '50%', border: '2px solid #0a1f14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>✓</div>
          </div>
          <div style={{ color: 'white', fontSize: 24, fontWeight: 900, letterSpacing: -0.5 }}>{selectedMember.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 2, marginBottom: 10 }}>{selectedMember.phone || ''}</div>
          {/* Credits badge */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: hasShakeCredits ? 'linear-gradient(135deg,#2d9653,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)', borderRadius: 100, padding: '6px 16px', marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>🥤</span>
            <span style={{ color: 'white', fontSize: 13, fontWeight: 800 }}>{shakeCredits} Shake Credit{shakeCredits !== 1 ? 's' : ''}</span>
          </div>
          {/* Status pills */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ background: '#22c55e22', border: '1px solid #22c55e55', color: '#86efac', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100 }}>Checked In Today</span>
            {selectedMember.referredBy && (
              <span style={{ background: '#ffffff15', border: '1px solid #ffffff25', color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100 }}>Ref: {selectedMember.referredBy}</span>
            )}
          </div>
        </div>

        {/* ══ BODY CARD ══ */}
        <div style={{ background: '#f8fafc', borderRadius: '24px 24px 0 0', marginTop: -2, padding: '24px 20px 32px' }}>

          {/* ── Shake Credits Card ── */}
          {hasShakeCredits ? (
            <div style={{ background: 'white', borderRadius: 20, padding: '18px 20px', marginBottom: 14, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#1a3a2a' }}>Shake Credits</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>🥤 {shakeCredits} of {shakeCreditsPlanTotal} remaining</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, color: shakeCredits <= 3 ? '#f59e0b' : '#2d9653' }}>{shakeCredits}</div>
              </div>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${creditsPct}%`, background: shakeCredits <= 3 ? '#f59e0b' : '#2d9653', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: 20, padding: '20px', marginBottom: 14, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', border: '2px dashed #fca5a5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ flex: 1, paddingRight: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#ef4444' }}>No Shake Credits</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.6 }}>
                    No shake credits remaining. Buy a plan to order shakes.
                  </div>
                </div>
                <div style={{ fontSize: 34 }}>🥤</div>
              </div>
              <button onClick={() => setShowNoCreditOptions(true)} style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                Buy Shake Credits
              </button>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Wallet', value: `₹${walBal}`, color: '#2d9653', bg: '#f0fdf4' },
              { label: 'Member Since', value: memberSince, color: '#d97706', bg: '#fffbeb' },
              { label: 'Credits Used', value: creditsUsed, color: '#6366f1', bg: '#f5f3ff' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: '12px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Order message */}
          {orderMessage && (
            <div style={{ background: orderMessage.startsWith('✅') ? '#dcfce7' : '#fde8e8', border: `1px solid ${orderMessage.startsWith('✅') ? '#86efac' : '#fca5a5'}`, borderRadius: 12, padding: '12px 16px', fontSize: 14, fontWeight: 700, color: orderMessage.startsWith('✅') ? '#166534' : '#ef4444', marginBottom: 14, textAlign: 'center' }}>
              {orderMessage}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <button
              onClick={() => (hasShakeCredits) ? setShowOrderModal(true) : setShowNoCreditOptions(true)}
              style={{ padding: '18px 8px', background: (hasShakeCredits) ? 'linear-gradient(135deg,#f59e0b,#d97706)' : '#e5e7eb', color: (hasShakeCredits) ? 'white' : '#9ca3af', border: 'none', borderRadius: 16, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: (hasShakeCredits) ? '0 4px 14px rgba(245,158,11,0.35)' : 'none', position: 'relative' }}
            >
              <span style={{ fontSize: 24 }}>{(hasShakeCredits) ? '🥤' : '🔒'}</span>
              <span>Order Shake</span>
              {!(hasShakeCredits) && <span style={{ fontSize: 9, fontWeight: 600, color: '#ef4444' }}>Buy plan first</span>}
              {shakeCredits > 0 && <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{shakeCredits} credit{shakeCredits !== 1 ? 's' : ''}</span>}
            </button>
            <button
              onClick={() => {
                const prepaid = Number(selectedMember?.oneDayShakeCredits) || 0;
                setShowOneDayShake(true);
                setOneDayShakeStep('select');
                setOneDayShakeItem(null);
                setOneDayShakeVerifiedBy('');
                setOneDayShakeDays(1);
                // If the member has prepaid days banked, default to redeem
                // mode. They can toggle off in the banner to buy new days.
                setOneDayShakeRedeemMode(prepaid > 0);
                setOneDayPayment(emptyPaymentSelection);
              }}
              style={{ padding: '18px 8px', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white', border: 'none', borderRadius: 16, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: '0 4px 14px rgba(249,115,22,0.35)', position: 'relative' }}
            >
              {/* Prepaid badge — visible at a glance so the receptionist knows
                  this member can redeem instead of pay. */}
              {Number(selectedMember?.oneDayShakeCredits) > 0 && (
                <span style={{ position: 'absolute', top: -8, right: -8, background: '#0284c7', color: 'white', fontSize: 11, fontWeight: 900, padding: '3px 8px', borderRadius: 20, border: '2px solid white', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
                  🎟️ {Number(selectedMember.oneDayShakeCredits)}
                </span>
              )}
              <span style={{ fontSize: 24 }}>☕</span>
              <span>One-Day Shake</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
                {Number(selectedMember?.oneDayShakeCredits) > 0
                  ? `${Number(selectedMember.oneDayShakeCredits)} prepaid · ₹240`
                  : '₹240'}
              </span>
            </button>
            <button onClick={() => setShowBuyModal(true)} style={{ padding: '18px 8px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none', borderRadius: 16, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
              <span style={{ fontSize: 24 }}>🛍️</span>
              <span>Buy Products</span>
            </button>
          </div>
          <button onClick={() => { setTopupAmount(''); setTopupPin(''); setTopupPinError(''); setTopupSuccess(false); setScreen('topup'); }} style={{ width: '100%', padding: '16px', background: 'white', color: '#1a3a2a', border: '2px solid #e2e8f0', borderRadius: 16, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            💰 Top-up Wallet
          </button>

          {/* ── Shake Preferences button (opens modal) ── */}
          <button
            onClick={() => setShowShakePrefs(true)}
            style={{
              width: '100%', padding: '14px', background: 'white', color: '#1a3a2a',
              border: '2px solid #e2e8f0', borderRadius: 16, fontSize: 14, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'Nunito,sans-serif', marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            ☕ Shake Preferences
          </button>

          {/* ── Member Details Panel: plan, attendance, stats, activity, body, coach ── */}
          {clubId && selectedMember && (
            <MemberDetailsPanel clubId={clubId} member={selectedMember} memberPlan={memberPlan} />
          )}

          {/* Shake preferences modal */}
          {showShakePrefs && clubId && selectedMember && (
            <div onClick={() => setShowShakePrefs(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', padding: 20, fontFamily: 'Nunito,sans-serif' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a' }}>☕ Shake Preferences — {selectedMember.name}</div>
                  <button onClick={() => setShowShakePrefs(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280' }}>✕</button>
                </div>
                <ShakePreferencesEditor clubId={clubId} member={selectedMember} />
              </div>
            </div>
          )}

          {(() => {
            const pendingShakeQty = shakeCart.reduce((s, c) => s + (c.qty || 1), 0);
            const pendingProductQty = cart.reduce((s, c) => s + (c.qty || 1), 0);
            const totalPending = pendingShakeQty + pendingProductQty;
            return (
              <button onClick={() => setScreen('done_summary')} style={{ width: '100%', padding: '18px', background: totalPending > 0 ? 'linear-gradient(135deg,#d97706,#b45309)' : 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 16, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', boxShadow: totalPending > 0 ? '0 4px 16px rgba(217,119,6,0.4)' : '0 4px 16px rgba(45,150,83,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {totalPending > 0
                  ? `⏳ Done ✓ — Review (${totalPending} pending)`
                  : '✅ Done — View Summary'}
              </button>
            );
          })()}
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // DONE SUMMARY
  // ─────────────────────────────
  if (screen === 'done_summary') {
    const doneShakeCredits: number = selectedMember?.shakeCredits ?? 0;
    const doneShakeCreditsPlanTotal: number = selectedMember?.shakeCreditsPlanTotal ?? 0;
    const finalBalance = memberWallet?.balance || 0;

    // A split is entered against the cart total in the payment chooser, but
    // this screen still offers +/- and "Add more" underneath. Changing the cart
    // afterwards left the split describing a total that no longer existed, and
    // the payment was written with parts that did not add up to the whole.
    // Confirm is blocked until the two agree again.
    const cartTotalNow = cart.reduce((s: number, c: any) => s + (c.price || 0) * c.qty, 0);
    const productsSplitStale =
      cart.length > 0 &&
      productsPayMethod === 'split' &&
      Math.abs(cartTotalNow - ((productsPayment.cashAmount || 0) + (productsPayment.upiAmount || 0))) > 0.5;

    const printSummary = () => {
      const sessionItems: Array<{ label: string; qty: number; amount: number; type: 'order' | 'topup' }> = [];
      for (const entry of sessionLog) {
        if (entry.type === 'shake') {
          sessionItems.push({ label: entry.label || 'Shake', qty: 1, amount: entry.amount || 0, type: 'order' });
        } else if (entry.type === 'shakes') {
          for (const it of (entry.items || [])) {
            sessionItems.push({ label: it.name || 'Shake', qty: it.qty || 1, amount: (it.price || 0) * (it.qty || 1), type: 'order' });
          }
        } else if (entry.type === 'topup') {
          sessionItems.push({ label: 'Wallet Top-up', qty: 1, amount: entry.amount || 0, type: 'topup' });
        } else if (entry.type === 'products') {
          for (const it of (entry.items || [])) {
            sessionItems.push({ label: it.name || 'Product', qty: it.qty || 1, amount: (it.price || 0) * (it.qty || 1), type: 'order' });
          }
        }
      }
      fetchClubAndPrint(clubId, (freshClub) =>
        buildSessionSummaryReceipt({
          club: freshClub,
          memberName: selectedMember?.name || '',
          memberId: selectedMember?.id || selectedMember?.memberId || '',
          shakeCredits: doneShakeCredits,
          shakeCreditsPlanTotal: doneShakeCreditsPlanTotal,
          sessionItems,
          finalBalance,
          timestamp: new Date(),
          receiptNumber: generateTxnId(),
        })
      );
    };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0a1f14,#1a3a2a)', fontFamily: 'Nunito, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 420, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg,#2d9653,#16a34a)', padding: '28px 24px', textAlign: 'center' }}>
            {selectedMember?.photoUrl ? (
              <img src={selectedMember.photoUrl} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid white', marginBottom: 10 }} />
            ) : (
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: 'white', fontWeight: 900, margin: '0 auto 10px', border: '3px solid white' }}>
                {(selectedMember?.name || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ color: 'white', fontSize: 22, fontWeight: 900 }}>{selectedMember?.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }}>🥤 Shake Credits: {doneShakeCredits} / {doneShakeCreditsPlanTotal}</div>
          </div>

          <div style={{ padding: '20px 24px' }}>
            {/* ── PENDING: shake cart + product cart (deferred until Confirm) ── */}
            {(shakeCart.length > 0 || cart.length > 0) && (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>⏳ Pending — Review & Confirm</div>

                {/* Pending shakes */}
                {shakeCart.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>🥤 Shakes ({shakeCart.reduce((s, c) => s + (c.qty || 1), 0)} credits)</div>
                    {shakeCart.map((c: any, idx: number) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                        <span style={{ fontSize: 14 }}>🥤</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a' }}>{c.name || c.itemName || 'Shake'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={() => setShakeCart(prev => { const next = [...prev]; const newQty = (next[idx].qty || 1) - 1; if (newQty <= 0) return next.filter((_, i) => i !== idx); next[idx] = { ...next[idx], qty: newQty }; return next; })} style={{ width: 24, height: 24, borderRadius: 6, border: '1.5px solid #fcd34d', background: 'white', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}>−</button>
                          <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 800 }}>{c.qty}</span>
                          <button onClick={() => setShakeCart(prev => prev.map((x, i) => i === idx ? { ...x, qty: (x.qty || 1) + 1 } : x))} style={{ width: 24, height: 24, borderRadius: 6, border: '1.5px solid #86efac', background: '#f0fdf4', fontSize: 14, fontWeight: 900, cursor: 'pointer', color: '#16a34a' }}>+</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => { setScreen('member_dashboard'); setShowOrderModal(true); }} style={{ width: '100%', marginTop: 8, padding: '8px', background: 'white', border: '1.5px dashed #fcd34d', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#92400e', cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>+ Add more shakes</button>
                  </div>
                )}

                {/* Pending products */}
                {cart.length > 0 && (
                  <div style={{ background: '#eef2ff', border: '1.5px solid #c7d2fe', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#3730a3', marginBottom: 8 }}>🛍️ Products · ₹{cart.reduce((s, c) => s + (c.price || 0) * c.qty, 0)} {productsPayMethod ? `· ${productsPayMethod === 'wallet' ? '💳 Wallet' : productsPayMethod === 'cash' ? '💵 Cash' : productsPayMethod === 'upi' ? '📱 UPI' : '⚡ Split'}` : ''}</div>
                    {cart.map((c: any, idx: number) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a' }}>{c.name || c.itemName || 'Product'}</div>
                          <div style={{ fontSize: 10, color: '#6b7280' }}>₹{c.price} × {c.qty} = ₹{(c.price || 0) * c.qty}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={() => setCart(prev => { const next = [...prev]; const newQty = (next[idx].qty || 1) - 1; if (newQty <= 0) return next.filter((_, i) => i !== idx); next[idx] = { ...next[idx], qty: newQty }; return next; })} style={{ width: 24, height: 24, borderRadius: 6, border: '1.5px solid #c7d2fe', background: 'white', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}>−</button>
                          <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 800 }}>{c.qty}</span>
                          <button onClick={() => setCart(prev => prev.map((x, i) => i === idx ? { ...x, qty: (x.qty || 1) + 1 } : x))} style={{ width: 24, height: 24, borderRadius: 6, border: '1.5px solid #86efac', background: '#f0fdf4', fontSize: 14, fontWeight: 900, cursor: 'pointer', color: '#16a34a' }}>+</button>
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => { setScreen('member_dashboard'); setShowBuyModal(true); }} style={{ flex: 1, padding: '8px', background: 'white', border: '1.5px dashed #c7d2fe', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#3730a3', cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>+ Add more</button>
                      <button onClick={() => { setScreen('member_dashboard'); setShowBuyModal(true); setShowProductsPayment(true); }} style={{ flex: 1, padding: '8px', background: 'white', border: '1.5px dashed #c7d2fe', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#3730a3', cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>Change payment</button>
                    </div>
                  </div>
                )}

                {/* Confirm All button */}
                <button
                  onClick={confirmAllPending}
                  disabled={isCheckingOut || (cart.length > 0 && !productsPayMethod) || productsSplitStale}
                  style={{ width: '100%', padding: '16px', background: (isCheckingOut || (cart.length > 0 && !productsPayMethod) || productsSplitStale) ? '#d1d5db' : 'linear-gradient(135deg,#16a34a,#15803d)', color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', marginBottom: 16, boxShadow: '0 4px 14px rgba(22,163,74,0.35)' }}
                >
                  {isCheckingOut ? 'Confirming...' : productsSplitStale ? '⚠️ Cart changed — set the payment again' : '✅ Confirm All'}
                </button>
                {productsSplitStale && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 800, color: '#92400e', marginBottom: 12, textAlign: 'center' }}>
                    The cart changed after the split was entered — ₹{cartTotalNow} now, but the split adds up to ₹{(productsPayment.cashAmount || 0) + (productsPayment.upiAmount || 0)}. Tap Change payment to re-enter it.
                  </div>
                )}
                {orderMessage && (
                  <div style={{ background: orderMessage.startsWith('✅') ? '#dcfce7' : '#fde8e8', border: `1px solid ${orderMessage.startsWith('✅') ? '#86efac' : '#fca5a5'}`, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: orderMessage.startsWith('✅') ? '#166534' : '#991b1b', marginBottom: 12, textAlign: 'center' }}>
                    {orderMessage}
                  </div>
                )}
              </>
            )}

            {/* Today's Activity */}
            <div style={{ fontSize: 13, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Today's Summary</div>

            {sessionLog.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af', fontSize: 14 }}>Just checked in — no transactions today</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {sessionLog.map((entry, i) => (
                  <div key={i} style={{ background: '#f8fafc', borderRadius: 12, padding: '12px 14px' }}>
                    {entry.type === 'shake' && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#1a3a2a' }}>
                          <span>🥤 {entry.label}</span><span style={{ color: '#ef4444' }}>−₹{entry.amount}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>₹{entry.oldBalance} → ₹{entry.newBalance}</div>
                      </>
                    )}
                    {entry.type === 'shakes' && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a', marginBottom: 4 }}>🥤 Shakes Ordered</div>
                        {(entry.items || []).map((it: any, j: number) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#374151' }}>
                            <span>{it.name} × {it.qty}</span><span style={{ color: '#ef4444' }}>−₹{(it.price || 0) * it.qty}</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>₹{entry.oldBalance} → ₹{entry.newBalance}</div>
                      </>
                    )}
                    {entry.type === 'topup' && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#1a3a2a' }}>
                          <span>💰 Wallet Top-up</span><span style={{ color: '#2d9653' }}>+₹{entry.amount}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>₹{entry.oldBalance} → ₹{entry.newBalance}</div>
                      </>
                    )}
                    {entry.type === 'products' && (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a', marginBottom: 4 }}>🛍️ Products Purchased</div>
                        {entry.items.map((it: any, j: number) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#374151' }}>
                            <span>{it.name} × {it.qty}</span><span style={{ color: '#ef4444' }}>−₹{it.price * it.qty}</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>₹{entry.oldBalance} → ₹{entry.newBalance}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Final Balance */}
            <div style={{ background: '#f0fdf4', borderRadius: 14, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>Current Wallet Balance</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#2d9653' }}>₹{finalBalance}</span>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => setScreen('member_dashboard')}
                style={{ width: '100%', padding: '13px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                ← Back to Dashboard
              </button>
              <button onClick={printSummary}
                style={{ width: '100%', padding: '14px', background: '#374151', color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                🖨️ Print Receipt
              </button>
              <button onClick={goHome}
                style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                ✅ Done — Next Person
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // PENDING CONFIRMED — shown after face scan when member had a pre-order
  // ─────────────────────────────
  if (screen === 'pending_confirmed' && confirmedOrder) {
    const { member, pending, walletOk, newBalance } = confirmedOrder;
    const items: any[] = pending.items || [];
    const total = pending.totalAmount || 0;
    return (
      <div style={{
        minHeight: '100vh',
        background: walletOk
          ? 'linear-gradient(135deg,#052e16,#14532d,#166534)'
          : 'linear-gradient(135deg,#1c0707,#450a0a,#7f1d1d)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Nunito, sans-serif', padding: 24,
      }}>
        {/* Big animated checkmark / warning */}
        <div style={{
          width: 120, height: 120, borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 64, marginBottom: 24,
          animation: 'popIn 0.4s ease',
        }}>
          {walletOk ? '✅' : '⚠️'}
        </div>

        {/* Member name */}
        <div style={{ color: 'white', fontSize: 28, fontWeight: 900, textAlign: 'center', marginBottom: 4 }}>
          {walletOk ? `Welcome, ${member.name?.split(' ')[0]}! 🎉` : `Hi, ${member.name?.split(' ')[0]}`}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>
          {walletOk ? 'Check-in & order sent to kitchen ✅' : 'Checked in & order sent — shake credits low ⚠️'}
        </div>

        {/* Order card */}
        <div style={{
          background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(10px)',
          borderRadius: 20, padding: '20px 24px', width: '100%', maxWidth: 380,
          marginBottom: 20, border: '1px solid rgba(255,255,255,0.2)',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
            🥤 Pre-Order Summary
          </div>
          {items.map((item: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ color: 'white', fontSize: 15, fontWeight: 700 }}>{item.name} × {item.qty}</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600 }}>₹{(item.price || 0) * item.qty}</div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: 'white', fontSize: 16, fontWeight: 900 }}>Total</div>
            <div style={{ color: 'white', fontSize: 18, fontWeight: 900 }}>₹{total}</div>
          </div>
        </div>

        {/* Wallet status */}
        <div style={{
          background: walletOk ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
          border: `1px solid ${walletOk ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
          borderRadius: 14, padding: '14px 20px', width: '100%', maxWidth: 380,
          marginBottom: 24, textAlign: 'center',
        }}>
          {walletOk ? (
            <>
              <div style={{ color: '#86efac', fontSize: 13, fontWeight: 700 }}>💰 Wallet debited ₹{total}</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 }}>New balance: ₹{newBalance ?? '…'}</div>
            </>
          ) : (
            <>
              <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 700 }}>❌ Insufficient wallet balance (₹{newBalance} available)</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 }}>Order was recorded but payment not collected. Please top up.</div>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 380 }}>
          {!walletOk && (
            <button
              onClick={() => {
                setSelectedMember(member);
                setTopupAmount(''); setTopupPin(''); setTopupPinError(''); setTopupSuccess(false);
                setScreen('topup');
              }}
              style={{ padding: '16px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
            >
              💰 Top-up Wallet Now
            </button>
          )}
          <button
            onClick={() => {
              setConfirmedOrder(null);
              goHome();
            }}
            style={{ padding: '18px', background: 'rgba(255,255,255,0.95)', color: '#0f2d1e', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
          >
            ✅ Done — Next Person
          </button>
        </div>

        <style>{`
          @keyframes popIn {
            0%  { transform: scale(0.5); opacity: 0 }
            70% { transform: scale(1.1) }
            100%{ transform: scale(1); opacity: 1 }
          }
        `}</style>
      </div>
    );
  }

  // ─────────────────────────────
  // OTP FALLBACK
  // ─────────────────────────────
  if (screen === 'otp_fallback') {
    return (
      <div style={{ ...S.darkPage, padding: 20 }}>
        <div style={{ ...S.card, maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔐</div>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', marginBottom: 8 }}>OTP Verification</h2>
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 20 }}>
            OTP sent to <strong>{selectedMember?.name}</strong>'s member app. Ask them to check their phone and tell you the code.
          </p>
          <input type="tel" inputMode="numeric" placeholder="6-digit OTP" value={otpInput} onChange={e => setOtpInput(e.target.value)} maxLength={6}
            style={{ width: '100%', padding: '14px', border: '1.5px solid #e0f0e9', borderRadius: 12, fontSize: 28, fontWeight: 700, textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace, Nunito', marginBottom: 12, boxSizing: 'border-box', outline: 'none' }} />
          <input type="password" inputMode="numeric" placeholder="Reception PIN" value={otpPinInput} onChange={e => setOtpPinInput(e.target.value)} maxLength={4}
            style={{ width: '100%', padding: '14px', border: '1.5px solid #e0f0e9', borderRadius: 12, fontSize: 20, fontWeight: 700, textAlign: 'center', letterSpacing: 4, fontFamily: 'Nunito, sans-serif', marginBottom: 12, boxSizing: 'border-box', outline: 'none' }} />
          {otpError && <p style={{ color: '#ef4444', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{otpError}</p>}
          <button onClick={verifyOtp} style={{ ...S.btn(), width: '100%', marginBottom: 12 }}>Verify & Check In</button>
          <button onClick={() => setScreen('member_grid')} style={{ background: 'transparent', border: 'none', color: '#6b7280', fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>← Back to members</button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // TOP-UP SCREEN
  // ─────────────────────────────
  if (screen === 'topup') {
    const topupBalanceAfter = (memberWallet?.balance || 0) + Number(topupAmount || 0);
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', padding: 20 }}>
        <div style={{ ...S.card, maxWidth: 420, width: '100%' }}>
          {topupSuccess ? (
            /* ── Success state ── */
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
              <h2 style={{ fontSize: 26, fontWeight: 900, color: '#2d9653', marginBottom: 6 }}>₹{sessionLog.filter(e => e.type === 'topup').slice(-1)[0]?.amount || 0} Added!</h2>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 4 }}>New balance: ₹{sessionLog.filter(e => e.type === 'topup').slice(-1)[0]?.newBalance ?? topupBalanceAfter}</p>
              {topupVerifiedBy && (
                <p style={{ color: '#374151', fontSize: 13, fontWeight: 700, marginBottom: 16 }}>
                  ✅ Verified by: <span style={{ color: '#2d9653' }}>{topupVerifiedBy}</span>
                </p>
              )}
              <button
                onClick={() => {
                  const lastTopup = sessionLog.filter(e => e.type === 'topup').slice(-1)[0] as any;
                  const amount = lastTopup?.amount || 0;
                  const balBefore = (memberWallet?.balance || 0);
                  fetchClubAndPrint(clubId, freshClub => buildTopupReceipt({
                    club: freshClub,
                    memberName: selectedMember?.name || '',
                    memberId: selectedMember?.memberId || selectedMember?.id || '',
                    amountAdded: amount,
                    balanceBefore: balBefore,
                    balanceAfter: balBefore + amount,
                    verifiedBy: topupVerifiedBy || 'Reception',
                    receiptId: generateTxnId(),
                    timestamp: new Date(),
                    paymentMethod: lastTopup?.paymentMethod ?? 'cash',
                    cashAmount: lastTopup?.cashAmount,
                    upiAmount: lastTopup?.upiAmount,
                    upiAccountName: lastTopup?.upiAccountName,
                  }));
                }}
                style={{ ...S.btn(), width: '100%', marginBottom: 12, fontSize: 14, padding: '14px' }}
              >
                🖨️ Print Receipt
              </button>
              <button onClick={() => { setTopupSuccess(false); setTopupVerifiedBy(''); setScreen('member_dashboard'); }} style={{ width: '100%', padding: '13px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', color: '#374151' }}>
                ← Back to Dashboard
              </button>
            </div>
          ) : (
            /* ── Amount entry ── */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <button onClick={() => setScreen('member_dashboard')} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16 }}>←</button>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>💰 Top-up Wallet</h2>
                  <div style={{ fontSize: 13, color: '#6b7280' }}>{selectedMember?.name} · Balance: ₹{memberWallet?.balance || 0}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {[200, 500, 1000, 1500, 2000, 3000].map(amt => (
                  <button key={amt} onClick={() => setTopupAmount(String(amt))} style={{ padding: '12px', border: topupAmount === String(amt) ? '2px solid #2d9653' : '1.5px solid #e0f0e9', borderRadius: 10, background: topupAmount === String(amt) ? '#f0fdf4' : 'white', color: topupAmount === String(amt) ? '#2d9653' : '#374151', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}>
                    ₹{amt}
                  </button>
                ))}
              </div>
              <input type="number" placeholder="Custom amount" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} style={{ width: '100%', padding: '14px', border: '1.5px solid #e0f0e9', borderRadius: 12, fontSize: 18, fontWeight: 700, fontFamily: 'Nunito, sans-serif', marginBottom: 14, boxSizing: 'border-box', outline: 'none' }} />

              <div style={{ marginBottom: 16 }}>
                <PaymentMethodPicker
                  total={Number(topupAmount) || 0}
                  upiAccounts={upiAccounts}
                  value={topupPayment}
                  onChange={setTopupPayment}
                />
              </div>

              <button
                onClick={() => {
                  const amt = Number(topupAmount);
                  if (!amt || amt <= 0) { setTopupPinError('Enter a valid amount first'); return; }
                  const v = validateTopupPayment(topupPayment, amt, { requireUpiAccount: upiAccounts.length > 0 });
                  if (!v.ok) { setTopupPinError(v.reason || 'Complete payment details'); return; }
                  setTopupPinError('');
                  setScreen('accountant_select');
                }}
                style={{ ...S.btn(), width: '100%', fontSize: 16, padding: '16px', marginBottom: 12 }}
              >
                ✅ Proceed to Accountant Verify
              </button>
              {topupPinError && <p style={{ color: '#ef4444', fontSize: 13, fontWeight: 600, marginTop: 8 }}>{topupPinError}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // ACCOUNTANT SELECT SCREEN
  // ─────────────────────────────
  if (screen === 'accountant_select') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', padding: 20 }}>
        <div style={{ ...S.card, maxWidth: 420, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button onClick={() => { stopCamera(); if (verifyActionRef.current === 'plan_purchase') { verifyActionRef.current = 'topup'; setShowPlanPurchase(true); setScreen('member_dashboard'); } else { setScreen('topup'); } }} style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 16 }}>←</button>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>👤 Accountant Verification</h2>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                Adding <strong style={{ color: '#2d9653' }}>₹{topupAmount}</strong> to {selectedMember?.name}'s wallet
              </div>
            </div>
          </div>

          <div style={{ background: '#fef9c3', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#854d0e', fontWeight: 600, marginBottom: 16 }}>
            💡 Cash collected. Tap the accountant to approve and record this entry.
          </div>

          {accountants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
              No accountants assigned. Ask admin to assign one in Settings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Select accountant to verify
              </div>
              {accountants.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => completeWithAccountant(acc)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'white', border: '1.5px solid #e0f0e9', borderRadius: 16, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left', transition: 'border-color 0.15s' }}
                >
                  {acc.photoUrl ? (
                    <img src={acc.photoUrl} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} alt="" />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,#2d9653,#16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'white', fontWeight: 900, flexShrink: 0 }}>
                      {(acc.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a' }}>{acc.name}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Tap to approve →</div>
                  </div>
                  <div style={{ fontSize: 22 }}>✓</div>
                </button>
              ))}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // ACCOUNTANT VERIFY SCREEN
  // ─────────────────────────────
  if (screen === 'accountant_verify') {
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(135deg,#0a1f14,#1a3a2a,#0f2d1e)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', position: 'relative',
      }}>
        <button
          onClick={() => { stopCamera(); setVerifyingAccountant(null); setFaceStatus(''); setScreen('accountant_select'); }}
          style={S.backBtn}
        >
          ← Back
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Accountant Verification
          </div>
          {verifyingAccountant?.photoUrl ? (
            <img src={verifyingAccountant.photoUrl} style={{ width: 68, height: 68, borderRadius: '50%', objectFit: 'cover', border: '3px solid #22c55e', marginBottom: 10 }} alt="" />
          ) : (
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'linear-gradient(135deg,#2d9653,#16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'white', fontWeight: 900, margin: '0 auto 10px' }}>
              {(verifyingAccountant?.name || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ color: 'white', fontSize: 22, fontWeight: 900 }}>{verifyingAccountant?.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 4 }}>
            Verifying ₹{topupAmount} top-up for {selectedMember?.name}
          </div>
        </div>

        {/* Camera */}
        <div style={{ position: 'relative', width: 300, height: 300, marginTop: 20 }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 300, height: 300, borderRadius: 20, objectFit: 'cover', transform: 'scaleX(-1)' }} />
          {[
            { top: 0, left: 0, borderTop: '4px solid #22c55e', borderLeft: '4px solid #22c55e', borderRadius: '16px 0 0 0' },
            { top: 0, right: 0, borderTop: '4px solid #22c55e', borderRight: '4px solid #22c55e', borderRadius: '0 16px 0 0' },
            { bottom: 0, left: 0, borderBottom: '4px solid #22c55e', borderLeft: '4px solid #22c55e', borderRadius: '0 0 0 16px' },
            { bottom: 0, right: 0, borderBottom: '4px solid #22c55e', borderRight: '4px solid #22c55e', borderRadius: '0 0 16px 0' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 44, height: 44, pointerEvents: 'none', ...s }} />
          ))}
          <div style={{ position: 'absolute', left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,transparent,#22c55e,transparent)', animation: 'scanLine 2s linear infinite', pointerEvents: 'none' }} />
        </div>

        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 20, fontWeight: 600, textAlign: 'center', padding: '0 40px' }}>
          {faceStatus || 'Look straight at the camera'}
        </div>

        <button
          onClick={() => { stopCamera(); setFaceStatus('Restarting camera…'); setTimeout(() => startAccountantFaceVerification(verifyingAccountant), 800); }}
          style={{ marginTop: 20, background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
        >
          ↺ Restart Camera
        </button>
        <style>{`@keyframes scanLine { 0% { top:10% } 50% { top:85% } 100% { top:10% } }`}</style>
      </div>
    );
  }

  // ─────────────────────────────
  // VOLUNTEER FACE VERIFY SCREEN
  // ─────────────────────────────
  if (screen === 'volunteer_verify') {
    return (
      <div style={{
        minHeight: '100vh', background: '#0d0d1a', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', position: 'relative',
      }}>
        <button
          onClick={() => { stopCamera(); setVerifyingVolunteer(null); setFaceStatus(''); setScreen('volunteer_grid'); }}
          style={S.backBtn}
        >
          ← Back
        </button>

        {/* Volunteer name + action */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {verifyingVolunteer?.photo || verifyingVolunteer?.photoUrl ? (
            <img
              src={verifyingVolunteer.photo || verifyingVolunteer.photoUrl}
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '3px solid #6366f1', marginBottom: 10 }}
            />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: 'white', fontWeight: 900, margin: '0 auto 10px' }}>
              {(verifyingVolunteer?.name || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ color: 'white', fontSize: 22, fontWeight: 900 }}>{verifyingVolunteer?.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 4 }}>
            {faceStatus || 'Position your face in the frame'}
          </div>
        </div>

        {/* Camera feed */}
        <div style={{ position: 'relative', width: 300, height: 300 }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: 300, height: 300, borderRadius: 20, objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
          {/* Corner brackets */}
          {[
            { top: 0, left: 0, borderTop: '4px solid #6366f1', borderLeft: '4px solid #6366f1', borderRadius: '16px 0 0 0' },
            { top: 0, right: 0, borderTop: '4px solid #6366f1', borderRight: '4px solid #6366f1', borderRadius: '0 16px 0 0' },
            { bottom: 0, left: 0, borderBottom: '4px solid #6366f1', borderLeft: '4px solid #6366f1', borderRadius: '0 0 0 16px' },
            { bottom: 0, right: 0, borderBottom: '4px solid #6366f1', borderRight: '4px solid #6366f1', borderRadius: '0 0 16px 0' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 44, height: 44, pointerEvents: 'none', ...s }} />
          ))}
          {/* Scanning line */}
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 3,
            background: 'linear-gradient(90deg,transparent,#6366f1,transparent)',
            animation: 'scanLine 2s linear infinite', pointerEvents: 'none',
          }} />
        </div>

        {/* Status */}
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 24, fontWeight: 600, textAlign: 'center', padding: '0 40px' }}>
          {faceStatus || 'Look straight at the camera'}
        </div>

        {/* No face enrolled warning */}
        {verifyingVolunteer && !verifyingVolunteer.faceDescriptor && (
          <div style={{ marginTop: 16, color: '#f87171', fontSize: 13, fontWeight: 700, textAlign: 'center', padding: '0 32px' }}>
            ⚠️ Face not enrolled. Ask admin to enrol this volunteer first.
          </div>
        )}

        {/* Restart camera button */}
        <button
          onClick={() => {
            stopCamera();
            setFaceStatus('Restarting camera…');
            setTimeout(() => startVolunteerFaceVerification(verifyingVolunteer), 800);
          }}
          style={{
            marginTop: 20, background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.3)',
            color: 'white', borderRadius: 12, padding: '10px 24px',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          ↺ Restart Camera
        </button>

        <style>{`@keyframes scanLine { 0% { top:10% } 50% { top:85% } 100% { top:10% } }`}</style>
      </div>
    );
  }

  // ─────────────────────────────
  // VOLUNTEER GRID — All members + timeline
  // ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════
  // FIRST DAY — record a free trial shake for a brand-new walk-in
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'first_day') {
    const inviterQ = fdInviterSearch.trim().toLowerCase();
    const inviterMatches = !inviterQ ? [] : (members as any[])
      .filter(m => (m.name || '').toLowerCase().includes(inviterQ) ||
                   (m.phone || '').toLowerCase().includes(inviterQ) ||
                   (m.memberId || '').toString().toLowerCase().includes(inviterQ))
      .slice(0, 8);

    const phoneClean = fdPhone.replace(/\D/g, '');
    const blocked = (fdLimitInfo?.count ?? 0) >= 2;

    const checkLimit = async (phone: string) => {
      const p = phone.replace(/\D/g, '');
      if (!clubId || p.length < 5) { setFdLimitInfo(null); return; }
      try {
        const snap = await getDocs(
          query(collection(db, 'clubs', clubId, 'guestEntries'),
                where('guestPhone', '==', p))
        );
        // Skip deleted entries. Guest deletion became a soft delete, so a
        // mistyped phone number that was deleted still counted against the two
        // free trials — and the real owner of that number was told they had
        // used a trial they never got.
        const fd = snap.docs.map(d => d.data() as any).filter(d => d.firstDay === true && !d.deleted);
        const lastDate = fd.map(d => d.date).sort().pop();
        setFdLimitInfo({ count: fd.length, lastDate });
      } catch (e) { console.error('[first_day] limit check', e); }
    };

    const submit = async (faceFile: File | null) => {
      if (!clubId) return;
      if (!fdName.trim() || phoneClean.length < 5) return;
      if (blocked) return;
      setFdSaving(true);
      try {
        const result = await addGuestEntry.mutateAsync({
          guestName: fdName.trim(),
          guestPhone: phoneClean,
          type: 'unpaid',
          items: [{
            type: 'shake',
            productId: 'first_day_shake',
            productName: 'First Day Shake',
            qty: 1,
            unitPrice: 0,
            // Photo flows to the order's memberPhoto (kitchen display reads
            // this) and to the guestEntry's guestPhoto (admin lookups).
            ...(faceFile ? { faceFiles: [faceFile] } : {}),
          }],
          totalAmount: 0,
          recordedBy: 'reception_first_day',
        });
        // Tag the entry as a First-Day so future lookups count toward the
        // 2-complimentary limit, and store who referred them.
        await updateDoc(doc(db, 'clubs', clubId, 'guestEntries', result.entryId), {
          firstDay: true,
          firstDayCountAtEntry: (fdLimitInfo?.count ?? 0) + 1,
          ...(fdInviter ? {
            invitedBy: {
              memberId: fdInviter.memberId || fdInviter.id,
              name: fdInviter.name,
              phone: fdInviter.phone || null,
            },
          } : {}),
        });
        const token = result.tokenNumbers?.[0];
        setFdResult({ name: fdName.trim(), token });
        playSuccessSound();
      } catch (e) {
        console.error('[first_day] save', e);
        alert('Failed to save First Day entry. Please try again.');
      }
      setFdSaving(false);
    };

    // Success view
    if (fdResult) {
      return (
        <div style={{ ...S.darkPage, padding: 24 }}>
          <div style={{ ...S.card, maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 72, marginBottom: 8 }}>☀️</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>Welcome, {fdResult.name}!</div>
            <div style={{ fontSize: 14, color: '#16a34a', fontWeight: 700, marginTop: 8 }}>
              First Day Shake sent to kitchen
            </div>
            {fdResult.token && (
              <div style={{ fontSize: 36, fontWeight: 900, color: '#1a3a2a', marginTop: 16, padding: '14px 0', background: '#f0fdf4', borderRadius: 12, border: '2px dashed #86efac' }}>
                Token #{fdResult.token}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button
                onClick={() => {
                  setFdName(''); setFdPhone(''); setFdInviter(null);
                  setFdInviterSearch(''); setFdLimitInfo(null); setFdResult(null);
                }}
                style={{ flex: 1, padding: 14, background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, fontWeight: 900, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
              >+ Another First Day</button>
              <button
                onClick={() => { setScreen('home'); setFdResult(null); }}
                style={{ flex: 1, padding: 14, background: '#2d9653', color: 'white', border: 'none', borderRadius: 12, fontWeight: 900, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
              >Done</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ ...S.darkPage, padding: 24, justifyContent: 'flex-start', paddingTop: 64 }}>
        <button onClick={() => setScreen('home')} style={S.backBtn}>← Back</button>
        <div style={{ ...S.card, maxWidth: 520, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <span style={{ fontSize: 36 }}>☀️</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>First Day</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Complimentary shake for new walk-ins</div>
            </div>
          </div>

          {blocked && (
            <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#991b1b', marginBottom: 4 }}>⚠ Already used 2 complimentary shakes</div>
              <div style={{ fontSize: 12, color: '#7f1d1d', fontWeight: 600 }}>
                This phone has already had 2 First Day shakes{fdLimitInfo?.lastDate ? ` (last: ${fdLimitInfo.lastDate})` : ''}. Use the Add Guest flow to take a paid order instead.
              </div>
            </div>
          )}

          {!blocked && fdLimitInfo && fdLimitInfo.count === 1 && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                ⚠ This is the 2nd (and final) complimentary shake for this number.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Mobile number</div>
              <input
                value={fdPhone}
                onChange={e => { setFdPhone(e.target.value); checkLimit(e.target.value); }}
                inputMode="tel"
                placeholder="10-digit mobile"
                autoFocus
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 15, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
              />
              {phoneClean.length >= 5 && fdLimitInfo && (
                <div style={{ fontSize: 12, fontWeight: 800, color: fdLimitInfo.count === 0 ? '#16a34a' : fdLimitInfo.count === 1 ? '#92400e' : '#dc2626', marginTop: 6 }}>
                  {fdLimitInfo.count === 0 ? '✓ 2 complimentary shakes available' :
                   fdLimitInfo.count === 1 ? '⚠ 1 complimentary shake available' :
                   '✗ This number is not eligible for complimentary shakes'}
                </div>
              )}
            </label>

            <label style={{ display: 'block' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Person name</div>
              <input
                value={fdName}
                onChange={e => setFdName(e.target.value)}
                placeholder="Full name"
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 15, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
              />
            </label>

            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Who invited / called them?</div>
              {fdInviter ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>{fdInviter.name}</div>
                    <div style={{ fontSize: 11, color: '#16a34a' }}>{fdInviter.memberId}{fdInviter.phone ? ` · ${fdInviter.phone}` : ''}</div>
                  </div>
                  <button onClick={() => { setFdInviter(null); setFdInviterSearch(''); }}
                    style={{ background: 'transparent', border: 'none', color: '#16a34a', fontSize: 18, cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <>
                  <input
                    value={fdInviterSearch}
                    onChange={e => setFdInviterSearch(e.target.value)}
                    placeholder="Type a name, phone or member ID…"
                    style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                  />
                  {inviterMatches.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 20, maxHeight: 240, overflowY: 'auto' }}>
                      {inviterMatches.map((m: any) => (
                        <button key={m.id}
                          onClick={() => { setFdInviter({ id: m.id, name: m.name, phone: m.phone, memberId: m.memberId }); setFdInviterSearch(''); }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'white', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a' }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>{m.memberId}{m.phone ? ` · ${m.phone}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {fdInviterSearch && inviterMatches.length === 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>No member matches "{fdInviterSearch}"</div>
                  )}
                </>
              )}
            </div>
          </div>

          <button
            onClick={() => setFdShowCapture(true)}
            disabled={fdSaving || blocked || !fdName.trim() || phoneClean.length < 5}
            style={{
              width: '100%', marginTop: 22, padding: 16,
              background: (fdSaving || blocked || !fdName.trim() || phoneClean.length < 5) ? '#d1d5db' : 'linear-gradient(135deg,#f59e0b,#d97706)',
              color: 'white', border: 'none', borderRadius: 12,
              fontSize: 15, fontWeight: 900,
              cursor: (fdSaving || blocked || !fdName.trim() || phoneClean.length < 5) ? 'not-allowed' : 'pointer',
              fontFamily: 'Nunito, sans-serif',
              boxShadow: '0 4px 16px rgba(245,158,11,0.35)',
            }}
          >
            {fdSaving ? 'Saving…' : '📸 Capture Face & Save'}
          </button>
        </div>

        {/* Auto-capture overlay — opens when receptionist taps the save
             button. Snaps automatically once a face is detected, then
             fires the existing submit with the photo file. */}
        <FaceAutoCapture
          open={fdShowCapture}
          title={`Capture ${fdName.trim() || 'guest'}'s face`}
          subtitle="Hold the camera at face height. It will snap automatically."
          onCapture={(file) => {
            setFdShowCapture(false);
            void submit(file);
          }}
          onCancel={() => setFdShowCapture(false)}
          onSkip={() => {
            setFdShowCapture(false);
            void submit(null);
          }}
        />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIRTUAL BULK RENEW — back-fill many historical renewals for one date.
  // Same writes as a single full renewal (payment + VM update + renewals
  // subcollection) so Reports include them automatically.
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'virtual_bulk_renew') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // For each VM, resolve plan info (duration + price) so we can preview
    // the bulk's expected total and the per-member expiry date.
    const resolvePlan = (vm: any): { name: string; durationDays: number; price: number; planId: string } => {
      const fromCatalog = vm.membershipPlanId ? clubMemberships.find((p: any) => p.id === vm.membershipPlanId) : null;
      return {
        name: fromCatalog?.name || vm.planName || '',
        durationDays: Number(fromCatalog?.durationDays ?? vm.planDurationDays ?? 29),
        price: Number(fromCatalog?.price ?? 0),
        planId: vm.membershipPlanId || fromCatalog?.id || '',
      };
    };

    const q = bulkRenewSearch.trim().toLowerCase();
    const visibleMembers = virtualMembers.filter((vm: any) => {
      if (!q) return true;
      const hay = `${vm.name || ''} ${vm.phone || ''} ${vm.memberId || ''}`.toLowerCase();
      return hay.includes(q);
    });

    const selectedSet = new Set(bulkRenewSelected);
    const selectedMembers = virtualMembers.filter((vm: any) => selectedSet.has(vm.id));
    const totalAmount = selectedMembers.reduce((sum: number, vm: any) => sum + resolvePlan(vm).price, 0);
    const missingPlanCount = selectedMembers.filter((vm: any) => !resolvePlan(vm).planId).length;

    const renewalDateObj = bulkRenewDate ? new Date(bulkRenewDate + 'T00:00:00') : null;
    const renewalDateInFuture = renewalDateObj ? renewalDateObj.getTime() > today.getTime() : false;
    const canSave = !!bulkRenewDate && !renewalDateInFuture && bulkRenewSelected.length > 0 && !bulkRenewSaving;

    const toggleSelect = (id: string) => {
      setBulkRenewSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };
    const selectAllVisible = () => {
      const ids = visibleMembers.map((vm: any) => vm.id);
      setBulkRenewSelected(prev => Array.from(new Set([...prev, ...ids])));
    };
    const clearSelection = () => setBulkRenewSelected([]);

    const performBulkRenew = async () => {
      if (!clubId || !renewalDateObj || bulkRenewSelected.length === 0) return;
      setBulkRenewSaving(true);
      setBulkRenewResult(null);
      const renewalDateStr = bulkRenewDate; // already yyyy-mm-dd
      let ok = 0, failed = 0;
      const failedVms: any[] = [];
      let alreadyDone = 0;
      let amountWritten = 0;
      // Ticked ids that are no longer in the live member list — deleted from
      // another device, say. They used to vanish from every count, so the
      // totals silently failed to add up to what was selected.
      const missing = bulkRenewSelected.filter(id => !selectedMembers.some((vm: any) => vm.id === id)).length;

      // ── Restartable ────────────────────────────────────────────────
      // Anyone already carrying a renewal row for THIS date has landed
      // completely — the payment, the dates and the history row commit in one
      // batch, so the row is proof of all three. Skipping them is what makes a
      // second run safe: the desk can retry after a failure without charging
      // the members who already went through.
      let already: Set<string> = new Set();
      try {
        already = await getRenewedMemberIdsOn(clubId, renewalDateStr);
      } catch (e) {
        console.error('[bulk_renew] could not check what already ran', e);
        setBulkRenewSaving(false);
        alert('Could not check which members were already renewed on this date, so nothing was saved — better that than risk charging anyone twice.\n\nCheck the connection and try again.');
        return;
      }
      const toRenew = selectedMembers.filter((vm: any) => {
        if (already.has(vm.id)) { alreadyDone++; return false; }
        return true;
      });

      // Build every member's writes as a SELF-CONTAINED unit first, then add
      // them to the batch only once all three are built. A throw part-way
      // through one member used to leave their payment already queued on the
      // shared batch, which then committed — so a member reported as failed
      // had actually been charged, and the retry charged them again.
      const opsFor = (vm: any) => {
        const plan = resolvePlan(vm);
        const startDate = renewalDateObj;
        const durationDays = Number(plan.durationDays);
        if (!Number.isFinite(durationDays) || durationDays <= 0) {
          throw new Error(`${vm.name}: plan duration is not a usable number`);
        }
        const endDate = new Date(startDate.getTime() + durationDays * 86400000);
        if (isNaN(endDate.getTime())) throw new Error(`${vm.name}: could not work out the new expiry`);
        const amount = Number(plan.price) || 0;
        const vmUpdates: Record<string, any> = {
          membershipStart: Timestamp.fromDate(startDate),
          membershipEnd: Timestamp.fromDate(endDate),
          lastRenewalAt: serverTimestamp(),
          collectionDate: Timestamp.fromDate(startDate),
          planDurationDays: durationDays,
          updatedAt: serverTimestamp(),
        };
        if (plan.planId) { vmUpdates.membershipPlanId = plan.planId; vmUpdates.planName = plan.name; }
        return {
          amount,
          apply: (batch: any) => {
            batch.set(doc(collection(db, 'clubs', clubId, 'payments')), {
              type: 'virtual_member',
              category: 'virtual_member_payment',
              virtualMemberId: vm.id,
              virtualMemberDocId: vm.memberId || '',
              memberName: vm.name || '',
              memberPhone: vm.phone || '',
              amount,
              paymentMethod: bulkRenewPayMethod,
              cashAmount: bulkRenewPayMethod === 'cash' ? amount : 0,
              upiAmount: bulkRenewPayMethod === 'upi' ? amount : 0,
              ...(plan.planId ? { planId: plan.planId, planName: plan.name, planDurationDays: durationDays } : {}),
              collectionDate: Timestamp.fromDate(startDate),
              description: `Bulk virtual member renewal — ${vm.name} (${vm.memberId})${plan.name ? ` — ${plan.name}` : ''}`,
              date: renewalDateStr,
              createdAt: serverTimestamp(),
              bulkRenewal: true,
            });
            batch.update(doc(db, 'clubs', clubId, 'virtualMembers', vm.id), vmUpdates);
            // History row LAST and in the same batch, so its presence is proof
            // the payment and the dates landed too — that is what lets a retry
            // skip this member instead of charging again.
            addVirtualRenewalToBatch(batch, clubId, {
              virtualMemberId: vm.id,
              virtualMemberDocId: vm.memberId || '',
              memberName: vm.name || '',
              memberPhone: vm.phone || '',
              amount,
              paymentMethod: bulkRenewPayMethod,
              ...(plan.planId ? { planId: plan.planId, planName: plan.name } : {}),
              collectionDate: Timestamp.fromDate(startDate),
              date: renewalDateStr,
              bulkRenewal: true,
            });
          },
        };
      };

      // Commit one group, all-or-nothing. Returns true if it landed.
      const commitGroup = async (group: any[]) => {
        const batch = writeBatch(db);
        for (const g of group) g.ops.apply(batch);
        await batch.commit();
        return true;
      };

      // Firestore batches are capped at 500 ops. Each member = 3 ops
      // (payment + VM update + renewal history). Chunk at 150 members.
      const CHUNK = 150;
      for (let i = 0; i < toRenew.length; i += CHUNK) {
        const chunk = toRenew.slice(i, i + CHUNK);
        const staged: any[] = [];
        for (const vm of chunk) {
          try {
            staged.push({ vm, ops: opsFor(vm) });
          } catch (e) {
            // Nothing was added to any batch, so this member is cleanly out.
            console.error('[bulk_renew] could not prepare', vm?.name, e);
            failed++;
            failedVms.push(vm);
          }
        }
        if (staged.length === 0) continue;
        try {
          await commitGroup(staged);
          ok += staged.length;
          amountWritten += staged.reduce((t, g) => t + g.ops.amount, 0);
        } catch (e) {
          console.error('[bulk_renew] batch commit failed, isolating', e);
          // One bad member — a deleted virtual-member document, say — rejects
          // the WHOLE batch, which used to report all 150 as failed and made
          // Retry useless: it re-ran the same group and hit the same rejection
          // for ever. Retry them one at a time so the good ones get through
          // and only the genuinely broken member is reported.
          for (const g of staged) {
            try {
              await commitGroup([g]);
              ok++;
              amountWritten += g.ops.amount;
            } catch (inner) {
              console.error('[bulk_renew] failed for', g.vm?.name, inner);
              failed++;
              failedVms.push(g.vm);
            }
          }
        }
      }
      setBulkRenewSaving(false);
      setBulkRenewResult(prev => ({
        // Accumulate across a retry: 'ok' used to report only the retry, so a
        // 150-member job that finished 100 + 50 read as '50 renewed'.
        ok: (prev?.ok ?? 0) + ok,
        failed,
        alreadyDone,
        failedVms,
        amountWritten: (prev?.amountWritten ?? 0) + amountWritten,
        missing,
        renewalDateStr,
      }));
      // Leave only the ones still to do selected, so 'Retry' picks up exactly
      // where it stopped.
      setBulkRenewSelected(failedVms.map((vm: any) => vm.id));
      if (ok > 0) playSuccessSound();
    };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#1a0f2e 0%,#2d1b4e 100%)', padding: 24, paddingTop: 64, paddingBottom: 120, fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        {/* Locked mid-run: leaving while writes are in flight left the run
            finishing invisibly and silently rewriting the selection. */}
        <button
          onClick={() => { if (!bulkRenewSaving) setScreen('virtual_grid'); }}
          disabled={bulkRenewSaving}
          style={{ ...S.backBtn, opacity: bulkRenewSaving ? 0.4 : 1, cursor: bulkRenewSaving ? 'not-allowed' : 'pointer' }}
        >← Back</button>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: 'white', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>⚡</span> Bulk Renew Virtual Members
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 600, marginTop: 4 }}>
              Pick one renewal date, tick everyone who renewed on that date, then save.
            </div>
          </div>

          {bulkRenewResult ? (
            <div style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#1a3a2a', marginBottom: 12 }}>
                {bulkRenewResult.failed === 0 ? '✅ Done' : '⚠️ Finished with errors'}
              </div>
              <div style={{ fontSize: 14, color: '#374151', marginBottom: 6 }}>
                <b>{bulkRenewResult.ok}</b> member{bulkRenewResult.ok === 1 ? '' : 's'} renewed on{' '}
                {/* The date actually written, captured at the start of the run —
                    not whatever the picker shows now. */}
                <b>{bulkRenewResult.renewalDateStr ?? bulkRenewDate}</b>.
              </div>
              {/* What was actually recorded, so the desk can reconcile against
                  the cash in hand. The screen promised a sum before saving and
                  then reported only counts, leaving any gap unexplained. */}
              <div style={{ fontSize: 15, fontWeight: 900, color: '#15803d', marginBottom: 8 }}>
                Recorded: ₹{(bulkRenewResult.amountWritten ?? 0).toLocaleString('en-IN')}
              </div>
              {(bulkRenewResult.missing ?? 0) > 0 && (
                <div style={{ fontSize: 13, color: '#b45309', marginBottom: 6, fontWeight: 700 }}>
                  {bulkRenewResult.missing} selected member{bulkRenewResult.missing === 1 ? ' is' : 's are'} no
                  longer in the list and could not be renewed — they may have been deleted.
                </div>
              )}
              {(bulkRenewResult.alreadyDone ?? 0) > 0 && (
                <div style={{ fontSize: 13, color: '#0369a1', marginBottom: 6, fontWeight: 700 }}>
                  {bulkRenewResult.alreadyDone} skipped — already renewed on this date, so they were not charged again.
                </div>
              )}
              {bulkRenewResult.failed > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 800, marginBottom: 6 }}>
                    {bulkRenewResult.failed} could not be saved:
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 12, color: '#7f1d1d', fontWeight: 600, lineHeight: 1.7 }}>
                    {(bulkRenewResult.failedVms ?? []).map((vm: any) => (
                      <div key={vm.id}>· {vm.name} {vm.memberId ? `(${vm.memberId})` : ''}</div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: '#991b1b', marginTop: 8 }}>
                    They are still selected. <b>Retry</b> renews only these — the {bulkRenewResult.ok} that
                    already went through will be skipped, so nobody is charged twice.
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                {bulkRenewResult.failed > 0 && (
                  <button
                    onClick={() => { setBulkRenewResult(null); void performBulkRenew(); }}
                    style={{ flex: 1, padding: 12, background: 'linear-gradient(135deg,#dc2626,#991b1b)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                  >↻ Retry the {bulkRenewResult.failed} that failed</button>
                )}
                <button
                  onClick={() => {
                    setBulkRenewResult(null);
                    setBulkRenewSelected([]);
                    setBulkRenewSearch('');
                  }}
                  style={{ flex: 1, padding: 12, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                >Renew another batch</button>
                <button
                  onClick={() => setScreen('virtual_grid')}
                  style={{ flex: 1, padding: 12, background: '#2d9653', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                >Back to list</button>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1: renewal date + payment method */}
              <div style={{ background: 'white', borderRadius: 14, padding: 18, marginBottom: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#1a3a2a', marginBottom: 10 }}>1. Renewal date (applied to all selected)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 4 }}>Date</div>
                    <input
                      type="date"
                      value={bulkRenewDate}
                      max={todayLocal(today)}
                      disabled={bulkRenewSaving}
                      onChange={e => setBulkRenewDate(e.target.value)}
                      style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${renewalDateInFuture ? '#dc2626' : '#d1d5db'}`, borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                    />
                    {renewalDateInFuture && (
                      <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginTop: 4 }}>Renewal date can't be in the future.</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, marginBottom: 4 }}>Payment method</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setBulkRenewPayMethod('cash')}
                        disabled={bulkRenewSaving}
                        style={{ flex: 1, padding: '11px', border: `2px solid ${bulkRenewPayMethod === 'cash' ? '#2d9653' : '#e5e7eb'}`, background: bulkRenewPayMethod === 'cash' ? '#f0fdf4' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                      >💵 Cash</button>
                      <button
                        type="button"
                        onClick={() => setBulkRenewPayMethod('upi')}
                        disabled={bulkRenewSaving}
                        style={{ flex: 1, padding: '11px', border: `2px solid ${bulkRenewPayMethod === 'upi' ? '#2d9653' : '#e5e7eb'}`, background: bulkRenewPayMethod === 'upi' ? '#f0fdf4' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                      >📱 UPI</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 2: search + member checklist */}
              <div style={{ background: 'white', borderRadius: 14, padding: 18, marginBottom: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#1a3a2a' }}>2. Select members</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={selectAllVisible}
                      disabled={visibleMembers.length === 0}
                      style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: visibleMembers.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif' }}
                    >Select all visible</button>
                    {bulkRenewSelected.length > 0 && (
                      <button
                        onClick={clearSelection}
                        style={{ padding: '6px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                      >Clear ({bulkRenewSelected.length})</button>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="🔍 Search by name, phone or member ID…"
                  value={bulkRenewSearch}
                  onChange={e => setBulkRenewSearch(e.target.value)}
                  style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', marginBottom: 10 }}
                />

                <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                  {visibleMembers.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
                      {q ? 'No members match this search.' : 'No virtual members yet.'}
                    </div>
                  ) : visibleMembers.map((vm: any) => {
                    const plan = resolvePlan(vm);
                    const isSelected = selectedSet.has(vm.id);
                    const end = vm.membershipEnd?.toDate ? vm.membershipEnd.toDate() : (vm.membershipEnd ? new Date(vm.membershipEnd) : null);
                    return (
                      <label
                        key={vm.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: isSelected ? '#f0fdf4' : 'white' }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(vm.id)}
                          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#16a34a' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {vm.name || '(no name)'} <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700 }}>· {vm.memberId}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginTop: 2 }}>
                            {plan.name ? `${plan.name} · ${plan.durationDays}d · ₹${plan.price}` : <span style={{ color: '#dc2626' }}>⚠ No plan on file — defaults to {plan.durationDays}d, ₹0</span>}
                            {end ? <> · expires {end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</> : ' · never renewed'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Sticky summary + save */}
              <div style={{ position: 'sticky', bottom: 16, background: 'white', borderRadius: 14, padding: 16, boxShadow: '0 -4px 24px rgba(0,0,0,0.4)', border: '2px solid #fbbf24' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700 }}>
                      {bulkRenewSelected.length} member{bulkRenewSelected.length === 1 ? '' : 's'} selected
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#1a3a2a', marginTop: 2 }}>
                      ₹{totalAmount.toLocaleString('en-IN')}
                    </div>
                    {missingPlanCount > 0 && (
                      <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginTop: 2 }}>
                        ⚠ {missingPlanCount} member{missingPlanCount === 1 ? '' : 's'} has no plan — payment will record ₹0.
                      </div>
                    )}
                  </div>
                  <button
                    onClick={performBulkRenew}
                    disabled={!canSave}
                    style={{
                      padding: '14px 28px',
                      background: canSave ? 'linear-gradient(135deg,#16a34a,#15803d)' : '#d1d5db',
                      color: 'white', border: 'none', borderRadius: 12,
                      fontWeight: 900, fontSize: 15,
                      cursor: canSave ? 'pointer' : 'not-allowed',
                      fontFamily: 'Nunito, sans-serif',
                      boxShadow: canSave ? '0 4px 12px rgba(22,163,74,0.4)' : 'none',
                    }}
                  >
                    {bulkRenewSaving ? 'Renewing…' : `✅ Renew ${bulkRenewSelected.length || ''}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIRTUAL NUMBER — dedicated tab (grid + add + renew)
  // Uses the existing clubs/{clubId}/virtualMembers collection so the
  // Settings-modal virtual members and this view stay in sync.
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'virtual_grid') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── Membership-status export (colour-coded Excel) ──────────────────────
    // Green = active (most days-left first), Yellow = expired ≤10 days,
    // Red = expired >10 days, Black = never renewed. Only Name / Last Renewal /
    // Expiry / Status (exact days) — no IDs or phone numbers.
    const buildVirtualStatusRows = () => {
      const now = Date.now();
      const toDate = (t: any) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));
      const zoneOrder: Record<string, number> = { active: 0, yellow: 1, red: 2, never: 3 };
      const rows = virtualMembers.map((vm: any) => {
        const end = toDate(vm.membershipEnd);
        const start = toDate(vm.membershipStart);
        const lastRenew = toDate(vm.lastRenewalAt) || start;
        let zone: string, status: string, sortKey: number;
        if (!end) {
          zone = 'never'; status = 'Never Renewed'; sortKey = -1e9;
        } else {
          const diff = Math.round((end.getTime() - now) / 86400000);
          sortKey = diff;
          if (diff > 0) { zone = 'active'; status = `${diff} Day${diff === 1 ? '' : 's'} Left`; }
          else if (diff === 0) { zone = 'active'; status = 'Today is the Last Day'; }
          else { const ago = -diff; zone = ago <= 10 ? 'yellow' : 'red'; status = `Expired ${ago} Day${ago === 1 ? '' : 's'} Ago`; }
        }
        return { name: vm.name || '—', lastRenew, end, zone, status, sortKey };
      });
      rows.sort((a, b) => (zoneOrder[a.zone] - zoneOrder[b.zone]) || (b.sortKey - a.sortKey));
      return rows;
    };

    const exportVirtualStatusExcel = async () => {
      if (virtualMembers.length === 0) return;
      const XLSX: any = await import('xlsx-js-style');
      const fmt = (d: Date | null) => d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
      const rows = buildVirtualStatusRows();

      const zoneStyle: Record<string, any> = {
        active: { fill: { fgColor: { rgb: 'C6EFCE' } }, font: { color: { rgb: '116329' }, bold: true } },
        yellow: { fill: { fgColor: { rgb: 'FFEB9C' } }, font: { color: { rgb: '7F6000' }, bold: true } },
        red: { fill: { fgColor: { rgb: 'FFC7CE' } }, font: { color: { rgb: '9C0006' }, bold: true } },
        never: { fill: { fgColor: { rgb: '000000' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } },
      };
      const header = ['Member Name', 'Last Renewal', 'Expiry Date', 'Status'];
      const aoa = [header, ...rows.map(r => [r.name, fmt(r.lastRenew), fmt(r.end), r.status])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const hdrStyle = { fill: { fgColor: { rgb: '2D1B4E' } }, font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 12 }, alignment: { horizontal: 'left', vertical: 'center' } };
      ['A1', 'B1', 'C1', 'D1'].forEach(a => { if (ws[a]) ws[a].s = hdrStyle; });
      rows.forEach((r, i) => {
        const excelRow = i + 2;
        ['A', 'B', 'C', 'D'].forEach(col => {
          const cell = `${col}${excelRow}`;
          if (ws[cell]) ws[cell].s = { ...zoneStyle[r.zone], alignment: { horizontal: col === 'A' || col === 'D' ? 'left' : 'center' } };
        });
      });
      ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Virtual Members');
      const dateStr = todayLocal();
      XLSX.writeFile(wb, `virtual-members-status-${dateStr}.xlsx`);
    };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#1a0f2e 0%,#2d1b4e 100%)', padding: 24, paddingTop: 64, fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        <button onClick={() => setScreen('home')} style={S.backBtn}>← Back</button>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'white', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>💳</span> Virtual Member
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: 600, marginTop: 2 }}>
                {virtualMembers.length} member{virtualMembers.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => {
                  // Reset bulk-renew state before opening
                  setBulkRenewDate(''); setBulkRenewSearch('');
                  setBulkRenewSelected([]); setBulkRenewPayMethod('cash');
                  setBulkRenewResult(null);
                  setScreen('virtual_bulk_renew');
                }}
                disabled={virtualMembers.length === 0}
                style={{ background: virtualMembers.length === 0 ? 'rgba(255,255,255,0.3)' : '#f59e0b', color: 'white', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 900, fontSize: 14, cursor: virtualMembers.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                ⚡ Bulk Renew
              </button>
              <button onClick={() => {
                  setShowVirtualReport(true);
                  setVrFromDate(''); setVrToDate(''); setVrData(null);
                }}
                style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 900, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                📊 Report
              </button>
              <button onClick={exportVirtualStatusExcel}
                disabled={virtualMembers.length === 0}
                title="Download a colour-coded status sheet (green=active, yellow≤10d expired, red>10d, black=never renewed)"
                style={{ background: virtualMembers.length === 0 ? 'rgba(255,255,255,0.3)' : '#16a34a', color: 'white', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 900, fontSize: 14, cursor: virtualMembers.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                ⬇ Export Status
              </button>
              <button onClick={() => {
                  setNewVirtualName(''); setNewVirtualPhone('');
                  setShowVirtualAdd(v => !v);
                }}
                style={{ background: showVirtualAdd ? '#fee2e2' : 'white', color: showVirtualAdd ? '#dc2626' : '#7c3aed', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 900, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                {showVirtualAdd ? '✕ Close' : '+ Add Virtual Member'}
              </button>
            </div>
          </div>

          {showVirtualAdd && (
            <div style={{ background: 'white', borderRadius: 14, padding: 18, marginBottom: 18, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#1a3a2a', marginBottom: 12 }}>New Virtual Member</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  placeholder="Full name"
                  value={newVirtualName}
                  onChange={e => setNewVirtualName(e.target.value)}
                  style={{ padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                />
                <input
                  placeholder="Mobile number"
                  type="tel"
                  inputMode="tel"
                  value={newVirtualPhone}
                  onChange={e => setNewVirtualPhone(e.target.value)}
                  style={{ padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                />
              </div>
              <button
                disabled={newVirtualSaving || !newVirtualName.trim() || !newVirtualPhone.trim()}
                onClick={async () => {
                  if (!clubId || !newVirtualName.trim() || !newVirtualPhone.trim()) return;
                  setNewVirtualSaving(true);
                  try {
                    const nextNum = (virtualMembers.length + 1).toString().padStart(3, '0');
                    const memberId = `MNC-B-${nextNum}`;
                    await addDoc(collection(db, 'clubs', clubId, 'virtualMembers'), {
                      memberId,
                      name: newVirtualName.trim(),
                      phone: newVirtualPhone.trim().replace(/\D/g, ''),
                      createdAt: serverTimestamp(),
                    });
                    setNewVirtualName(''); setNewVirtualPhone('');
                    setShowVirtualAdd(false);
                    playSuccessSound();
                  } catch (e) {
                    console.error('[virtual_grid] add', e);
                    alert('Failed to add virtual member. Please try again.');
                  }
                  setNewVirtualSaving(false);
                }}
                style={{
                  marginTop: 12, width: '100%', padding: '12px 18px',
                  background: (!newVirtualName.trim() || !newVirtualPhone.trim()) ? '#d1d5db' : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                  color: 'white', border: 'none', borderRadius: 10,
                  fontWeight: 900, fontSize: 14,
                  cursor: (!newVirtualName.trim() || !newVirtualPhone.trim()) ? 'not-allowed' : 'pointer',
                  fontFamily: 'Nunito, sans-serif',
                }}
              >
                {newVirtualSaving ? 'Adding…' : '+ Add Virtual Member'}
              </button>
            </div>
          )}

          {virtualMembers.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 16, padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 14, border: '1px solid rgba(255,255,255,0.1)' }}>
              No virtual members yet. Tap <b>+ Add Virtual Member</b> to add the first one.
            </div>
          ) : (() => {
            // ── Compute filtered + sorted list ──────────────────────────
            const q = virtualGridSearch.trim().toLowerCase();
            const todayMs = today.getTime();
            const getEndMs = (vm: any): number | null => {
              const r = vm.membershipEnd;
              if (!r) return null;
              const d = r.toDate ? r.toDate() : new Date(r);
              return d.getTime();
            };
            const getCreatedMs = (vm: any): number => {
              const r = vm.createdAt || vm.membershipStart;
              if (!r) return 0;
              const d = r.toDate ? r.toDate() : new Date(r);
              return d.getTime();
            };

            let filtered = virtualMembers.filter((vm: any) => {
              // search
              if (q) {
                const hay = `${vm.name || ''} ${vm.phone || ''} ${vm.memberId || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              // status
              if (virtualStatusFilter !== 'all') {
                const endMs = getEndMs(vm);
                if (virtualStatusFilter === 'never' && endMs !== null) return false;
                if (virtualStatusFilter === 'active' && (endMs === null || endMs < todayMs)) return false;
                if (virtualStatusFilter === 'expired' && (endMs === null || endMs >= todayMs)) return false;
              }
              // plan
              if (virtualPlanFilter !== 'all') {
                if ((vm.planName || '') !== virtualPlanFilter) return false;
              }
              return true;
            });

            // Sort
            const cmpName = (a: any, b: any) => (a.name || '').localeCompare(b.name || '');
            if (virtualSort === 'name') {
              filtered = [...filtered].sort(cmpName);
            } else if (virtualSort === 'recent') {
              filtered = [...filtered].sort((a, b) => getCreatedMs(b) - getCreatedMs(a));
            } else if (virtualSort === 'expiringSoon') {
              // Active members nearest to expiry first; expired & never-renewed at the bottom
              filtered = [...filtered].sort((a, b) => {
                const ea = getEndMs(a); const eb = getEndMs(b);
                const aActive = ea !== null && ea >= todayMs;
                const bActive = eb !== null && eb >= todayMs;
                if (aActive && !bActive) return -1;
                if (!aActive && bActive) return 1;
                if (aActive && bActive) return (ea as number) - (eb as number);
                return cmpName(a, b);
              });
            } else if (virtualSort === 'expiredFirst') {
              // Already-expired + never-renewed first, then active by nearest expiry
              filtered = [...filtered].sort((a, b) => {
                const ea = getEndMs(a); const eb = getEndMs(b);
                const aOverdue = ea === null || ea < todayMs;
                const bOverdue = eb === null || eb < todayMs;
                if (aOverdue && !bOverdue) return -1;
                if (!aOverdue && bOverdue) return 1;
                if (aOverdue && bOverdue) {
                  // Most-overdue first (smallest end ms; nulls last)
                  if (ea === null && eb !== null) return 1;
                  if (eb === null && ea !== null) return -1;
                  if (ea === null && eb === null) return cmpName(a, b);
                  return (ea as number) - (eb as number);
                }
                return (ea as number) - (eb as number);
              });
            }

            const planOptions = Array.from(new Set(virtualMembers.map((m: any) => m.planName).filter(Boolean))) as string[];
            const activeCount = virtualMembers.filter((m: any) => { const e = getEndMs(m); return e !== null && e >= todayMs; }).length;
            const expiredCount = virtualMembers.filter((m: any) => { const e = getEndMs(m); return e !== null && e < todayMs; }).length;
            const neverCount = virtualMembers.filter((m: any) => getEndMs(m) === null).length;

            const anyFilterOn = !!q || virtualStatusFilter !== 'all' || virtualPlanFilter !== 'all';

            // ── Render: search + filters then grid ──────────────────────
            return (<>
              {/* Search */}
              <div style={{ marginBottom: 12, position: 'relative' }}>
                <input
                  value={virtualGridSearch}
                  onChange={e => setVirtualGridSearch(e.target.value)}
                  placeholder="🔍 Search name, mobile or member ID…"
                  style={{
                    width: '100%', padding: '14px 44px 14px 16px',
                    background: 'rgba(255,255,255,0.95)',
                    border: '1.5px solid rgba(255,255,255,0.15)',
                    borderRadius: 12, fontSize: 14, fontWeight: 600,
                    fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box',
                    outline: 'none', color: '#1a3a2a',
                  }}
                />
                {virtualGridSearch && (
                  <button
                    onClick={() => setVirtualGridSearch('')}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 8, border: 'none', background: '#f3f4f6', color: '#6b7280', fontSize: 16, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                  >✕</button>
                )}
              </div>

              {/* Status pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {([
                  { key: 'all', label: 'All', count: virtualMembers.length, color: '#0ea5e9' },
                  { key: 'active', label: 'Active', count: activeCount, color: '#16a34a' },
                  { key: 'expired', label: 'Renew pending', count: expiredCount, color: '#dc2626' },
                  { key: 'never', label: 'Never renewed', count: neverCount, color: '#7c3aed' },
                ] as const).map(opt => {
                  const on = virtualStatusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setVirtualStatusFilter(opt.key)}
                      style={{
                        padding: '6px 12px', borderRadius: 999,
                        border: `1.5px solid ${on ? opt.color : 'rgba(255,255,255,0.18)'}`,
                        background: on ? opt.color : 'rgba(255,255,255,0.08)',
                        color: on ? 'white' : 'rgba(255,255,255,0.85)',
                        fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        fontFamily: 'Nunito, sans-serif',
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {opt.label}
                      <span style={{ background: on ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 900 }}>{opt.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Plan filter + Sort + clear */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700 }}>
                  Plan
                  <select
                    value={virtualPlanFilter}
                    onChange={e => setVirtualPlanFilter(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 12, fontWeight: 700, fontFamily: 'Nunito, sans-serif', cursor: 'pointer' }}
                  >
                    <option value="all" style={{ color: '#111' }}>All plans</option>
                    {planOptions.map(p => <option key={p} value={p} style={{ color: '#111' }}>{p}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700 }}>
                  Sort
                  <select
                    value={virtualSort}
                    onChange={e => setVirtualSort(e.target.value as any)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 12, fontWeight: 700, fontFamily: 'Nunito, sans-serif', cursor: 'pointer' }}
                  >
                    <option value="recent" style={{ color: '#111' }}>Recently added</option>
                    <option value="name" style={{ color: '#111' }}>Name (A → Z)</option>
                    <option value="expiringSoon" style={{ color: '#111' }}>Expiring soon</option>
                    <option value="expiredFirst" style={{ color: '#111' }}>Renew pending first</option>
                  </select>
                </label>
                {anyFilterOn && (
                  <button
                    onClick={() => { setVirtualGridSearch(''); setVirtualStatusFilter('all'); setVirtualPlanFilter('all'); }}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                  >Clear filters</button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>
                  Showing {filtered.length} of {virtualMembers.length}
                </span>
              </div>

              {filtered.length === 0 ? (
                <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 16, padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 14, border: '1px solid rgba(255,255,255,0.1)' }}>
                  No virtual members match the current filters.
                </div>
              ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {filtered.map((vm: any) => {
                const endRaw = vm.membershipEnd;
                const end = endRaw ? (endRaw.toDate ? endRaw.toDate() : new Date(endRaw)) : null;
                const startRaw = vm.membershipStart;
                const start = startRaw ? (startRaw.toDate ? startRaw.toDate() : new Date(startRaw)) : null;
                const colRaw = vm.collectionDate;
                const colDate = colRaw ? (colRaw.toDate ? colRaw.toDate() : new Date(colRaw)) : null;
                const expired = end ? end.getTime() < today.getTime() : true;
                // Color logic: faded green/warm for expired (renewal pending),
                // normal white card for active.
                const cardBg = expired ? '#dcfce7' : 'white';
                const cardBorder = expired ? '#16a34a' : '#e5e7eb';
                const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                const isEditing = editingVirtualId === vm.id;
                return (
                  <div key={vm.id} style={{ background: cardBg, borderRadius: 14, padding: 16, border: `1.5px solid ${isEditing ? '#7c3aed' : cardBorder}`, boxShadow: expired ? '0 4px 16px rgba(22,163,74,0.18)' : '0 4px 16px rgba(0,0,0,0.12)' }}>
                    {isEditing ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>✏️ Edit Member</div>
                          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>{vm.memberId}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                          <input
                            placeholder="Full name"
                            value={editVirtualName}
                            onChange={e => setEditVirtualName(e.target.value)}
                            disabled={editVirtualSaving}
                            style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'Nunito, sans-serif', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            placeholder="Mobile number"
                            value={editVirtualPhone}
                            onChange={e => setEditVirtualPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
                            inputMode="numeric"
                            disabled={editVirtualSaving}
                            style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'Nunito, sans-serif', outline: 'none', boxSizing: 'border-box' }}
                          />
                          {editVirtualError && (
                            <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700 }}>{editVirtualError}</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => {
                              setEditingVirtualId(null);
                              setEditVirtualName('');
                              setEditVirtualPhone('');
                              setEditVirtualError('');
                            }}
                            disabled={editVirtualSaving}
                            style={{ flex: 1, padding: '10px 14px', background: 'white', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: editVirtualSaving ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              if (!clubId) return;
                              const name = editVirtualName.trim();
                              const phone = editVirtualPhone.trim();
                              if (!name) { setEditVirtualError('Name is required'); return; }
                              if (!/^\d{10}$/.test(phone)) { setEditVirtualError('Mobile must be 10 digits'); return; }
                              // Block duplicate phones on other virtual members
                              const clash = virtualMembers.find((m: any) => m.id !== vm.id && (m.phone || '').trim() === phone);
                              if (clash) { setEditVirtualError(`Mobile already used by ${clash.name}`); return; }
                              setEditVirtualSaving(true);
                              setEditVirtualError('');
                              try {
                                await updateDoc(doc(db, 'clubs', clubId, 'virtualMembers', vm.id), { name, phone });
                                setEditingVirtualId(null);
                                setEditVirtualName('');
                                setEditVirtualPhone('');
                              } catch (e: any) {
                                setEditVirtualError(e?.message || 'Failed to save');
                              } finally {
                                setEditVirtualSaving(false);
                              }
                            }}
                            disabled={editVirtualSaving || !editVirtualName.trim() || !editVirtualPhone.trim()}
                            style={{ flex: 1, padding: '10px 14px', background: (editVirtualSaving || !editVirtualName.trim() || !editVirtualPhone.trim()) ? '#d1d5db' : '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: (editVirtualSaving || !editVirtualName.trim() || !editVirtualPhone.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif' }}
                          >
                            {editVirtualSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: '#1a3a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.name}</div>
                            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>{vm.memberId} · {vm.phone}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <button
                              onClick={() => {
                                setEditingVirtualId(vm.id);
                                setEditVirtualName(vm.name || '');
                                setEditVirtualPhone((vm.phone || '').toString());
                                setEditVirtualError('');
                              }}
                              title="Edit name / mobile"
                              style={{ background: 'white', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '4px 8px', fontSize: 12, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', color: '#7c3aed', fontWeight: 800 }}
                            >
                              ✏️ Edit
                            </button>
                            {expired ? (
                              <span style={{ background: '#16a34a', color: 'white', borderRadius: 100, padding: '4px 10px', fontSize: 10, fontWeight: 900, letterSpacing: 0.5 }}>RENEW</span>
                            ) : (
                              <span style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: 100, padding: '4px 10px', fontSize: 10, fontWeight: 900, letterSpacing: 0.5 }}>ACTIVE</span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#6b7280' }}>Plan</span>
                            <span style={{ fontWeight: 800 }}>{vm.planName || '—'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#6b7280' }}>Last renewal</span>
                            <span style={{ fontWeight: 800 }}>{start ? fmt(start) : '—'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#6b7280' }}>Expires</span>
                            <span style={{ fontWeight: 800, color: expired ? '#dc2626' : '#16a34a' }}>{end ? fmt(end) : '—'}</span>
                          </div>
                          {(() => {
                            const st = expiryStatus(vm.membershipEnd);
                            return (
                              <div style={{ marginTop: 4, textAlign: 'center', fontSize: 12, fontWeight: 900, color: st.color, background: st.expired ? '#fef2f2' : '#f0fdf4', border: `1px solid ${st.color}33`, borderRadius: 8, padding: '5px 8px' }}>
                                {st.label}
                              </div>
                            );
                          })()}
                          {colDate && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#6b7280' }}>Collection</span>
                              <span style={{ fontWeight: 800, color: '#7c3aed' }}>{fmt(colDate)}</span>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            setSelectedVirtualMember(vm);
                            setVirtualPlanId(''); setVirtualAmount(''); setVirtualPayMethod('');
                            setVirtualUpiAccount(null); setVirtualCollectionDate('');
                            setScreen('virtual_renew_choice');
                          }}
                          style={{ width: '100%', padding: '10px 14px', background: expired ? '#16a34a' : '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                        >
                          {expired ? '🔁 Renew Now' : '🔁 Renew'}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
              )}
            </>);
          })()}
        </div>

        {/* ── Virtual Member Report Modal ──────────────────────────────── */}
        {showVirtualReport && (() => {
          const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN');
          const fmtD = (d: string) => {
            try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
            catch { return d; }
          };

          const generateReport = async () => {
            if (!clubId || !vrFromDate || !vrToDate) return;
            setVrLoading(true);
            try {
              const results: any[] = [];
              // One query for the whole club, instead of one per member into a
              // nested subcollection the rules never allowed reading — which is
              // why this report came back empty however many renewals existed.
              const byId = new Map(virtualMembers.map((vm: any) => [vm.id, vm]));
              // Bounded on the server — the report always has both dates.
              for (const r of await getAllVirtualRenewals(clubId, vrFromDate, vrToDate)) {
                const rDate = r.date
                  || (r.createdAt?.toDate ? (() => {
                    const d = r.createdAt.toDate();
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  })() : '');
                if (rDate < vrFromDate || rDate > vrToDate) continue;
                const vm: any = byId.get(r.virtualMemberId) || {};
                results.push({
                  ...r,
                  virtualMemberId: r.virtualMemberId,
                  virtualMemberDocId: r.virtualMemberDocId || vm.memberId || '',
                  memberName: r.memberName || vm.name || '',
                  memberPhone: r.memberPhone || vm.phone || '',
                  date: rDate,
                });
              }
              results.sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
              setVrData(results);
            } catch (e) {
              console.error('[virtual_report]', e);
              alert('Failed to load report data.');
            }
            setVrLoading(false);
          };

          const totalRevenue = (vrData || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
          // An expiry-only correction is NOT a renewal: it records no payment,
          // because the money was collected elsewhere and on another day. It
          // used to be counted in "Total Renewed" as a ₹0 line, so the headline
          // count grew while revenue did not, and the two stopped agreeing.
          const backdatedRows = (vrData || []).filter((p: any) => p.backdated === true);
          const totalMembers = (vrData || []).length - backdatedRows.length;
          const totalBackdated = backdatedRows.length;

          const printReport = async () => {
            if (!vrData || vrData.length === 0) return;
            const { printViaRawBT } = await import('@/utils/printReceipt');
            const { buildHeader, buildFooter } = await import('@/utils/receiptBuilder');
            const { ALIGN_CENTER, ALIGN_LEFT, BOLD_ON, BOLD_OFF, SIZE_MEDIUM, SIZE_NORMAL, LF, DIVIDER, DIVIDER_THIN, twoCol } = await import('@/utils/escpos');

            const clubSnap = await getDoc(doc(db, 'clubs', clubId));
            const cd = clubSnap.data() || {};
            const club = { name: cd.name || '', address: cd.address || '', phone: cd.phone || '', email: cd.email || '', gstNumber: cd.gstNumber || '' };

            const lines: string[] = [
              ...buildHeader(club),
              ALIGN_CENTER,
              BOLD_ON, SIZE_MEDIUM,
              'VIRTUAL MEMBER REPORT\n',
              SIZE_NORMAL, BOLD_OFF,
              LF,
              ALIGN_LEFT,
              twoCol('From:', fmtD(vrFromDate)),
              '\n',
              twoCol('To:', fmtD(vrToDate)),
              '\n',
              DIVIDER + '\n',
              BOLD_ON,
              twoCol('Member', 'Amount'),
              '\n',
              BOLD_OFF,
              DIVIDER_THIN + '\n',
            ];

            for (const p of vrData) {
              const name = (p.memberName || 'Unknown').slice(0, 18);
              const amt = fmtINR(Number(p.amount) || 0);
              lines.push(twoCol(name, amt) + '\n');
              if (p.planName) {
                lines.push('  ' + (p.planName || '').slice(0, 28) + '\n');
              }
              const pDate = p.date || '';
              const method = p.paymentMethod || '';
              if (pDate || method) {
                lines.push('  ' + [fmtD(pDate), method].filter(Boolean).join(' | ') + '\n');
              }
            }

            lines.push(
              DIVIDER + '\n',
              BOLD_ON,
              twoCol('Total Renewed:', String(totalMembers)),
              ...(totalBackdated > 0 ? [twoCol('Expiry fixes:', String(totalBackdated))] : []),
              '\n',
              twoCol('Total Revenue:', fmtINR(totalRevenue)),
              '\n',
              BOLD_OFF,
              ...buildFooter(),
            );

            printViaRawBT(lines);
          };

          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div onClick={() => setShowVirtualReport(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
              <div style={{
                position: 'relative', background: 'white', borderRadius: 20, width: '94%', maxWidth: 560,
                maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                fontFamily: 'Nunito, sans-serif',
              }}>
                {/* Header */}
                <div style={{
                  padding: '18px 20px', borderBottom: '1.5px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  position: 'sticky', top: 0, background: 'white', zIndex: 5, borderRadius: '20px 20px 0 0',
                }}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>📊 Virtual Member Report</div>
                  <button onClick={() => setShowVirtualReport(false)} style={{
                    width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#f1f5f9', color: '#64748b', fontSize: 18, fontWeight: 900,
                  }}>✕</button>
                </div>

                <div style={{ padding: '16px 20px' }}>
                  {/* Date filters */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' }}>From Date</label>
                      <input
                        type="date"
                        value={vrFromDate}
                        onChange={e => setVrFromDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, display: 'block' }}>To Date</label>
                      <input
                        type="date"
                        value={vrToDate}
                        onChange={e => setVrToDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, fontWeight: 600, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={generateReport}
                    disabled={!vrFromDate || !vrToDate || vrLoading}
                    style={{
                      width: '100%', padding: '12px 18px', marginBottom: 16,
                      background: (!vrFromDate || !vrToDate) ? '#d1d5db' : 'linear-gradient(135deg,#3b82f6,#2563eb)',
                      color: 'white', border: 'none', borderRadius: 10,
                      fontWeight: 900, fontSize: 14,
                      cursor: (!vrFromDate || !vrToDate) ? 'not-allowed' : 'pointer',
                      fontFamily: 'Nunito, sans-serif',
                    }}
                  >
                    {vrLoading ? 'Loading…' : '🔍 Generate Report'}
                  </button>

                  {/* Results */}
                  {vrData && (
                    <>
                      {/* Summary cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '14px 16px', border: '1.5px solid #bbf7d0' }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Renewed</div>
                          <div style={{ fontSize: 26, fontWeight: 900, color: '#15803d', marginTop: 2 }}>{totalMembers}</div>
                          {totalBackdated > 0 && (
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#65a30d', marginTop: 2 }}>
                              + {totalBackdated} expiry fix{totalBackdated === 1 ? '' : 'es'} (no payment)
                            </div>
                          )}
                        </div>
                        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 16px', border: '1.5px solid #bfdbfe' }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Revenue</div>
                          <div style={{ fontSize: 26, fontWeight: 900, color: '#1d4ed8', marginTop: 2 }}>{fmtINR(totalRevenue)}</div>
                        </div>
                      </div>

                      {vrData.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>
                          No renewals found in the selected period.
                        </div>
                      ) : (
                        <>
                          {/* Table */}
                          <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                              <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>#</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Member</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Date</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Plan</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Method</th>
                                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {vrData.map((p: any, i: number) => (
                                  <tr key={p.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#94a3b8' }}>{i + 1}</td>
                                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                                      {p.memberName || 'Unknown'}
                                      {p.virtualMemberDocId && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>{p.virtualMemberDocId}</div>}
                                    </td>
                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{fmtD(p.date || '')}</td>
                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#7c3aed' }}>{p.planName || '—'}</td>
                                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#475569', textTransform: 'capitalize' }}>{(p.paymentMethod || '—').replace(/_/g, ' ')}</td>
                                    <td style={{ padding: '8px 10px', fontWeight: 800, color: '#16a34a', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtINR(Number(p.amount) || 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                                  <td colSpan={5} style={{ padding: '10px', fontWeight: 900, color: '#0f172a', textAlign: 'right' }}>Total</td>
                                  <td style={{ padding: '10px', fontWeight: 900, color: '#15803d', textAlign: 'right', fontSize: 14 }}>{fmtINR(totalRevenue)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>

                          {/* Print button */}
                          <button
                            onClick={printReport}
                            style={{
                              width: '100%', padding: '14px 18px',
                              background: 'linear-gradient(135deg,#1a3a2a,#2d5a3e)',
                              color: 'white', border: 'none', borderRadius: 12,
                              fontWeight: 900, fontSize: 15, cursor: 'pointer',
                              fontFamily: 'Nunito, sans-serif',
                              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                            }}
                          >
                            🖨️ Print Report
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIRTUAL RENEW — choice screen: Renew Now (collect payment) vs
  // Different Date (payment already received earlier, only extend expiry)
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'virtual_renew_choice' && selectedVirtualMember) {
    const vm = selectedVirtualMember;
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#1a0f2e 0%,#2d1b4e 100%)', padding: 24, paddingTop: 64, fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        <button onClick={() => { setSelectedVirtualMember(null); setScreen('virtual_grid'); }} style={S.backBtn}>← Back</button>
        <div style={{ maxWidth: 520, margin: '0 auto', ...S.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <span style={{ fontSize: 36 }}>🔁</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>Renew Virtual Member</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>{vm.name} · {vm.memberId} · {vm.phone}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: '#4b5563', fontWeight: 700, marginBottom: 14 }}>
            How is this renewal being recorded?
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Renew Now */}
            <button
              onClick={() => setScreen('virtual_renew')}
              style={{
                textAlign: 'left', padding: '16px 18px', border: 'none',
                background: 'linear-gradient(135deg,#16a34a,#15803d)', color: 'white',
                borderRadius: 14, fontFamily: 'Nunito, sans-serif', cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(22,163,74,0.25)',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>💸 Renew Now</div>
              <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 600 }}>
                Collect payment now — pick plan, amount, cash/UPI. New 30-day cycle starts today.
              </div>
            </button>

            {/* Different Date — payment already collected */}
            <button
              onClick={() => {
                setVirtualBackdatePaidOn(todayLocal());
                setScreen('virtual_renew_backdate');
              }}
              style={{
                textAlign: 'left', padding: '16px 18px', border: 'none',
                background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: 'white',
                borderRadius: 14, fontFamily: 'Nunito, sans-serif', cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(124,58,237,0.25)',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📅 Different Date</div>
              <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 600 }}>
                Payment was collected earlier — pick that date and extend the expiry by 1 month. No new payment recorded.
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIRTUAL RENEW — back-dated: payment was already collected on an
  // earlier date. We don't write a new payment record; we just shift
  // membershipStart to the paid-on date and membershipEnd to that + 30
  // days (or the existing plan duration if known).
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'virtual_renew_backdate' && selectedVirtualMember) {
    const vm = selectedVirtualMember;
    const paidOn = virtualBackdatePaidOn ? new Date(virtualBackdatePaidOn + 'T00:00:00') : null;
    const durationDays = Number(vm.planDurationDays) > 0 ? Number(vm.planDurationDays) : 30;
    const newEnd = paidOn ? new Date(paidOn.getTime() + durationDays * 86400000) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const paidOnInFuture = paidOn ? paidOn.getTime() > today.getTime() : false;
    const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const saveBackdated = async () => {
      if (!clubId || !vm || !paidOn || !newEnd || virtualSaving) return;
      if (paidOnInFuture) { alert('Payment date cannot be in the future.'); return; }
      setVirtualSaving(true);
      try {
        // Local dates, not toISOString — IST is UTC+5:30, so a UTC date files
        // an evening renewal under the wrong club day.
        const todayIso = todayLocal();
        // todayLocal already takes a Date — no need for a private copy of the
        // club-day formatter, which is exactly the duplication the one-pipe
        // rule exists to stop.
        const paidIso = todayLocal(paidOn);

        // Both writes in ONE batch. Previously the member update went first and
        // the history line second: the history write was refused by the rules,
        // threw, and the receptionist was told the save had failed — while the
        // dates had already changed. A batch either lands or it does not.
        const vBatch = writeBatch(db);
        vBatch.update(doc(db, 'clubs', clubId, 'virtualMembers', vm.id), {
          membershipStart: Timestamp.fromDate(paidOn),
          membershipEnd: Timestamp.fromDate(newEnd),
          lastRenewalAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // Amount/method intentionally omitted — the payment was collected
        // elsewhere; this records only that the expiry was moved.
        addVirtualRenewalToBatch(vBatch, clubId, {
          virtualMemberId: vm.id,
          virtualMemberDocId: vm.memberId || '',
          memberName: vm.name || '',
          memberPhone: vm.phone || '',
          backdated: true,
          paidOnDate: paidIso,
          extendedTo: todayLocal(newEnd),
          durationDays,
          note: 'Payment was already collected — expiry-only update',
          date: todayIso,
        });
        await vBatch.commit();

        playSuccessSound();
        setSelectedVirtualMember(null);
        setVirtualBackdatePaidOn('');
        setScreen('virtual_grid');
      } catch (e) {
        console.error('[virtual_renew_backdate] save', e);
        alert('Failed to update expiry. Please try again.');
      }
      setVirtualSaving(false);
    };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#1a0f2e 0%,#2d1b4e 100%)', padding: 24, paddingTop: 64, fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        <button onClick={() => setScreen('virtual_renew_choice')} style={S.backBtn}>← Back</button>
        <div style={{ maxWidth: 520, margin: '0 auto', ...S.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <span style={{ fontSize: 36 }}>📅</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>Extend Expiry (back-dated)</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>{vm.name} · {vm.memberId} · {vm.phone}</div>
            </div>
          </div>

          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#5b21b6', fontWeight: 700, marginBottom: 16 }}>
            ℹ️ Payment was already collected. This only updates the membership dates — no new payment entry is recorded.
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Payment was collected on</div>
            <input
              type="date"
              value={virtualBackdatePaidOn}
              max={todayLocal()}
              onChange={e => setVirtualBackdatePaidOn(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
            />
            {paidOnInFuture && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626', fontWeight: 700 }}>Date cannot be in the future.</div>
            )}
          </div>

          {paidOn && newEnd && !paidOnInFuture && (
            <div style={{ marginTop: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#166534', textTransform: 'uppercase', marginBottom: 8 }}>Preview</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#1a3a2a', fontWeight: 700 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#4b5563', fontWeight: 600 }}>New start</span>
                  <span>{fmt(paidOn)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#4b5563', fontWeight: 600 }}>New expiry</span>
                  <span style={{ color: '#15803d' }}>{fmt(newEnd)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#4b5563', fontWeight: 600 }}>Duration</span>
                  <span>{durationDays} days</span>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={() => setScreen('virtual_renew_choice')}
              disabled={virtualSaving}
              style={{ flex: 1, padding: '12px', background: 'white', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: virtualSaving ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif' }}
            >
              Cancel
            </button>
            <button
              onClick={saveBackdated}
              disabled={!paidOn || paidOnInFuture || virtualSaving}
              style={{ flex: 2, padding: '12px', background: (!paidOn || paidOnInFuture || virtualSaving) ? '#d1d5db' : '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: (!paidOn || paidOnInFuture || virtualSaving) ? 'not-allowed' : 'pointer', fontFamily: 'Nunito, sans-serif' }}
            >
              {virtualSaving ? 'Saving…' : `✅ Extend expiry by ${durationDays} days`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIRTUAL RENEW — payment + plan + collection date for one VM
  // ═══════════════════════════════════════════════════════════════════
  if (screen === 'virtual_renew' && selectedVirtualMember) {
    const vm = selectedVirtualMember;
    const selectedPlan = virtualPlanId ? clubMemberships.find(p => p.id === virtualPlanId) : null;
    const planEnd = selectedPlan ? new Date(Date.now() + (selectedPlan.durationDays || 29) * 86400000) : null;
    const canSave = !virtualSaving && !!virtualAmount && !!virtualPayMethod;

    const saveRenewal = async () => {
      if (!clubId || !vm || !virtualAmount || !virtualPayMethod) return;
      setVirtualSaving(true);
      try {
        // Club-local. This one was missed when the back-dated flow was
        // converted: it stamps BOTH the payment and the renewal-history row,
        // so a renewal taken before 05:30 IST was filed under yesterday and
        // vanished from the day's report.
        const todayStr = todayLocal();
        const planStart = selectedPlan ? new Date() : null;
        const planEndDate = selectedPlan ? new Date(Date.now() + (selectedPlan.durationDays || 29) * 86400000) : null;
        const collDate = virtualCollectionDate ? new Date(virtualCollectionDate + 'T00:00:00') : null;
        const vrTender = normalizeTender(Number(virtualAmount), virtualPayMethod);

        // 1. Payment record — tagged so Reports can filter virtual renewals
        await addDoc(collection(db, 'clubs', clubId, 'payments'), {
          type: 'virtual_member',
          category: 'virtual_member_payment',
          virtualMemberId: vm.id,
          virtualMemberDocId: vm.memberId || '',
          memberName: vm.name || '',
          memberPhone: vm.phone || '',
          amount: vrTender.amount,
          paymentMethod: vrTender.paymentMethod,
          cashAmount: vrTender.cashAmount,
          upiAmount: vrTender.upiAmount,
          ...(virtualUpiAccount ? {
            upiAccountId: virtualUpiAccount.id,
            upiAccountName: virtualUpiAccount.name || virtualUpiAccount.app,
            upiNumber: virtualUpiAccount.number,
            upiHolderName: virtualUpiAccount.holderName,
          } : {}),
          ...(selectedPlan ? {
            planId: selectedPlan.id,
            planName: selectedPlan.name,
            planDurationDays: selectedPlan.durationDays,
          } : {}),
          ...(collDate ? { collectionDate: Timestamp.fromDate(collDate) } : {}),
          description: `Virtual member renewal — ${vm.name} (${vm.memberId})${selectedPlan ? ` — ${selectedPlan.name}` : ''}`,
          date: todayStr,
          createdAt: serverTimestamp(),
        });

        // 2. Update virtual member doc with new dates + collection date
        const updates: Record<string, any> = {
          lastRenewalAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (selectedPlan && planStart && planEndDate) {
          updates.membershipPlanId = selectedPlan.id;
          updates.planName = selectedPlan.name;
          updates.membershipStart = Timestamp.fromDate(planStart);
          updates.membershipEnd = Timestamp.fromDate(planEndDate);
          updates.planDurationDays = selectedPlan.durationDays;
        }
        if (collDate) updates.collectionDate = Timestamp.fromDate(collDate);
        await updateDoc(doc(db, 'clubs', clubId, 'virtualMembers', vm.id), updates);

        // 3. Renewal history — one level below the club, where the rules
        //    actually permit a write. See lib/virtualRenewals.
        await addVirtualRenewal(clubId, {
          virtualMemberId: vm.id,
          virtualMemberDocId: vm.memberId || '',
          memberName: vm.name || '',
          memberPhone: vm.phone || '',
          amount: Number(virtualAmount),
          paymentMethod: virtualPayMethod,
          ...(selectedPlan ? { planId: selectedPlan.id, planName: selectedPlan.name } : {}),
          ...(collDate ? { collectionDate: Timestamp.fromDate(collDate) } : {}),
          date: todayStr,
        });

        // 4. Auto-deduct virtual product set from inventory (matches the
        //    behaviour of the legacy Settings-modal payment flow)
        try {
          const vpsSnap = await getDocs(collection(db, 'clubs', clubId, 'virtualProductSets'));
          const activeSets = vpsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive);
          if (activeSets.length > 0) {
            const vps = activeSets[0] as any;
            const now = Timestamp.now();
            const batch = writeBatch(db);
            for (const item of vps.items || []) {
              const prodRef = doc(db, 'clubs', clubId, 'inventory', item.productId);
              const prodSnap = await getDoc(prodRef);
              if (prodSnap.exists()) {
                const current = prodSnap.data().quantity ?? 0;
                const newQty = Math.max(0, current - (item.quantity || 0));
                batch.update(prodRef, { quantity: newQty, lastUpdated: now });
                const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                batch.set(doc(collection(db, 'clubs', clubId, 'inventoryLogs')), {
                  id: logId, clubId, type: 'virtual_deduction',
                  productId: item.productId, productName: item.productName,
                  quantityChange: -(item.quantity || 0), quantityBefore: current, quantityAfter: newQty,
                  referenceId: vps.id,
                  performedBy: 'Virtual: ' + vm.name,
                  date: todayStr, createdAt: now,
                });
              }
            }
            await batch.commit();
          }
        } catch (e) { console.error('[virtual_renew] vps deduction', e); }

        playSuccessSound();
        // Offer print receipt
        if (window.confirm(`Renewal saved for ${vm.name}. Print receipt now?`)) {
          try {
            const lines = [
              ...buildHeader({ name: contextClub?.name || 'Magic Nutrition Club', phone: (contextClub as any)?.phone, address: (contextClub as any)?.address }),
              '\x1B\x61\x01',  // center
              '\x1B\x45\x01', 'VIRTUAL MEMBER RENEWAL\n', '\x1B\x45\x00',
              '\x1B\x61\x00',  // left
              `Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n`,
              `Time: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n`,
              '------------------------------------------------\n',
              `Member  : ${vm.name}\n`,
              `ID      : ${vm.memberId}\n`,
              `Phone   : ${vm.phone}\n`,
              '------------------------------------------------\n',
              ...(selectedPlan ? [
                `Plan    : ${selectedPlan.name}\n`,
                `Duration: ${selectedPlan.durationDays} days\n`,
                `Expires : ${planEndDate?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n`,
              ] : []),
              ...(collDate ? [`Collect : ${collDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}\n`] : []),
              `Method  : ${virtualPayMethod.toUpperCase()}\n`,
              '\x1B\x45\x01',
              `Amount  : Rs. ${Number(virtualAmount).toLocaleString('en-IN')}\n`,
              '\x1B\x45\x00',
              ...buildFooter(),
            ];
            const { printViaRawBT } = await import('@/utils/printReceipt');
            printViaRawBT(lines);
          } catch (e) { console.error('[virtual_renew] print', e); }
        }
        setSelectedVirtualMember(null);
        setVirtualAmount(''); setVirtualPayMethod(''); setVirtualUpiAccount(null);
        setVirtualPlanId(''); setVirtualCollectionDate('');
        setScreen('virtual_grid');
      } catch (e) {
        console.error('[virtual_renew] save', e);
        alert('Failed to save renewal. Please try again.');
      }
      setVirtualSaving(false);
    };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#1a0f2e 0%,#2d1b4e 100%)', padding: 24, paddingTop: 64, fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        <button onClick={() => setScreen('virtual_renew_choice')} style={S.backBtn}>← Back</button>
        <div style={{ maxWidth: 520, margin: '0 auto', ...S.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <span style={{ fontSize: 36 }}>🔁</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a' }}>Renew Virtual Member</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, marginTop: 2 }}>{vm.name} · {vm.memberId} · {vm.phone}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Plan (optional)</div>
              <select
                value={virtualPlanId}
                onChange={e => {
                  const p = clubMemberships.find(x => x.id === e.target.value);
                  setVirtualPlanId(e.target.value);
                  if (p) setVirtualAmount(String(p.price || ''));
                }}
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', background: 'white' }}
              >
                <option value="">— Renewal payment only —</option>
                {clubMemberships.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — ₹{p.price} ({p.durationDays}d)</option>
                ))}
              </select>
              {planEnd && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#15803d', fontWeight: 700, background: '#f0fdf4', borderRadius: 8, padding: '6px 10px' }}>
                  Active: Today → {planEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Product collection date (optional)</div>
              <input
                type="date"
                value={virtualCollectionDate}
                onChange={e => setVirtualCollectionDate(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Amount (₹)</div>
              <input
                type="number"
                value={virtualAmount}
                onChange={e => setVirtualAmount(e.target.value)}
                placeholder="0"
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 15, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>Payment method</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setVirtualPayMethod('cash'); setVirtualUpiAccount(null); }}
                  style={{ flex: 1, minWidth: 90, padding: '10px', border: `2px solid ${virtualPayMethod === 'cash' ? '#7c3aed' : '#e5e7eb'}`, background: virtualPayMethod === 'cash' ? '#faf5ff' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                >💵 Cash</button>
                {upiAccounts.map((u: any) => (
                  <button key={u.id}
                    onClick={() => { setVirtualPayMethod('upi'); setVirtualUpiAccount(u); }}
                    style={{ flex: 1, minWidth: 100, padding: '10px', border: `2px solid ${virtualPayMethod === 'upi' && virtualUpiAccount?.id === u.id ? '#7c3aed' : '#e5e7eb'}`, background: virtualPayMethod === 'upi' && virtualUpiAccount?.id === u.id ? '#faf5ff' : 'white', borderRadius: 10, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
                  >📱 {u.app || 'UPI'}</button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={saveRenewal}
            disabled={!canSave}
            style={{
              width: '100%', marginTop: 22, padding: 16,
              background: !canSave ? '#d1d5db' : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              color: 'white', border: 'none', borderRadius: 12,
              fontSize: 15, fontWeight: 900,
              cursor: !canSave ? 'not-allowed' : 'pointer',
              fontFamily: 'Nunito, sans-serif',
              boxShadow: '0 4px 16px rgba(124,58,237,0.35)',
            }}
          >
            {virtualSaving ? 'Saving…' : '✅ Save Renewal'}
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'volunteer_grid') {
    const activeVols = volunteerSessions.filter(s => s.status === 'signed_in');
    const completedVols = volunteerSessions.filter(s => s.status === 'signed_out');

    const vq = volunteerSearch.toLowerCase().trim();
    const getVolStats = (m: any) => {
      const s = volunteerSessions.find(s => s.memberId === m.id || s.id === m.id);
      if (!s) return { active: false, count: 0, lastActive: 0 };
      const active = s.status === 'signed_in';
      const count = Number(s.totalSessions || 0);
      const lastTs = s.lastActivityTimestamp;
      const lastMs = lastTs?.toMillis ? lastTs.toMillis() : (typeof lastTs === 'number' ? lastTs : 0);
      const fallbackMs = Math.max(Number(s.signInTimestamp || 0), Number(s.signOutTimestamp || 0));
      return { active, count, lastActive: lastMs || fallbackMs };
    };
    const filteredVols = members
      // Only members marked as volunteers on the Admin → Volunteers page
      // (members.isVolunteer === true). All other members are hidden here.
      .filter(vol => vol.isVolunteer === true)
      .filter(vol => {
        if (!vq) return true;
        return (
          (vol.name || '').toLowerCase().includes(vq) ||
          (vol.phone || '').toLowerCase().includes(vq) ||
          (vol.memberId || '').toLowerCase().includes(vq)
        );
      })
      .sort((a, b) => {
        const sa = getVolStats(a);
        const sb = getVolStats(b);
        // 1. Currently signed-in volunteers first
        if (sa.active !== sb.active) return sa.active ? -1 : 1;
        // 2. Frequency: volunteers with more sessions first
        if (sa.count !== sb.count) return sb.count - sa.count;
        // 3. Recency: most recently active first
        if (sa.lastActive !== sb.lastActive) return sb.lastActive - sa.lastActive;
        // 4. Fallback: member ID
        const idA = (a.memberId || '').toString().padStart(10, '0');
        const idB = (b.memberId || '').toString().padStart(10, '0');
        return idA.localeCompare(idB);
      });

    const handleVolunteerTap = async (vol: any) => {
      // Mirror the member-tile behaviour: when the club has face verify
      // turned OFF, a tap on the volunteer tile *is* the auth — first tap
      // signs in, next tap on the same volunteer signs out.
      if (faceVerificationEnabled === false) {
        await toggleVolunteerSession(vol);
        return;
      }

      // Face verify ON — go through the camera-scan flow as before.
      let faceDescriptor = vol.faceDescriptor;
      if (!faceDescriptor && clubId) {
        try {
          const memberDoc = await getDoc(doc(db, 'clubs', clubId, 'members', vol.id));
          if (memberDoc.exists()) faceDescriptor = memberDoc.data().faceDescriptor;
        } catch {}
      }
      const volWithFace = faceDescriptor ? { ...vol, faceDescriptor } : vol;
      setVerifyingVolunteer(volWithFace);
      setFaceStatus(modelsLoaded ? 'Starting camera…' : 'Loading face models…');
      setScreen('volunteer_verify');
      setTimeout(() => startVolunteerFaceVerification(volWithFace), 600);
    };

    return (
      <div style={{ minHeight: '100vh', background: '#f5f3ff', fontFamily: 'Nunito, sans-serif' }}>
        <div style={{ background: 'linear-gradient(135deg,#2d1b69,#4f46e5)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={goHome} style={{ ...S.backBtn, position: 'relative', top: 'auto', left: 'auto' }}>← Back</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 900, margin: 0 }}>🙌 Volunteer Check-in</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '4px 0 0' }}>Search by ID, name or mobile</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            title="Reload page"
            style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.22)', borderRadius: 12, color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >↺</button>
        </div>
        <div style={{ padding: '12px 24px 0' }}>
          <div className="rx-search-wrap" style={{ position: 'relative' }}>
            <input
              ref={volunteerSearchRef}
              className="rx-search rx-search-volunteer"
              placeholder={searchKeyboardMode === 'numeric' ? '🔍 Volunteer ID or Mobile number…' : '🔍 Type volunteer name…'}
              value={volunteerSearch}
              onChange={e => setVolunteerSearch(e.target.value)}
              inputMode={searchKeyboardMode}
              type={searchKeyboardMode === 'numeric' ? 'tel' : 'text'}
              autoFocus
              style={{
                width: '100%', padding: '15px 92px 15px 18px', border: '2.5px solid #6366f1', borderRadius: 14,
                fontSize: 17, fontFamily: 'Nunito, sans-serif', boxSizing: 'border-box', outline: 'none', background: 'white',
              }}
            />
            <button
              type="button"
              onClick={toggleSearchKeyboard}
              title={searchKeyboardMode === 'numeric' ? 'Switch to letters' : 'Switch to numbers'}
              style={{
                position: 'absolute', top: '50%', right: volunteerSearch ? 48 : 12, transform: 'translateY(-50%)',
                background: '#eef2ff', border: '1.5px solid #c7d2fe', color: '#4338ca',
                borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                fontFamily: 'Nunito, sans-serif', letterSpacing: 0.5,
              }}
            >{searchKeyboardMode === 'numeric' ? '123' : 'ABC'}</button>
            {volunteerSearch && (
              <button
                type="button"
                className="rx-clear-btn"
                onClick={() => setVolunteerSearch('')}
                title="Clear"
              >✕</button>
            )}
          </div>
        </div>

        {/* ── Volunteer Grid ── */}
        <div style={{ padding: '12px 24px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
              Tap to check in / out · {filteredVols.length} volunteer{filteredVols.length !== 1 ? 's' : ''}
            </div>
            <button
              onClick={() => setAddVolOpen(true)}
              style={{ padding: '12px 20px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', boxShadow: '0 4px 14px rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}
            >➕ Add Volunteer</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 16 }}>
            {filteredVols.map(vol => {
              const session = volunteerSessions.find(s => s.memberId === vol.id || s.id === vol.id);
              const isActive = session?.status === 'signed_in';
              return (
                <button
                  key={vol.id}
                  onClick={() => handleVolunteerTap(vol)}
                  style={{ background: isActive ? '#f0fdf4' : 'white', border: `2.5px solid ${isActive ? '#22c55e' : '#e5e7eb'}`, borderRadius: 20, padding: '22px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, boxShadow: '0 3px 16px rgba(0,0,0,0.07)', fontFamily: 'Nunito,sans-serif', position: 'relative' }}
                >
                  {isActive && <div style={{ position: 'absolute', top: 10, right: 10, width: 13, height: 13, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px #bbf7d0' }} />}
                  {/* Member ID — big and prominent */}
                  {vol.memberId && (
                    <div style={{ fontSize: 16, fontWeight: 900, color: isActive ? '#16a34a' : '#6366f1', letterSpacing: 0.5 }}>{vol.memberId}</div>
                  )}
                  {vol.photoUrl || vol.photo ? (
                    <img src={vol.photoUrl || vol.photo} style={{ width: 92, height: 92, borderRadius: '50%', objectFit: 'cover', border: isActive ? '4px solid #22c55e' : '3px solid #e5e7eb' }} />
                  ) : (
                    <div style={{ width: 92, height: 92, borderRadius: '50%', background: isActive ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#6366f1,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, color: 'white', fontWeight: 900 }}>
                      {(vol.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1a3a2a', textAlign: 'center', lineHeight: 1.25 }}>{vol.name}</div>
                  {vol.phone && <div style={{ fontSize: 12.5, color: '#6b7280', fontWeight: 600 }}>{vol.phone}</div>}
                  {isActive && <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 800 }}>In: {session.signInTime}</div>}
                </button>
              );
            })}
            {filteredVols.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 50, color: '#9ca3af' }}>
                <div style={{ fontSize: 52 }}>🙌</div>
                <p style={{ fontSize: 15, fontWeight: 800, color: '#6b7280', margin: '8px 0 4px' }}>
                  {vq ? 'No volunteers match your search' : 'No volunteers added yet'}
                </p>
                {!vq && (
                  <>
                    <p style={{ fontSize: 13, margin: '0 0 16px' }}>Add volunteers from your member list to check them in here.</p>
                    <button onClick={() => setAddVolOpen(true)} style={{ padding: '12px 22px', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 900, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>➕ Add Volunteer</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {addVolOpen && (
          <AddVolunteerPicker
            clubId={clubId}
            members={members}
            onClose={() => setAddVolOpen(false)}
          />
        )}
      </div>
    );
  }

  // ─────────────────────────────
  // ENROLL SELECT
  // ─────────────────────────────
  if (screen === 'enroll_select') {
    const enrollFiltered = members.filter(m => {
      const q = enrollSearch.toLowerCase();
      return (
        (m.name || m.fullName || '').toLowerCase().includes(q) ||
        (m.phone || '').toLowerCase().includes(q)
      );
    });
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Nunito, sans-serif', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <button onClick={goHome} style={{ background: '#f3f4f6', border: 'none', borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}>← Back</button>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#1a3a2a', margin: 0 }}>📸 Enroll Face</h2>
        </div>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>Select a member to enroll or update their face ID &amp; plan.</p>

        {/* Search bar */}
        <div style={{ position: 'relative', maxWidth: 500, marginBottom: 20 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#9ca3af', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            placeholder="Search by name, phone or plan…"
            value={enrollSearch}
            onChange={e => setEnrollSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px 10px 36px',
              borderRadius: 10,
              border: '1.5px solid #e5e7eb',
              fontSize: 14,
              fontFamily: 'Nunito, sans-serif',
              outline: 'none',
              background: 'white',
              boxSizing: 'border-box',
            }}
          />
          {enrollSearch && (
            <button
              onClick={() => setEnrollSearch('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af', lineHeight: 1 }}
            >✕</button>
          )}
        </div>

        {/* Count */}
        <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
          {enrollFiltered.length} member{enrollFiltered.length !== 1 ? 's' : ''} found
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 500 }}>
          {enrollFiltered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: 14 }}>
              No members match "<strong>{enrollSearch}</strong>"
            </div>
          ) : (
            enrollFiltered.map(m => (
              <button
                key={m.id}
                onClick={() => { setEnrollMemberId(m.id); setEnrollPhotos([]); setEnrollStatus(''); setEnrollPlanId(m.membershipPlanId || ''); setEnrollDaysUsed(''); setScreen('enroll_plan'); }}
                style={{ background: 'white', border: m.hasFace ? '1.5px solid #86efac' : '1.5px solid #fde047', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3a2a' }}>{m.name || m.fullName || '(no name)'}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{m.phone || ''}{(m as any).shakeCredits > 0 ? ` · ${(m as any).shakeCredits} credits` : ''}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: m.hasFace ? '#2d9653' : '#f59e0b' }}>{m.hasFace ? '✅ Enrolled' : '⚠️ Not enrolled'}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // ENROLL PLAN — Select membership & days used
  // ─────────────────────────────
  if (screen === 'enroll_plan') {
    const enrollMember = members.find(m => m.id === enrollMemberId);
    const selectedPlan = clubMemberships.find(p => p.id === enrollPlanId);
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Nunito, sans-serif' }}>
        <div style={{ background: 'linear-gradient(135deg,#0a1f14,#1a3a2a)', padding: '24px', textAlign: 'center' }}>
          <button onClick={() => setScreen('enroll_select')} style={{ ...S.backBtn, position: 'absolute', top: 20, left: 20 }}>← Back</button>
          {enrollMember?.photoUrl ? (
            <img src={enrollMember.photoUrl} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(255,255,255,0.3)', marginBottom: 10 }} />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'white', fontWeight: 900, margin: '0 auto 10px' }}>
              {(enrollMember?.name || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ color: 'white', fontSize: 20, fontWeight: 900 }}>{enrollMember?.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 2 }}>{enrollMember?.phone || ''}</div>
        </div>

        <div style={{ padding: '24px', maxWidth: 480, margin: '0 auto' }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#1a3a2a', marginBottom: 16 }}>🥤 Select Shake Credits Package</div>

          {/* No plan option */}
          <button
            onClick={() => setEnrollPlanId('')}
            style={{ width: '100%', padding: '14px 18px', background: !enrollPlanId ? '#fef2f2' : 'white', border: `2px solid ${!enrollPlanId ? '#ef4444' : '#e5e7eb'}`, borderRadius: 14, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left', marginBottom: 10 }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: '#ef4444' }}>❌ No Credits</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Skip — enroll face only</div>
          </button>

          {/* Plan options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {clubMemberships.map(plan => {
              const isSelected = enrollPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  onClick={() => setEnrollPlanId(plan.id)}
                  style={{ width: '100%', padding: '16px 18px', background: isSelected ? '#f0fdf4' : 'white', border: `2px solid ${isSelected ? '#2d9653' : '#e5e7eb'}`, borderRadius: 14, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', textAlign: 'left', position: 'relative' }}
                >
                  {isSelected && <div style={{ position: 'absolute', top: 12, right: 14, fontSize: 18 }}>✅</div>}
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#2d9653' }}>{plan.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                    {planCreditsLabel(plan)} · ₹{plan.price}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Payment method — only when a paid plan is selected */}
          {enrollPlanId && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#1a3a2a', marginBottom: 8 }}>💳 Payment Method</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['cash', 'upi'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setEnrollPayMethod(m)}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `2px solid ${enrollPayMethod === m ? '#2d9653' : '#e5e7eb'}`, background: enrollPayMethod === m ? '#f0fdf4' : 'white', color: enrollPayMethod === m ? '#2d9653' : '#6b7280', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito,sans-serif' }}
                  >
                    {m === 'cash' ? '💵 Cash' : '📱 UPI'}
                  </button>
                ))}
              </div>
              {selectedPlan && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#374151', fontWeight: 800, textAlign: 'center', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 10, padding: '8px' }}>
                  Collecting ₹{selectedPlan.price || 0} · {enrollPayMethod === 'cash' ? 'Cash' : 'UPI'}
                </div>
              )}
            </div>
          )}

          {/* Continue to face capture */}
          <button
            onClick={() => { setEnrollPhotos([]); setEnrollStatus(''); setScreen('enroll_capture'); setTimeout(() => startCamera(), 600); }}
            style={{ width: '100%', padding: '16px', background: 'linear-gradient(135deg,#2d9653,#16a34a)', color: 'white', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'Nunito,sans-serif', boxShadow: '0 4px 16px rgba(45,150,83,0.4)' }}
          >
            📸 Continue to Face Capture →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────
  // ENROLL CAPTURE
  // ─────────────────────────────
  if (screen === 'enroll_capture') {
    const enrollMember = members.find(m => m.id === enrollMemberId);
    const enrollStatusText = enrollStatus || faceStatus || 'Capture 3 photos from slightly different angles';
    const isError = enrollStatusText.startsWith('❌') || enrollStatusText.startsWith('⚠️');
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', position: 'relative' }}>
        <button onClick={() => { stopCamera(); setScreen('enroll_plan'); }} style={S.backBtn}>← Back</button>
        <div style={{ color: 'white', fontSize: 20, fontWeight: 800, marginBottom: 4, textAlign: 'center' }}>Enrolling: {enrollMember?.name}</div>
        <div style={{ color: isError ? '#fca5a5' : 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 20, textAlign: 'center', padding: '0 40px' }}>
          {enrollStatusText}
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: enrollPhotos.length > i ? '#2d9653' : 'rgba(255,255,255,0.3)', transition: 'background 0.2s' }} />
          ))}
        </div>
        <div style={{ position: 'relative', width: 280, height: 280, marginBottom: 32 }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 280, height: 280, borderRadius: '50%', objectFit: 'cover', transform: 'scaleX(-1)', border: `4px solid ${isError ? '#ef4444' : '#2d9653'}` }} />
        </div>
        <button
          onClick={captureEnrollPhoto}
          disabled={enrollPhotos.length >= 3 && !isError}
          style={{ background: (enrollPhotos.length >= 3 && !isError) ? '#4b7a5a' : '#2d9653', color: 'white', border: 'none', borderRadius: '50%', width: 80, height: 80, fontSize: 32, cursor: (enrollPhotos.length >= 3 && !isError) ? 'not-allowed' : 'pointer', boxShadow: '0 0 0 8px rgba(45,150,83,0.25)' }}
        >
          📸
        </button>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 12 }}>Tap to capture ({enrollPhotos.length}/3)</div>
        <button
          onClick={() => { stopCamera(); setEnrollPhotos([]); setEnrollStatus(''); setFaceStatus(''); setTimeout(() => startCamera(), 600); }}
          style={{ marginTop: 16, background: 'rgba(255,255,255,0.1)', border: '1.5px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}
        >
          ↺ Restart Camera
        </button>
      </div>
    );
  }

  return null;
}
