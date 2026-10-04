import { useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
    title: string;
    icon: string;
    children: React.ReactNode;
}

export default function PinProtectedRoute({ title, icon, children }: Props) {
    const { club, loading: clubLoading } = useClubContext();
    const [pin, setPin] = useState("");
    const [authenticated, setAuthenticated] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handlePinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!club?.kitchenPin) {
            setError("PIN is not configured for this club.");
            return;
        }
        if (pin === club.kitchenPin) {
            setAuthenticated(true);
        } else {
            setError("Invalid PIN. Please try again.");
            setPin("");
        }
    };

    if (clubLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-emerald-50 p-4">
                <div className="w-full max-w-sm">
                    <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 p-8 space-y-6">
                        <div className="text-center space-y-2">
                            <div className="h-14 w-14 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 flex items-center justify-center">
                                <span className="text-white text-2xl">{icon}</span>
                            </div>
                            <h1 className="text-2xl font-bold">{title}</h1>
                            <p className="text-sm text-muted-foreground">{club?.name || "Club"}</p>
                            <p className="text-xs text-muted-foreground">Enter the 4-digit PIN</p>
                        </div>
                        <form onSubmit={handlePinSubmit} className="space-y-4">
                            <Input
                                type="password"
                                inputMode="numeric"
                                maxLength={4}
                                placeholder="• • • •"
                                value={pin}
                                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                                className="text-center text-2xl tracking-[0.5em] font-mono"
                                autoFocus
                            />
                            {error && (
                                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 text-center">
                                    {error}
                                </div>
                            )}
                            <Button type="submit" className="w-full" disabled={pin.length !== 4}>
                                Enter
                            </Button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
