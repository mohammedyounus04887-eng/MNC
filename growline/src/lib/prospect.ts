import { normalizeIndianPhone } from "./phone";

export const GENDERS = ["female", "male", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const STAGES = ["spoken", "interested", "invited", "attended", "member"] as const;

/** Plausible human ranges — a typo like 1750cm should never reach the database. */
const LIMITS = {
  age: { min: 1, max: 120 },
  heightCm: { min: 60, max: 250 },
  weightKg: { min: 10, max: 400 },
};

export type ProspectInput = {
  name: string;
  phone: string;
  age: number | null;
  gender: Gender | null;
  heightCm: number | null;
  weightKg: number | null;
};

type ParseResult =
  | { ok: true; value: ProspectInput }
  | { ok: false; error: string };

function optionalNumber(
  raw: unknown,
  label: string,
  limits: { min: number; max: number }
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: `Enter a valid ${label}.` };
  if (n < limits.min || n > limits.max) {
    return { ok: false, error: `${label} should be between ${limits.min} and ${limits.max}.` };
  }
  return { ok: true, value: Math.round(n * 10) / 10 };
}

/**
 * Validates a capture payload from either mode (coach form or public QR form).
 * Only name and phone are required: the 30-second rule means a coach standing on
 * a road may not know an age yet. The Phase 3 report simply asks for whatever is
 * missing before it can be generated.
 */
export function parseProspectInput(body: unknown): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = String(b.name ?? "").trim();
  if (name.length < 2 || name.length > 60) {
    return { ok: false, error: "Please enter their name." };
  }

  const phone = normalizeIndianPhone(String(b.phone ?? ""));
  if (!phone) {
    return { ok: false, error: "Enter a valid 10-digit mobile number." };
  }

  const age = optionalNumber(b.age, "age", LIMITS.age);
  if (!age.ok) return age;
  const heightCm = optionalNumber(b.heightCm, "height", LIMITS.heightCm);
  if (!heightCm.ok) return heightCm;
  const weightKg = optionalNumber(b.weightKg, "weight", LIMITS.weightKg);
  if (!weightKg.ok) return weightKg;

  const rawGender = b.gender === undefined || b.gender === null ? "" : String(b.gender);
  if (rawGender && !GENDERS.includes(rawGender as Gender)) {
    return { ok: false, error: "Please choose an option for gender." };
  }

  return {
    ok: true,
    value: {
      name,
      phone,
      // Floor, not round: age means completed years, and rounding would turn a
      // 17.5-year-old into an 18-year-old and past the under-18 report gate.
      age: age.value === null ? null : Math.floor(age.value),
      gender: (rawGender || null) as Gender | null,
      heightCm: heightCm.value,
      weightKg: weightKg.value,
    },
  };
}

/** "+919876543210" -> "9876543210". DISPLAY ONLY — not valid for a wa.me link. */
export function prospectPhoneDigits(phone: string): string {
  return phone.replace(/^\+91/, "");
}

/**
 * "+919876543210" -> "919876543210" for wa.me links.
 *
 * wa.me needs the full international number with no "+". Handing it the local
 * 10 digits makes WhatsApp reject it as an invalid number, which silently breaks
 * every send — so this is deliberately a separate function from the display one.
 */
export function whatsappNumber(phone: string): string {
  return phone.replace(/\D/g, "");
}
