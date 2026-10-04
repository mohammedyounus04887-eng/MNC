"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="h-14 rounded-xl border border-hairline text-lg font-semibold print:hidden"
    >
      Print this poster
    </button>
  );
}
