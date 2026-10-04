"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CaptureFields, { type CaptureValues } from "@/components/CaptureFields";

/**
 * Same six fields as capture, reused verbatim — this is where a coach fills in the
 * age or weight they didn't have on the road, which is what unlocks the snapshot.
 */
export default function ProspectDetailsEditor({
  id,
  name,
  phone,
  age,
  gender,
  heightCm,
  weightKg,
}: {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CaptureValues>({
    name,
    phone,
    age: age?.toString() ?? "",
    gender: gender ?? "",
    heightCm: heightCm?.toString() ?? "",
    weightKg: weightKg?.toString() ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          phone: values.phone,
          age: values.age === "" ? null : Number(values.age),
          gender: values.gender === "" ? null : values.gender,
          heightCm: values.heightCm === "" ? null : Number(values.heightCm),
          weightKg: values.weightKg === "" ? null : Number(values.weightKg),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("No connection. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-12 self-start rounded-xl border border-hairline px-4 font-medium"
      >
        Edit details
      </button>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-2xl bg-surface p-5">
      <h2 className="font-semibold">Edit details</h2>
      <CaptureFields values={values} onChange={setValues} />
      {error && (
        <p className="rounded-xl bg-elevated px-4 py-3 text-sm text-heat">{error}</p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-14 neopop metal-gold text-lg font-semibold text-on-gold disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save details"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-12 rounded-xl border border-hairline font-medium"
      >
        Cancel
      </button>
    </form>
  );
}
