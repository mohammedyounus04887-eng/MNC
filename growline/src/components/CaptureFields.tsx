"use client";

import { GENDERS } from "@/lib/prospect";

/**
 * The six capture fields, shared by the coach form (Mode A) and the public QR
 * form (Mode B). Exactly six — the hard limit in Section 5.6, which is why
 * notes live on the prospect detail screen instead.
 */

export type CaptureValues = {
  name: string;
  phone: string;
  age: string;
  gender: string;
  heightCm: string;
  weightKg: string;
};

export const emptyCapture: CaptureValues = {
  name: "",
  phone: "",
  age: "",
  gender: "",
  heightCm: "",
  weightKg: "",
};

const GENDER_LABELS: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
};

const inputCls =
  "h-14 w-full rounded-xl border border-hairline bg-elevated px-4 text-lg outline-none focus:border-gold focus:ring-2 focus:ring-gold/30";

export default function CaptureFields({
  values,
  onChange,
  selfMode = false,
}: {
  values: CaptureValues;
  onChange: (next: CaptureValues) => void;
  /** true on the public form, where the prospect is describing themselves */
  selfMode?: boolean;
}) {
  const set = (key: keyof CaptureValues, v: string) =>
    onChange({ ...values, [key]: v });
  const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">{selfMode ? "Your name" : "Name"}</span>
        <input
          className={inputCls}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={selfMode ? "Your full name" : "Who did you meet?"}
          autoComplete={selfMode ? "name" : "off"}
          enterKeyHint="next"
          maxLength={60}
          autoFocus
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-medium">Mobile number</span>
        <div className="flex items-center gap-2">
          <span className="flex h-14 items-center rounded-xl bg-surface px-4 text-lg font-semibold">
            +91
          </span>
          <input
            className={`${inputCls} tracking-wider`}
            value={values.phone}
            onChange={(e) => set("phone", digits(e.target.value, 10))}
            inputMode="numeric"
            autoComplete={selfMode ? "tel-national" : "off"}
            enterKeyHint="next"
            placeholder="98765 43210"
            required
          />
        </div>
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Age</span>
          <input
            className={`${inputCls} px-3 text-center`}
            value={values.age}
            onChange={(e) => set("age", digits(e.target.value, 3))}
            inputMode="numeric"
            enterKeyHint="next"
            placeholder="32"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Height</span>
          <div className="relative">
            <input
              className={`${inputCls} px-3 pr-10 text-center`}
              value={values.heightCm}
              onChange={(e) => set("heightCm", digits(e.target.value, 3))}
              inputMode="numeric"
              enterKeyHint="next"
              placeholder="165"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">
              cm
            </span>
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Weight</span>
          <div className="relative">
            <input
              className={`${inputCls} px-3 pr-10 text-center`}
              value={values.weightKg}
              onChange={(e) => set("weightKg", e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="70"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">
              kg
            </span>
          </div>
        </label>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="font-medium">Gender</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {GENDERS.map((g) => {
            const active = values.gender === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={active}
                onClick={() => set("gender", active ? "" : g)}
                className={`h-12 rounded-xl border text-base font-medium ${
                  active
                    ? "border-gold bg-elevated text-gold-ink"
                    : "border-hairline text-text-dim"
                }`}
              >
                {GENDER_LABELS[g]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
