import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface PinGateProps {
    type: "kitchen" | "admin" | "tv" | "btc";
    clubName: string;
    clubLogo: string;
    pinLength: number;
    isLoading: boolean;
    onVerify: (pin: string) => Promise<boolean>;
    /** Override the heading — for a screen that shares another screen's PIN. */
    title?: string;
    /** Override the emoji shown when the club has no logo. */
    icon?: string;
    /** Override the submit button's wording. */
    buttonLabel?: string;
    /**
     * One free-length box instead of a fixed row of them.
     *
     * A screen that borrows another screen's PIN cannot know how long that PIN
     * is — the club may have set four digits or eight — and a row of six boxes
     * would simply refuse a correct four-digit PIN.
     */
    variableLength?: boolean;
}

export default function PinGate({
    type, clubName, clubLogo, pinLength, isLoading, onVerify,
    title: titleOverride, icon: iconOverride, buttonLabel, variableLength = false,
}: PinGateProps) {
    const [digits, setDigits] = useState<string[]>(Array(pinLength).fill(""));
    const [freePin, setFreePin] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [shaking, setShaking] = useState(false);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const freeRef = useRef<HTMLInputElement | null>(null);

    // Focus first input on mount
    useEffect(() => {
        if (variableLength) freeRef.current?.focus();
        else inputRefs.current[0]?.focus();
    }, [variableLength]);

    function handleDigitChange(index: number, value: string) {
        const cleaned = value.replace(/\D/g, "");
        if (!cleaned) return;

        const newDigits = [...digits];
        // Handle paste — distribute across boxes
        if (cleaned.length > 1) {
            const chars = cleaned.slice(0, pinLength).split("");
            chars.forEach((ch, i) => {
                if (index + i < pinLength) newDigits[index + i] = ch;
            });
            setDigits(newDigits);
            setError(null);
            const nextIdx = Math.min(index + chars.length, pinLength - 1);
            inputRefs.current[nextIdx]?.focus();
            // Auto-submit if all filled
            if (newDigits.every((d) => d !== "")) {
                submitPin(newDigits.join(""));
            }
            return;
        }

        newDigits[index] = cleaned[0];
        setDigits(newDigits);
        setError(null);

        // Move to next input
        if (index < pinLength - 1) {
            inputRefs.current[index + 1]?.focus();
        }

        // Auto-submit when all filled
        if (newDigits.every((d) => d !== "")) {
            submitPin(newDigits.join(""));
        }
    }

    function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Backspace") {
            e.preventDefault();
            const newDigits = [...digits];
            if (digits[index]) {
                newDigits[index] = "";
                setDigits(newDigits);
            } else if (index > 0) {
                newDigits[index - 1] = "";
                setDigits(newDigits);
                inputRefs.current[index - 1]?.focus();
            }
            setError(null);
        }
        if (e.key === "Enter") {
            const pin = digits.join("");
            if (pin.length === pinLength) submitPin(pin);
        }
    }

    function clearEntry() {
        if (variableLength) {
            setFreePin("");
            freeRef.current?.focus();
            return;
        }
        setDigits(Array(pinLength).fill(""));
        inputRefs.current[0]?.focus();
    }

    async function submitPin(pin: string) {
        setVerifying(true);
        setError(null);
        try {
            const ok = await onVerify(pin);
            if (!ok) {
                setShaking(true);
                setError("Incorrect PIN. Please try again.");
                setTimeout(() => {
                    setShaking(false);
                    clearEntry();
                }, 500);
            }
        } catch {
            setError("Verification failed. Please try again.");
            clearEntry();
        } finally {
            setVerifying(false);
        }
    }

    function handlePaste(e: React.ClipboardEvent) {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, pinLength);
        if (!pasted) return;
        const newDigits = Array(pinLength).fill("");
        pasted.split("").forEach((ch, i) => { newDigits[i] = ch; });
        setDigits(newDigits);
        setError(null);
        const nextIdx = Math.min(pasted.length, pinLength - 1);
        inputRefs.current[nextIdx]?.focus();
        if (newDigits.every((d) => d !== "")) {
            submitPin(newDigits.join(""));
        }
    }

    const isKitchen = type === "kitchen";
    const isTv = type === "tv";
    const isBtc = type === "btc";
    const icon = iconOverride ?? (isKitchen ? "🍳" : isTv ? "📺" : isBtc ? "🏆" : "🔐");
    const title = titleOverride ?? (isKitchen ? "Kitchen Access" : isTv ? "TV Display Access" : isBtc ? "BTC Coordinator" : "Admin Access");
    const subtitle = variableLength ? "Enter the PIN to continue" : `Enter ${pinLength}-digit PIN to continue`;
    const canSubmit = variableLength ? freePin.length >= 4 : digits.every((d) => d);
    const bgGradient = isKitchen
        ? "from-orange-50 via-white to-yellow-50"
        : isTv
            ? "from-emerald-50 via-white to-teal-50"
            : isBtc
                ? "from-amber-50 via-white to-orange-50"
                : "from-emerald-50 via-white to-green-50";
    const iconGradient = isKitchen
        ? "from-orange-500 to-yellow-500"
        : isTv
            ? "from-emerald-600 to-teal-500"
            : isBtc
                ? "from-amber-600 to-orange-500"
                : "from-emerald-600 to-green-500";

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
        );
    }

    return (
        <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br ${bgGradient} p-4`}
            style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="w-full max-w-sm">
                <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-8 space-y-6">
                    {/* Club logo + info */}
                    <div className="text-center space-y-3">
                        {clubLogo ? (
                            <img src={clubLogo} alt={clubName} className="h-14 w-14 mx-auto rounded-xl object-cover border" />
                        ) : (
                            <div className={`h-14 w-14 mx-auto rounded-xl bg-gradient-to-br ${iconGradient} flex items-center justify-center`}>
                                <span className="text-white text-2xl">{icon}</span>
                            </div>
                        )}
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                            <p className="text-sm text-gray-500 mt-1">{clubName}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
                        </div>
                    </div>

                    {/* PIN entry — one free box when the length isn't known */}
                    {variableLength ? (
                        <div className={shaking ? "animate-shake" : ""}>
                            <input
                                ref={freeRef}
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                value={freePin}
                                onChange={(e) => {
                                    setFreePin(e.target.value.replace(/\D/g, "").slice(0, 12));
                                    setError(null);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && freePin.length >= 4) submitPin(freePin);
                                }}
                                disabled={verifying}
                                placeholder="••••"
                                className={[
                                    "w-full h-14 text-center text-2xl font-bold tracking-[0.5em] rounded-xl border-2 outline-none transition-all",
                                    "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
                                    error ? "border-red-300 bg-red-50" : "border-gray-200 bg-white",
                                    verifying ? "opacity-50" : "",
                                ].join(" ")}
                            />
                        </div>
                    ) : (
                    <div
                        className={`flex justify-center gap-2 ${shaking ? "animate-shake" : ""}`}
                        onPaste={handlePaste}
                    >
                        {digits.map((digit, i) => (
                            <input
                                key={i}
                                ref={(el) => { inputRefs.current[i] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleDigitChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                disabled={verifying}
                                className={[
                                    "w-12 h-14 text-center text-xl font-bold rounded-xl border-2 outline-none transition-all",
                                    "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
                                    error ? "border-red-300 bg-red-50" : "border-gray-200 bg-white",
                                    verifying ? "opacity-50" : "",
                                ].join(" ")}
                                style={{ minWidth: 48, minHeight: 48 }}
                            />
                        ))}
                    </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
                            {error}
                        </div>
                    )}

                    {/* Submit button */}
                    <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-base"
                        disabled={!canSubmit || verifying}
                        onClick={() => submitPin(variableLength ? freePin : digits.join(""))}
                    >
                        {verifying ? (
                            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Verifying…</>
                        ) : (
                            buttonLabel ?? `Enter ${isKitchen ? "Kitchen" : isTv ? "TV Display" : isBtc ? "BTC Coordinator" : "Dashboard"}`
                        )}
                    </Button>
                </div>

                {/* Security note */}
                <p className="text-center text-[10px] text-gray-400 mt-4">
                    Contact your club admin if you don't have the PIN.
                </p>
            </div>

            {/* Shake animation */}
            <style>{`
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    20%, 60% { transform: translateX(-8px); }
                    40%, 80% { transform: translateX(8px); }
                }
                .animate-shake { animation: shake 0.4s ease-in-out; }
            `}</style>
        </div>
    );
}
