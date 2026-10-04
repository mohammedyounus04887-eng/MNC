import type { WellnessMetrics } from "./wellness";
import { CARD_FONT_FAMILY } from "./report-fonts";
import { HEALTHY_BMI_MAX, HEALTHY_BMI_MIN } from "./wellness";
import {
  COACH_ROLE,
  DISCLAIMER,
  NOT_A_DOCTOR,
  REPORT_TITLE,
  SHORT_NOTES,
} from "./report-copy";

/**
 * The shareable card, rendered to PNG by satori (via next/og).
 *
 * satori supports a subset of CSS: flexbox only (no grid), and every container
 * needs an explicit `display: flex`. Margins are used instead of `gap` so the
 * layout does not depend on a newer satori than the one Next ships.
 *
 * Fonts come from `report-fonts.ts` — Noto Sans plus the Indic faces, read off
 * disk. Until D66 the only face available was satori's bundled Geist Regular, so
 * `fontWeight: 700` was a silent no-op and hierarchy had to come from size and
 * colour alone (D18). Real weights exist now; `WEIGHT_BOLD` marks the places the
 * design always meant to be bold.
 *
 * The disclaimer is drawn INTO the pixels on purpose: this PNG is the artefact
 * that gets forwarded and screenshotted, and anything not in the image is gone the
 * moment it leaves the page.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1620;
/**
 * Vertical space reserved at the bottom of the canvas for the footer, which
 * carries both mandatory disclaimer lines.
 *
 * The footer is positioned absolutely against the bottom edge rather than being
 * pushed there by flex flow. satori crops overflow silently instead of erroring,
 * and the body's height varies with the prospect's data (four metric tiles or two,
 * a next-step line that wraps to two lines or three). Under flex flow that
 * variation pushed the disclaimer off the bottom of the image — a compliance
 * failure that looks like a cosmetic one. Pinned, it cannot be pushed anywhere.
 */
const FOOTER_RESERVE = 320;

/**
 * Long names are truncated before they reach the canvas. satori has no reliable
 * single-line ellipsis here, and an unclamped name wraps, grows the footer past its
 * reserve, and prints the body on top of the coach's own photo.
 */
const MAX_COACH_NAME = 30;
const MAX_COACH_CITY = 22;
/** Same reasoning for the prospect's first name, which sits on its own line. */
const MAX_FIRST_NAME = 24;
const clamp = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

const NAVY = "#14213D";
const GOLD = "#FCA311";
const SURFACE = "#F5F6FA";
const WHITE = "#FFFFFF";

/**
 * Bold is reserved for the numbers and the two names — v1 §9 ("numbers are the
 * emotional content of this app") and v2 §5.5 ("non-Latin names must render bold
 * and correct on every card"). Everything else stays regular, or the weight stops
 * meaning anything.
 */
const WEIGHT_BOLD = 700;

type CoachBrand = {
  name: string;
  photoUrl: string | null;
  city: string | null;
  phone: string;
};

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 456,
        backgroundColor: SURFACE,
        borderRadius: 24,
        padding: 24,
      }}
    >
      <div style={{ display: "flex", fontSize: 26, color: "#4A5675" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", marginTop: 8 }}>
        <div
          style={{ display: "flex", fontSize: 56, fontWeight: WEIGHT_BOLD, color: NAVY }}
        >
          {value}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#4A5675",
            marginLeft: 8,
            marginBottom: 10,
          }}
        >
          {unit}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 21, color: "#4A5675", marginTop: 10 }}>
        {note}
      </div>
    </div>
  );
}

function CoachBlock({ coach }: { coach: CoachBrand }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {coach.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori renders this, not the browser
        <img
          src={coach.photoUrl}
          alt=""
          width={96}
          height={96}
          style={{ width: 96, height: 96, borderRadius: 48, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: NAVY,
            color: WHITE,
            fontSize: 42,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {(coach.name.trim()[0] ?? "?").toUpperCase()}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 24 }}>
        <div
          style={{ display: "flex", fontSize: 38, fontWeight: WEIGHT_BOLD, color: NAVY }}
        >
          {clamp(coach.name, MAX_COACH_NAME)}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#4A5675", marginTop: 4 }}>
          {COACH_ROLE}
          {coach.city ? ` · ${clamp(coach.city, MAX_COACH_CITY)}` : ""}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#4A5675", marginTop: 2 }}>
          {coach.phone.replace(/^\+91/, "+91 ")}
        </div>
      </div>
    </div>
  );
}

