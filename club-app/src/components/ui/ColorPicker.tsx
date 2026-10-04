import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";

const PRESET_COLORS = [
    "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
    "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#3B82F6",
    "#6366F1", "#8B5CF6", "#A855F7", "#EC4899", "#F43F5E",
    "#000000", "#374151", "#6B7280", "#9CA3AF", "#FFFFFF",
];

function isValidHex(value: string) {
    return /^#[0-9A-Fa-f]{6}$/.test(value);
}

interface ColorPickerProps {
    label: string;
    value: string;
    onChange: (color: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
    const [hexInput, setHexInput] = useState(value.replace("#", ""));

    useEffect(() => {
        setHexInput(value.replace("#", ""));
    }, [value]);

    function handleSwatchClick(color: string) {
        onChange(color);
        setHexInput(color.replace("#", ""));
    }

    function handleHexChange(raw: string) {
        setHexInput(raw);
        const full = "#" + raw;
        if (isValidHex(full)) {
            onChange(full);
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <div
                    className="w-5 h-5 rounded-full border border-border flex-shrink-0"
                    style={{ backgroundColor: isValidHex("#" + hexInput) ? "#" + hexInput : value }}
                />
                <Label className="text-sm font-semibold">{label}</Label>
            </div>

            {/* Presets: 4 rows × 5 */}
            <div className="grid grid-cols-10 gap-1.5">
                {PRESET_COLORS.map((color) => {
                    const isSelected = value.toLowerCase() === color.toLowerCase();
                    return (
                        <button
                            key={color}
                            type="button"
                            title={color}
                            onClick={() => handleSwatchClick(color)}
                            className="relative flex-shrink-0 rounded-full transition-transform hover:scale-110 focus:outline-none"
                            style={{ width: 28, height: 28 }}
                        >
                            <span
                                className="block w-full h-full rounded-full border border-black/10"
                                style={{ backgroundColor: color }}
                            />
                            {isSelected && (
                                <span className="absolute inset-0 rounded-full ring-2 ring-offset-2 ring-violet-500 pointer-events-none" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Hex input */}
            <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">#</span>
                <input
                    type="text"
                    maxLength={6}
                    value={hexInput}
                    onChange={(e) => handleHexChange(e.target.value.toUpperCase())}
                    placeholder="8B5CF6"
                    className="w-28 font-mono text-sm border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                />
                <div
                    className="w-8 h-8 rounded-lg border border-border flex-shrink-0"
                    style={{ backgroundColor: isValidHex("#" + hexInput) ? "#" + hexInput : value }}
                />
            </div>
        </div>
    );
}
