import { useState } from "react";
import { ClipboardList, Check, X, AlertTriangle } from "lucide-react";
import { useKitchenRequests, useApproveKitchenRequest, useRejectKitchenRequest } from "@/hooks/useKitchenInventory";
import FaceVerification from "@/components/FaceVerification";

interface Props {
    clubId: string;
    accountants: any[];
}

export default function KitchenRequestApproval({ clubId, accountants }: Props) {
    const { requests, loading } = useKitchenRequests();
    const approve = useApproveKitchenRequest();
    const reject = useRejectKitchenRequest();

    const [selectedRequest, setSelectedRequest] = useState<any>(null);
    const [issuedQtys, setIssuedQtys] = useState<Record<string, number>>({});
    const [showVerify, setShowVerify] = useState(false);

    const pendingRequests = requests.filter(r => r.status === 'pending');
    const resolvedRequests = requests.filter(r => r.status !== 'pending');

    const startApproval = (req: any) => {
        setSelectedRequest(req);
        const qtys: Record<string, number> = {};
        for (const item of req.items) {
            qtys[item.productId] = item.requestedQty;
        }
        setIssuedQtys(qtys);
    };

    const handleVerified = async (verifier: { id: string; name: string }) => {
        if (!selectedRequest) return;
        await approve.mutateAsync({
            requestId: selectedRequest.id,
            issuedItems: selectedRequest.items.map((item: any) => ({
                productId: item.productId,
                productName: item.productName,
                issuedQty: issuedQtys[item.productId] ?? item.requestedQty,
                unit: item.unit,
            })),
            resolvedBy: verifier.name,
        });
        setSelectedRequest(null);
        setShowVerify(false);
    };

    const handleReject = async (reqId: string) => {
        await reject.mutateAsync({ requestId: reqId, resolvedBy: 'Owner' });
    };

    if (loading) return <div className="py-6 text-center text-slate-400 text-sm animate-pulse">Loading requests...</div>;

    // Face verification view
    if (showVerify && selectedRequest) {
        return (
            <FaceVerification
                clubId={clubId}
                verifiers={accountants.map(m => ({
                    id: m.id, name: m.name, photo: m.photoUrl || m.photo,
                    faceDescriptor: m.faceDescriptor, role: "Inventory Manager",
                }))}
                title="Inventory Manager Verification"
                subtitle={`Issuing ${selectedRequest.items.length} items to kitchen`}
                onVerified={handleVerified}
                onCancel={() => setShowVerify(false)}
            />
        );
    }

    // Approval detail view
    if (selectedRequest) {
        return (
            <div className="space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-black text-slate-900">Review Request</h3>
                    <button onClick={() => setSelectedRequest(null)} className="text-xs font-bold text-blue-600 hover:underline">← Back</button>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-center">
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-widest">Estimated</p>
                    <p className="text-2xl font-black text-blue-900">{selectedRequest.estimatedShakes} shakes</p>
                    <p className="text-[10px] text-blue-500">Requested by: {selectedRequest.requestedBy}</p>
                    {selectedRequest.isEmergency && (
                        <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" /> Emergency
                        </span>
                    )}
                </div>

                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Adjust Issue Quantities</p>
                    <div className="space-y-2">
                        {selectedRequest.items.map((item: any) => (
                            <div key={item.productId} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                                <div className="flex-1">
                                    <p className="font-bold text-slate-900 text-sm">{item.productName}</p>
                                    <p className="text-[10px] text-slate-400">Requested: {item.requestedQty} {item.unit}s</p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <button onClick={() => setIssuedQtys(prev => ({ ...prev, [item.productId]: Math.max(0, (prev[item.productId] || 0) - 1) }))}
                                        className="w-7 h-7 rounded-lg border border-slate-200 font-bold text-slate-500 text-xs">−</button>
                                    <input type="number" min={0}
                                        value={issuedQtys[item.productId] ?? item.requestedQty}
                                        onChange={e => setIssuedQtys(prev => ({ ...prev, [item.productId]: Math.max(0, Number(e.target.value)) }))}
                                        className="w-14 text-center px-1 py-1 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none" />
                                    <button onClick={() => setIssuedQtys(prev => ({ ...prev, [item.productId]: (prev[item.productId] || 0) + 1 }))}
                                        className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs">+</button>
                                    <span className="text-[10px] text-slate-400 w-8">{item.unit}s</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => handleReject(selectedRequest.id)} disabled={reject.isPending}
                        className="flex-1 py-3 rounded-2xl border border-red-200 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors">
                        Reject
                    </button>
                    <button onClick={() => setShowVerify(true)}
                        className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors">
                        Approve & Issue →
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4" style={{ fontFamily: "'Nunito', sans-serif" }}>
            <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-black text-slate-900">Kitchen Requests</h3>
                {pendingRequests.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">{pendingRequests.length} pending</span>
                )}
            </div>

            {pendingRequests.length === 0 && resolvedRequests.length === 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-6 text-center">
                    <p className="text-xs text-slate-400 font-semibold">No kitchen requests today</p>
                </div>
            )}

            {/* Pending requests */}
            {pendingRequests.map(req => {
                const time = (req.requestedAt as any)?.toDate?.() || new Date();
                return (
                    <button key={req.id} onClick={() => startApproval(req)}
                        className="w-full bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 text-left hover:border-amber-400 transition-all">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 text-[9px] font-black uppercase">Pending</span>
                                {req.isEmergency && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-black">Emergency</span>}
                            </div>
                            <span className="text-[10px] text-slate-400">{time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="font-bold text-slate-900 text-sm">{req.estimatedShakes} shakes estimated</p>
                        <p className="text-[10px] text-slate-500">{req.items.length} ingredients · By: {req.requestedBy}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                            {req.items.map((item: any, i: number) => (
                                <span key={i} className="px-2 py-0.5 rounded-lg bg-white text-[10px] font-bold text-slate-600 border border-slate-100">
                                    {item.productName} × {item.requestedQty}
                                </span>
                            ))}
                        </div>
                    </button>
                );
            })}

            {/* Resolved requests */}
            {resolvedRequests.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Resolved Today</p>
                    {resolvedRequests.map(req => (
                        <div key={req.id} className="bg-white border border-slate-100 rounded-xl px-3 py-2.5 mb-1.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${req.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                        {req.status === 'approved' ? 'Issued' : 'Rejected'}
                                    </span>
                                    <span className="text-xs font-bold text-slate-700">{req.estimatedShakes} shakes</span>
                                    {req.isEmergency && <span className="text-[9px] text-amber-600 font-bold">EMG</span>}
                                </div>
                                <span className="text-[10px] text-slate-400">by {req.resolvedBy}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
