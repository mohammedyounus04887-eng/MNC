import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    Upload,
    Trash2,
    Copy,
    Check,
    ChevronRight,
    ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ImageLabelSelect } from "@/components/ui/ImageLabelSelect";
import { useToast } from "@/hooks/use-toast";
import ClubForm, { type ClubFormValues } from "@/components/superadmin/ClubForm";
import { useCreateClub } from "@/hooks/useSuperAdmin";
import { useAuth } from "@/lib/auth";
import {
    useUploadLandingImage,
    useDeleteLandingImage,
    useUploadLandingHTML,
} from "@/hooks/useLandingImages";
import type { LandingImage } from "@/types/firestore";

export default function CreateClub() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const createClub = useCreateClub();
    const { firebaseUser } = useAuth();

    const [step, setStep] = useState(1);
    const [createdClubId, setCreatedClubId] = useState<string | null>(null);
    const [images, setImages] = useState<LandingImage[]>([]);

    const handleSubmit = async (data: ClubFormValues) => {
        try {
            const newClubId = await createClub.mutateAsync({
                club: {
                    name: data.name,
                    currencyName: data.currencyName,
                    domain: data.domain,
                    landingPageUrl: "",
                    landingPageImages: [],
                    parentClubId: data.parentClubId || null,
                    treePath: "",
                    theme: "custom",
                    primaryColor: data.primaryColor,
                    secondaryColor: data.secondaryColor,
                    tertiaryColor: data.tertiaryColor,
                    logo: "",
                    heroImage: "",
                    tagline: data.tagline || "",
                    ownerName: data.ownerName,
                    ownerPhone: data.ownerPhone,
                    ownerUserId: "",
                    kitchenPin: data.kitchenPin,
                },
                ownerEmail: data.ownerEmail || "",
                createdBy: firebaseUser?.uid || "superadmin",
            });

            setCreatedClubId(newClubId);
            toast({ title: "Club created!", description: `${data.name} is now live.` });
            setStep(2);
        } catch (err: any) {
            toast({
                title: "Error creating club",
                description: err.message || "Something went wrong.",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                        step === 1 ? navigate("/superadmin/clubs") : setStep((s) => s - 1)
                    }
                >
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Create New Club</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Step {step} of 3 — {step === 1 ? "Basic Info" : step === 2 ? "Club Images" : "Landing Page HTML"}
                    </p>
                </div>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-2">
                {[1, 2, 3].map((s) => (
                    <div
                        key={s}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-violet-500" : "bg-gray-200"
                            }`}
                    />
                ))}
            </div>

            {/* Step 1 — Basic Info */}
            {step === 1 && (
                <div className="max-w-2xl bg-white rounded-2xl border p-6">
                    <ClubForm
                        mode="create"
                        onSubmit={handleSubmit}
                        isLoading={createClub.isPending}
                    />
                </div>
            )}

            {/* Step 2 — Club Images */}
            {step === 2 && createdClubId && (
                <ImageUploadStep
                    clubId={createdClubId}
                    images={images}
                    setImages={setImages}
                    onNext={() => setStep(3)}
                    onSkip={() => navigate(`/superadmin/clubs/${createdClubId}`)}
                />
            )}

            {/* Step 3 — Landing Page HTML */}
            {step === 3 && createdClubId && (
                <HTMLUploadStep
                    clubId={createdClubId}
                    onBack={() => setStep(2)}
                    onFinish={() => navigate(`/superadmin/clubs/${createdClubId}`)}
                />
            )}
        </div>
    );
}

// ─── Step 2: Image Upload ────────────────────────────────────────────────

function ImageUploadStep({
    clubId,
    images,
    setImages,
    onNext,
    onSkip,
}: {
    clubId: string;
    images: LandingImage[];
    setImages: React.Dispatch<React.SetStateAction<LandingImage[]>>;
    onNext: () => void;
    onSkip: () => void;
}) {
    const { toast } = useToast();
    const [imageLabel, setImageLabel] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { upload, uploading, progress } = useUploadLandingImage(clubId);
    const { deleteImage, deleting } = useDeleteLandingImage(clubId);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    async function handleUpload() {
        if (!imageFile || !imageLabel) return;
        try {
            const img = await upload(imageFile, imageLabel);
            setImages((prev) => [...prev, img]);
            setImageLabel("");
            setImageFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            // Reset label select by clearing state — handled in ImageLabelSelect
            toast({ title: "Image uploaded!" });
        } catch {
            toast({ title: "Upload failed", variant: "destructive" });
        }
    }

    async function handleDelete(img: LandingImage) {
        try {
            await deleteImage(img);
            setImages((prev) => prev.filter((i) => i.id !== img.id));
            setDeleteConfirmId(null);
            toast({ title: "Image deleted" });
        } catch {
            toast({ title: "Delete failed", variant: "destructive" });
        }
    }

    function copyUrl(id: string, url: string) {
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-2xl border p-6 space-y-5">
                <div>
                    <h3 className="font-semibold">Upload Club Images</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Upload images for the landing page. Generate links to use in your HTML.
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <ImageLabelSelect
                            existingImages={images}
                            value={imageLabel}
                            onChange={setImageLabel}
                        />
                        <div>
                            <Label className="text-xs">File</Label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                                className="mt-1 block w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-violet-50 file:text-violet-700 file:font-medium file:text-xs hover:file:bg-violet-100"
                            />
                        </div>
                    </div>
                    <Button
                        size="sm"
                        disabled={!imageFile || !imageLabel || uploading}
                        onClick={handleUpload}
                        className="gap-1.5"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        {uploading ? "Uploading…" : "Upload Image"}
                    </Button>
                </div>

                {uploading && <Progress value={progress} className="h-2" />}

                {images.length > 0 ? (
                    <div className="space-y-2">
                        {images.map((img) => (
                            <div key={img.id} className="flex items-center gap-3 p-3 rounded-xl border bg-gray-50">
                                <img src={img.url} alt={img.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold truncate">{img.name}</p>
                                    <input readOnly value={img.url} className="w-full text-[10px] text-muted-foreground bg-transparent outline-none truncate" />
                                </div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 flex-shrink-0"
                                    onClick={() => copyUrl(img.id, img.url)}
                                >
                                    {copiedId === img.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                </Button>
                                {deleteConfirmId === img.id ? (
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="text-xs flex-shrink-0"
                                        disabled={deleting}
                                        onClick={() => handleDelete(img)}
                                    >
                                        {deleting ? "…" : "Confirm"}
                                    </Button>
                                ) : (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-red-500 flex-shrink-0"
                                        onClick={() => setDeleteConfirmId(img.id)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-center text-sm text-muted-foreground py-6">
                        No images uploaded yet. Upload images above to get their Storage URLs.
                    </p>
                )}
            </div>

            <div className="flex justify-between">
                <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
                <Button onClick={onNext} className="gap-1.5">
                    Next <ChevronRight className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

// ─── Step 3: HTML Upload ─────────────────────────────────────────────────

function HTMLUploadStep({
    clubId,
    onBack,
    onFinish,
}: {
    clubId: string;
    onBack: () => void;
    onFinish: () => void;
}) {
    const { toast } = useToast();
    const [htmlContent, setHtmlContent] = useState("");
    const { uploadHTML, uploading } = useUploadLandingHTML(clubId);

    async function handlePublish() {
        if (!htmlContent.trim()) return;
        try {
            // Replace {{CLUB_ID}} placeholder with the real Firestore document ID
            // before uploading so enquiries are saved with the correct clubId.
            const finalHtml = htmlContent.replace(/\{\{CLUB_ID\}\}/g, clubId);
            await uploadHTML(finalHtml);
            toast({ title: "Landing page published successfully!" });
            onFinish();
        } catch {
            toast({ title: "Publish failed", variant: "destructive" });
        }
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-2xl border p-6 space-y-4">
                <div>
                    <h3 className="font-semibold">Landing Page HTML</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Paste your custom HTML for this club's landing page. Use the image URLs from the previous step.
                    </p>
                </div>

                <textarea
                    value={htmlContent}
                    onChange={(e) => setHtmlContent(e.target.value)}
                    placeholder="Paste your complete HTML here..."
                    className="w-full min-h-[400px] font-mono text-sm border rounded-xl p-4 resize-y focus:outline-none focus:ring-2 focus:ring-violet-500"
                />

                <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{htmlContent.length.toLocaleString()} characters</p>
                </div>

                <div className="bg-violet-50 text-violet-700 text-xs px-4 py-3 rounded-lg">
                    Use the image URLs from Step 2 wherever images are needed in your HTML.
                </div>

                <Button
                    disabled={!htmlContent.trim() || uploading}
                    onClick={handlePublish}
                    className="w-full gap-2"
                >
                    <Upload className="w-4 h-4" />
                    {uploading ? "Publishing…" : "Save & Publish Landing Page"}
                </Button>
            </div>

            <div className="flex justify-between">
                <Button variant="ghost" onClick={onBack} className="gap-1.5">
                    <ChevronLeft className="w-4 h-4" /> Back
                </Button>
                <Button variant="outline" onClick={onFinish} className="gap-1.5">
                    Finish <ChevronRight className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}
