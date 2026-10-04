import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { useAllClubs } from "@/hooks/useSuperAdmin";

const clubSchema = z.object({
    name: z.string().min(2, "Club name is required"),
    currencyName: z.string().min(2, "Currency name is required"),
    domain: z.string().min(3, "Domain is required"),
    ownerName: z.string().min(2, "Owner name is required"),
    ownerPhone: z.string().regex(/^\+?\d{10,15}$/, "Valid phone number required"),
    ownerEmail: z.string().email("Valid email required").optional().or(z.literal("")),
    tagline: z.string().optional(),
    kitchenPin: z.string().regex(/^\d{4}$/, "Must be 4 digits"),
    parentClubId: z.string().optional(),
    primaryColor: z.string().default("#8B5CF6"),
    secondaryColor: z.string().default("#10B981"),
    tertiaryColor: z.string().default("#F59E0B"),
});

export type ClubFormValues = z.infer<typeof clubSchema>;

interface Props {
    defaultValues?: Partial<ClubFormValues>;
    onSubmit: (data: ClubFormValues) => void;
    isLoading: boolean;
    mode: "create" | "edit";
}

export default function ClubForm({ defaultValues, onSubmit, isLoading, mode }: Props) {
    const { data: allClubs } = useAllClubs();
    const {
        register,
        handleSubmit,
        setValue,
        watch,
        formState: { errors },
    } = useForm<ClubFormValues>({
        resolver: zodResolver(clubSchema),
        defaultValues: {
            name: "",
            currencyName: "",
            domain: "",
            ownerName: "",
            ownerPhone: "",
            ownerEmail: "",
            tagline: "",
            kitchenPin: "",
            parentClubId: "",
            primaryColor: "#8B5CF6",
            secondaryColor: "#10B981",
            tertiaryColor: "#F59E0B",
            ...defaultValues,
        },
    });

    const primaryColor = watch("primaryColor");
    const secondaryColor = watch("secondaryColor");
    const tertiaryColor = watch("tertiaryColor");

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Club Name *</Label>
                    <Input id="name" {...register("name")} placeholder="Magic Nutrition Club" />
                    {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="currencyName">Currency Name *</Label>
                    <Input id="currencyName" {...register("currencyName")} placeholder="e.g. MNC Coins" />
                    {errors.currencyName && <p className="text-xs text-red-500">{errors.currencyName.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="domain">Domain *</Label>
                    <Input id="domain" {...register("domain")} placeholder="e.g. mnc.com" />
                    {errors.domain && <p className="text-xs text-red-500">{errors.domain.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="kitchenPin">Kitchen PIN *</Label>
                    <Input id="kitchenPin" {...register("kitchenPin")} placeholder="1234" maxLength={4} inputMode="numeric" />
                    {errors.kitchenPin && <p className="text-xs text-red-500">{errors.kitchenPin.message}</p>}
                </div>
            </div>

            {/* Owner Info */}
            <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Owner Details</h3>
                <p className="text-xs text-muted-foreground">The person who will manage this club</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="ownerName">Owner Name *</Label>
                    <Input id="ownerName" {...register("ownerName")} placeholder="John Doe" />
                    {errors.ownerName && <p className="text-xs text-red-500">{errors.ownerName.message}</p>}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="ownerPhone">Owner Phone *</Label>
                    <Input id="ownerPhone" {...register("ownerPhone")} placeholder="+91 9999999999" />
                    {errors.ownerPhone && <p className="text-xs text-red-500">{errors.ownerPhone.message}</p>}
                </div>
                {mode === "create" && (
                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="ownerEmail">Owner Email *</Label>
                        <Input id="ownerEmail" {...register("ownerEmail")} placeholder="owner@example.com" type="email" />
                        {errors.ownerEmail && <p className="text-xs text-red-500">{errors.ownerEmail.message}</p>}
                    </div>
                )}
            </div>

            {/* Tagline */}
            <div className="space-y-2">
                <Label htmlFor="tagline">Tagline</Label>
                <Input id="tagline" {...register("tagline")} placeholder="Your Health, Our Mission" />
            </div>

            {/* Parent Club */}
            <div className="space-y-2">
                <Label>Parent Club (optional)</Label>
                <Select
                    value={watch("parentClubId") || "none"}
                    onValueChange={(v) => setValue("parentClubId", v === "none" ? "" : v)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="None (Top-level club)" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">None (Top-level club)</SelectItem>
                        {allClubs?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                                {c.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Colors */}
            <div className="space-y-1 pt-2">
                <h3 className="text-sm font-semibold text-foreground">Brand Colors</h3>
                <p className="text-xs text-muted-foreground">Choose colors used throughout this club's dashboard</p>
            </div>
            <div className="space-y-6 p-4 rounded-xl border bg-gray-50">
                <ColorPicker
                    label="Primary Color"
                    value={primaryColor}
                    onChange={(c) => setValue("primaryColor", c)}
                />
                <div className="h-px bg-border" />
                <ColorPicker
                    label="Secondary Color"
                    value={secondaryColor}
                    onChange={(c) => setValue("secondaryColor", c)}
                />
                <div className="h-px bg-border" />
                <ColorPicker
                    label="Tertiary Color"
                    value={tertiaryColor}
                    onChange={(c) => setValue("tertiaryColor", c)}
                />
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-4 border-t">
                <Button type="submit" disabled={isLoading} className="px-8">
                    {isLoading
                        ? mode === "create"
                            ? "Creating…"
                            : "Saving…"
                        : mode === "create"
                            ? "Create Club"
                            : "Save Changes"}
                </Button>
            </div>
        </form>
    );
}
