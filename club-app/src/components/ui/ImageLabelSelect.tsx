import { useState } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LandingImage } from "@/types/firestore";

const PRESET_LABELS = [
    "Hero Image",
    "Owner Photo",
    "Gallery",
    "Logo",
    "Background",
    "Banner",
    "Testimonial",
    "Before & After",
    "Team Photo",
    "Product Photo",
    "Other (custom)",
];

/**
 * Given a base label and existing images, returns the auto-numbered label.
 * First occurrence → "Hero Image", second → "Hero Image 2", etc.
 */
export function resolveLabel(base: string, existingImages: LandingImage[]): string {
    const count = existingImages.filter((img) => {
        const imgBase = img.name.replace(/ \d+$/, "").trim();
        return imgBase.toLowerCase() === base.toLowerCase();
    }).length;
    return count === 0 ? base : `${base} ${count + 1}`;
}

interface Props {
    existingImages: LandingImage[];
    value: string;
    onChange: (resolvedLabel: string) => void;
}

export function ImageLabelSelect({ existingImages, value, onChange }: Props) {
    const [selectedOption, setSelectedOption] = useState<string>("");
    const [customInput, setCustomInput] = useState("");

    function handleOptionChange(option: string) {
        setSelectedOption(option);
        if (option !== "Other (custom)") {
            const resolved = resolveLabel(option, existingImages);
            onChange(resolved);
        } else {
            onChange(customInput.trim() ? resolveLabel(customInput.trim(), existingImages) : "");
        }
    }

    function handleCustomChange(raw: string) {
        setCustomInput(raw);
        const base = raw.trim();
        if (base) {
            onChange(resolveLabel(base, existingImages));
        } else {
            onChange("");
        }
    }

    const isCustom = selectedOption === "Other (custom)";

    return (
        <div className="space-y-2">
            <Label className="text-xs">Image Label</Label>
            <Select value={selectedOption} onValueChange={handleOptionChange}>
                <SelectTrigger>
                    <SelectValue placeholder="Select a label…" />
                </SelectTrigger>
                <SelectContent>
                    {PRESET_LABELS.map((l) => (
                        <SelectItem key={l} value={l}>
                            {l}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {isCustom && (
                <Input
                    value={customInput}
                    onChange={(e) => handleCustomChange(e.target.value)}
                    placeholder="Enter custom label…"
                    className="mt-1"
                />
            )}

            {value && (
                <p className="text-[11px] text-muted-foreground">
                    Will be saved as: <span className="font-semibold text-foreground">"{value}"</span>
                </p>
            )}
        </div>
    );
}