/** The full card: metrics, branding, and both disclaimer lines burnt in. */
export function ReportCard({
  firstName,
  metrics,
  coach,
  nextStep,
}: {
  firstName: string;
  metrics: WellnessMetrics;
  coach: CoachBrand;
  nextStep: string;
}) {
  const tiles: { label: string; value: string; unit: string; note: string }[] = [];
  if (metrics.bodyFatPct) {
    tiles.push({
      label: "Estimated body fat",
      value: `${metrics.bodyFatPct.low}–${metrics.bodyFatPct.high}`,
      unit: "%",
      note: SHORT_NOTES.bodyFat,
    });
  }
  if (metrics.bmrKcal) {
    tiles.push({
      label: "Energy used at rest",
      value: metrics.bmrKcal.toLocaleString("en-IN"),
      unit: "a day",
      note: SHORT_NOTES.bmr,
    });
  }
  if (metrics.healthyWeightKg) {
    tiles.push({
      label: "General range for this height",
      value: `${metrics.healthyWeightKg.min}–${metrics.healthyWeightKg.max}`,
      unit: "kg",
      note: SHORT_NOTES.weightRange,
    });
  }
  if (metrics.waterLitres) {
    const { low, high } = metrics.waterLitres;
    tiles.push({
      label: "Daily fluid guideline",
      value: low === high ? low.toFixed(1) : `${low}–${high}`,
      unit: "litres",
      note: SHORT_NOTES.water,
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: WHITE,
        // Named once, at the root. The Indic faces are registered under their own
        // family names and reached by satori's fallback, so the card never has to
        // know which script the prospect's name is in — see report-fonts.ts.
        fontFamily: CARD_FONT_FAMILY,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: NAVY,
          paddingTop: 44,
          paddingBottom: 44,
          paddingLeft: 56,
          paddingRight: 56,
        }}
      >
        <div
          style={{ display: "flex", fontSize: 30, fontWeight: WEIGHT_BOLD, color: GOLD }}
        >
          Growline
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 58,
            fontWeight: WEIGHT_BOLD,
            color: WHITE,
            marginTop: 6,
          }}
        >
          {REPORT_TITLE}
        </div>
        {/* "For" and the name are separate nodes so the name can carry the weight
            without the preposition doing so. */}
        <div
          style={{ display: "flex", fontSize: 30, color: "#B9C0D4", marginTop: 6 }}
        >
          <div style={{ display: "flex" }}>For&nbsp;</div>
          <div style={{ display: "flex", fontWeight: WEIGHT_BOLD, color: WHITE }}>
            {clamp(firstName, MAX_FIRST_NAME)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          paddingTop: 34,
          paddingBottom: 28,
          paddingLeft: 56,
          paddingRight: 56,
          // Keeps the body clear of the pinned footer. overflow:hidden is what
          // makes maxHeight actually bind — without it the box just grows.
          maxHeight: CARD_HEIGHT - 250 - FOOTER_RESERVE,
          overflow: "hidden",
        }}
      >
        {metrics.bmi && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 28, color: "#4A5675" }}>BMI</div>
            <div style={{ display: "flex", alignItems: "flex-end", marginTop: 2 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 132,
                  fontWeight: WEIGHT_BOLD,
                  color: NAVY,
                }}
              >
                {metrics.bmi.value.toFixed(1)}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 34,
                  color: NAVY,
                  marginLeft: 22,
                  marginBottom: 26,
                }}
              >
                {metrics.bmi.band.label}
              </div>
            </div>
            {/* Position on a neutral scale — no colour coding, no arrows. A dot
                showing where the number sits is honest and gives a sales pitch
                nothing to grip. */}
            <BmiScale bmi={metrics.bmi.value} />
            <div style={{ display: "flex", fontSize: 22, color: "#4A5675", marginTop: 14 }}>
              {SHORT_NOTES.bmi}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            marginTop: 26,
            width: 968,
          }}
        >
          {tiles.map((t, i) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                marginRight: i % 2 === 0 ? 56 : 0,
                marginBottom: 24,
              }}
            >
              <Tile {...t} />
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            backgroundColor: "#FEF3DD",
            borderRadius: 24,
            padding: 28,
            fontSize: 28,
            color: NAVY,
          }}
        >
          {nextStep}
        </div>
      </div>

      {/* Footer: coach identity kept physically apart from the numbers, and
          pinned to the bottom edge so the disclaimers can never be cropped. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 0,
          bottom: 0,
          width: CARD_WIDTH,
          // Opaque, so if anything above ever does overlap it cannot show through
          // and obscure the disclaimer lines.
          backgroundColor: WHITE,
          borderTop: `2px solid ${SURFACE}`,
          paddingTop: 28,
          paddingBottom: 32,
          paddingLeft: 56,
          paddingRight: 56,
        }}
      >
        <CoachBlock coach={coach} />
        <div style={{ display: "flex", fontSize: 22, color: NAVY, marginTop: 20 }}>
          {DISCLAIMER}
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#4A5675", marginTop: 6 }}>
          {NOT_A_DOCTOR}
        </div>
      </div>
    </div>
  );
}

function BmiScale({ bmi }: { bmi: number }) {
  const MIN = 15;
  const MAX = 35;
  const TRACK = 968;
  const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));
  const x = ((clamp(bmi) - MIN) / (MAX - MIN)) * TRACK;
  const bandLeft = ((HEALTHY_BMI_MIN - MIN) / (MAX - MIN)) * TRACK;
  const bandWidth = ((HEALTHY_BMI_MAX - HEALTHY_BMI_MIN) / (MAX - MIN)) * TRACK;

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          position: "relative",
          width: TRACK,
          height: 16,
          borderRadius: 8,
          backgroundColor: "#E8EBF3",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: bandLeft,
            top: 0,
            width: bandWidth,
            height: 16,
            borderRadius: 8,
            backgroundColor: "#C7CDE0",
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: x - 14,
            top: -6,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: GOLD,
          }}
        />
      </div>
      {/* Positioned by value, matching the band and dot above. Evenly spaced
          labels would sit under the wrong points on the scale. */}
      <div
        style={{
          display: "flex",
          position: "relative",
          width: TRACK,
          height: 28,
          marginTop: 8,
          fontSize: 20,
          color: "#4A5675",
        }}
      >
        {[MIN, HEALTHY_BMI_MIN, HEALTHY_BMI_MAX, MAX].map((v) => {
          const at = ((v - MIN) / (MAX - MIN)) * TRACK;
          // satori has no transform-on-text centring here, so offset by an
          // approximate half-width of the label instead.
          const halfWidth = String(v).length * 5.5;
          return (
            <div
              key={v}
              style={{
                display: "flex",
                position: "absolute",
                left: Math.min(TRACK - halfWidth * 2, Math.max(0, at - halfWidth)),
                top: 0,
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The link-preview image. Neutral branding only — NO metrics. A forwarded snapshot
 * link renders its preview inside whatever group chat it lands in, so the numbers
 * must never be in it.
 */
export function ReportPreview({ coachName }: { coachName: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        backgroundColor: NAVY,
        paddingLeft: 80,
        paddingRight: 80,
        fontFamily: CARD_FONT_FAMILY,
      }}
    >
      <div
        style={{ display: "flex", fontSize: 34, fontWeight: WEIGHT_BOLD, color: GOLD }}
      >
        Growline
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 76,
          fontWeight: WEIGHT_BOLD,
          color: WHITE,
          marginTop: 14,
        }}
      >
        {REPORT_TITLE}
      </div>
      <div style={{ display: "flex", fontSize: 34, color: "#B9C0D4", marginTop: 14 }}>
        <div style={{ display: "flex" }}>From&nbsp;</div>
        <div style={{ display: "flex", fontWeight: WEIGHT_BOLD, color: WHITE }}>
          {clamp(coachName, MAX_COACH_NAME)}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#B9C0D4", marginTop: 40 }}>
        {DISCLAIMER}
      </div>
    </div>
  );
}
