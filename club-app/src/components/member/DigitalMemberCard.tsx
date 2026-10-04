import { ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { User, Wallet, Club } from "@/types/firestore";

interface Props {
    member: User;
    wallet: Wallet | null;
    club: Club;
    isFlipped: boolean;
    onFlip: () => void;
}

export default function DigitalMemberCard({ member, wallet, club, isFlipped, onFlip }: Props) {
    const gradient = "from-emerald-500 to-green-700";
    const textColor = "text-white";
    const memberIdDisplay = `MNC-${member.id.substring(0, 6).toUpperCase()}`;

    return (
        <div
            className="relative w-full aspect-[1.586/1] max-w-sm mx-auto cursor-pointer perspective-1000 group"
            onClick={onFlip}
            id="digital-member-card" // for html2canvas
        >
            <div className={`relative w-full h-full duration-700 preserve-3d transition-transform ${isFlipped ? "rotate-y-180" : ""}`}>

                {/* FRONT */}
                <div className={`absolute w-full h-full backface-hidden rounded-2xl shadow-2xl overflow-hidden bg-gradient-to-br ${gradient}`}>
                    {/* Shine effect overlay */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/20 to-white/0 transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[200%] transition-transform duration-1000" />

                    <div className={`p-6 flex flex-col h-full justify-between ${textColor}`}>
                        <div className="flex justify-between items-start">
                            <div>
                                {club.logo ? (
                                    <img src={club.logo} alt="Club Logo" className="w-8 h-8 rounded-full bg-white/50 p-0.5 object-cover mb-1" />
                                ) : (
                                    <ShieldCheck className="w-8 h-8 opacity-80 mb-1" />
                                )}
                                <h2 className="font-black text-sm tracking-widest opacity-90 uppercase">{club.name}</h2>
                            </div>

                            <div className="w-14 h-14 rounded-full border-2 border-white/40 overflow-hidden shadow-inner">
                                {member.photo ? (
                                    <img src={member.photo} className="w-full h-full object-cover" alt="" />
                                ) : (
                                    <div className="w-full h-full bg-black/10 flex items-center justify-center font-bold text-lg">
                                        {member.name.charAt(0)}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-1 mt-auto">
                            <p className="text-[10px] uppercase font-bold tracking-widest opacity-70">Member Name</p>
                            <h3 className="text-xl font-black capitalize">{member.name}</h3>

                            <div className="flex items-end justify-between pt-2">
                                <div>
                                    <p className="font-mono text-sm font-bold opacity-90">{memberIdDisplay}</p>
                                    <p className="text-[10px] opacity-70 mt-0.5">{(member as any).shakeCredits ?? 0} Shake Credits</p>
                                </div>

                                <div className="bg-white p-1.5 rounded-lg shadow-sm">
                                    <QRCodeSVG value={member.id} size={40} className="w-10 h-10" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* BACK */}
                <div className="absolute w-full h-full backface-hidden rounded-2xl shadow-2xl overflow-hidden bg-slate-900 text-white rotate-y-180 flex flex-col">
                    {/* Magnetic strip aesthetic */}
                    <div className="w-full h-10 bg-black mt-6 opacity-80" />

                    <div className="p-6 flex flex-col flex-1 justify-between">
                        <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700">
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Wallet Balance</p>
                            <p className="text-2xl font-black font-mono">
                                {wallet ? wallet.balance.toLocaleString() : 0} <span className="text-sm font-medium text-slate-400">{club.currencyName}</span>
                            </p>
                        </div>

                        <div className="text-xs text-slate-400 space-y-1">
                            <p>Shake Credits: <span className="text-white font-medium">{(member as any).shakeCredits ?? 0} / {(member as any).shakeCreditsPlanTotal ?? 0}</span></p>
                            {club.ownerPhone && (
                                <p>Support: <span className="text-white font-medium">{club.ownerPhone}</span></p>
                            )}
                            <p className="mt-4 text-[10px] opacity-50 italic">This card is non-transferable.</p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
