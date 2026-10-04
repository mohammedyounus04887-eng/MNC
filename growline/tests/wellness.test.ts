import { test } from "node:test";
import assert from "node:assert/strict";

import * as wellnessModule from "@/lib/wellness";
import * as reportCopy from "@/lib/report-copy";
import {
  computeWellness,
  reportEligibility,
  HEALTHY_BMI_MIN,
  HEALTHY_BMI_MAX,
  MIN_REPORT_AGE,
  type Gender,
  type WellnessInput,
} from "@/lib/wellness";

/**
 * Unit tests for the wellness estimate engine and the report copy that surrounds it.
 *
 * ## What these tests are for
 *
 * Most of `src/lib/wellness.ts` is not a feature — it is a legal control surface.
 * CLAUDE.md Section 5.2 enumerates the six calculations this app may perform and
 * bans everything else; RULES.md L3 bans four specific English words from ever
 * describing a person; L6 bans reports for minors outright. Those are the lines
 * that carry consequences, so they are the lines with the most assertions below.
 *
 * ## How the expected values were arrived at, and why that matters
 *
 * Every number asserted here was computed from the published formula or from the
 * spec, by hand or by an independent reference implementation in this file — never
 * by running `computeWellness` and writing down what came back. A test built that
 * way is worse than no test: it passes forever, including for every bug already
 * present, and it converts a defect into a documented requirement. The reference
 * implementations below are therefore written in a DIFFERENT algebraic form from
 * the ones under test (textbook kg/m² against the module's kg·10000/cm², for
 * instance) so that agreement is evidence of correctness rather than evidence that
 * the same expression was typed twice.
 *
 * Two consequences of that discipline, both deliberate:
 *
 *  - One property below is marked `{ todo }`. It is a REAL failing assertion of a
 *    real inconsistency (the top of the healthy weight range does not band as
 *    healthy — see the test for the arithmetic). `todo` makes node:test run it and
 *    print the full diff on every CI run while keeping the suite's exit code at 0,
 *    so a known, reported, unfixed defect stays visible instead of being either
 *    silently deleted or blessed by an assertion that expects the wrong answer.
 *  - Where a constant is an implementation choice with no spec behind it (the
 *    granularity BMR is rounded to, the exact numeric plausibility cut-offs) the
 *    test asserts the PROPERTY the choice exists to deliver, not the constant.
 *
 * ## Why node:test and no new packages
 *
 * See tests/harness.test.ts. Nothing here needs jsdom or module mocking; both
 * modules under test are pure functions of their arguments.
 */

/* ------------------------------------------------------------------ *
 * Reference implementations — typed from the source publications.
 * ------------------------------------------------------------------ */

/**
 * BMI in the textbook form: kilograms over metres squared. The module computes
 * `kg * 10000 / cm²` instead, which is the same quantity by algebra and a
 * different sequence of floating-point operations. Comparing the two is a real
 * check; comparing a formula against itself would not be.
 */
const bmiRef = (weightKg: number, heightCm: number) =>
  weightKg / (heightCm / 100) ** 2;

/**
 * Deurenberg, Weststrate & Seidell (1991), the equation CLAUDE.md Section 5.2
 * names: BF% = 1.20·BMI + 0.23·age − 10.8·sex − 5.4, with sex = 1 for male and
 * 0 for female. It takes the true BMI, not a display-rounded one.
 */
const bodyFatRef = (bmi: number, age: number, male: boolean) =>
  1.2 * bmi + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4;

/**
 * Mifflin-St Jeor (1990): BMR = 10·kg + 6.25·cm − 5·age + 5 (male) / − 161
 * (female).
 *
 * NOTE ON PROVENANCE: Section 5.2 permits "BMR" without naming an equation, and
 * DECISIONS.md D14 discusses BMR without naming one either. The only place the
 * choice is recorded is a comment in wellness.ts. These tests therefore validate
 * the implementation against the published Mifflin-St Jeor coefficients — i.e.
 * "the equation you say you are using, you are using correctly" — rather than
 * against a spec requirement, because there is no spec requirement to check.
 * Harris-Benedict or Katch-McArdle would also satisfy Section 5.2.
 */
const bmrRef = (weightKg: number, heightCm: number, age: number, male: boolean) =>
  10 * weightKg + 6.25 * heightCm - 5 * age + (male ? 5 : -161);

/** Display rounding to one decimal, as a card shows it. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * WHO Asia-Pacific adult cut-offs, from DECISIONS.md D12: 18.5 / 23 / 25, with
 * the healthy band running 18.5–22.9 (i.e. closed below, OPEN at 23), overweight
 * 23–24.9 and the third cut-off at 25. Written out here independently of the
 * module's constants so that a silent drift to the WHO international set
 * (18.5/25/30) fails a test instead of quietly reclassifying every user.
 */
const bandKeyForDisplayedBmi = (displayed: number) => {
  if (displayed < 18.5) return "below";
  if (displayed < 23) return "in";
  if (displayed < 25) return "just_above";
  return "above";
};

/**
 * The four permitted phrasings, quoted from RULES.md L3 / DECISIONS.md D13.
 * Any other string in a band label is a compliance failure, not a copy tweak.
 */
const PERMITTED_LABELS: Record<string, string> = {
  below: "Below the general range",
  in: "In the general range",
  just_above: "Just above the general range",
  above: "Above the general range",
};

/**
 * Words that may never describe a person (RULES.md L3). "obesity" in particular
 * is a scheduled condition under the Drugs and Magic Remedies (Objectionable
 * Advertisements) Act 1954, and F3 calls the report a marketing asset — so
 * printing it is an advertising offence, not a wording preference.
 */
const FORBIDDEN_CATEGORY_WORDS =
  /\b(obese|obesity|overweight|underweight|normal|abnormal|morbid|malnourished|healthy weight for you)\b/i;

/**
 * Quantities Section 5.2 forbids outright. Applied to key NAMES as well as
 * strings: a field called `cholesterolEstimate` is the failure mode to catch, and
 * it would never appear in prose first.
 */
const FORBIDDEN_QUANTITIES =
  /cholesterol|blood.?pressure|\bbp\b|systolic|diastolic|muscle.?mass|lean.?mass|blood.?sugar|glucose|diabet|hypertens|thyroid|cancer|disease|\brisk\b|metabolic.?syndrome|visceral|bone.?density|hydration.?level/i;

/** RULES.md L4: no income promise anywhere, including on a prospect's card. */
const INCOME_WORDS =
  /₹|\brupee|\bincome\b|\bearn(ing|ings)?\b|\bsalary\b|\blakh\b|\bcrore\b|\bprofit\b|\bcommission\b/i;

const input = (over: Partial<WellnessInput>): WellnessInput => ({
  age: null,
  gender: null,
  heightCm: null,
  weightKg: null,
  ...over,
});

/** Walks a value of unknown shape and harvests every string inside it. */
const collectStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
};

/**
 * A realistic sweep of adults: heights 140–200cm, BMI 16–40, ages 18–75, both
 * sexes for which the equations have a term. BMI 16 and BMI 40 are at the outer
 * edges of what walks into an Indian wellness club, so nothing in here may be
 * refused by a plausibility guard.
 */
function* realisticAdults() {
  for (let heightCm = 140; heightCm <= 200; heightCm += 10) {
    for (let bmi = 16; bmi <= 40; bmi += 2) {
      const weightKg = bmi * (heightCm / 100) ** 2;
      for (const age of [18, 25, 40, 60, 75]) {
        for (const gender of ["female", "male"] as const) {
          yield { age, gender, heightCm, weightKg } satisfies WellnessInput;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * L2 — the permitted-calculation surface, and nothing beyond it.
 * ------------------------------------------------------------------ */

test("L2: the metrics object exposes exactly the six permitted calculations", () => {
  const metrics = computeWellness(
    input({ age: 30, gender: "female", heightCm: 165, weightKg: 60 })
  );

  /**
   * Pinned as an exact set on purpose. Section 5.2 is a closed list, so the
   * correct response to a seventh metric appearing is a failing test and a legal
   * conversation — not a test that shrugs because it only checked the six it knew
   * about. `missing` is bookkeeping, not a health estimate.
   */
  assert.deepEqual(Object.keys(metrics).sort(), [
    "bmi",
    "bmrKcal",
    "bodyFatPct",
    "healthyWeightKg",
    "missing",
    "waterLitres",
  ]);
});

test("L2: no key or string anywhere in the module names a forbidden quantity", () => {
  const surfaces: unknown[] = [
    Object.keys(wellnessModule),
    computeWellness(input({ age: 30, gender: "female", heightCm: 165, weightKg: 60 })),
    computeWellness(input({ age: 45, gender: "male", heightCm: 178, weightKg: 82 })),
    computeWellness(input({})),
    Object.keys(
      computeWellness(input({ age: 30, gender: "male", heightCm: 170, weightKg: 70 }))
    ),
    reportEligibility(input({ age: 17, gender: "male", heightCm: 170, weightKg: 60 })),
    reportEligibility(input({})),
  ];

  for (const surface of surfaces) {
    for (const s of collectStrings(surface)) {
      assert.ok(
        !FORBIDDEN_QUANTITIES.test(s),
        `Section 5.2 forbids this quantity, and it appeared as: ${JSON.stringify(s)}`
      );
    }
  }
});

test("L2/D14: no maintenance-calorie or activity-multiplied figure is produced", () => {
  /**
   * D14: Section 5.2 permits calorie guidance but capture collects no activity
   * level, so any maintenance figure would apply an invented multiplier — and a
   * fabricated low calorie target, sent by someone who sells meal replacements,
   * is a mechanism of harm. BMR is published instead. If a TDEE field is ever
   * added it needs its own activity step, a stated assumption and a floor at BMR;
   * this test is the tripwire that forces that conversation.
   */
  const metrics = computeWellness(
    input({ age: 30, gender: "male", heightCm: 175, weightKg: 75 })
  );
  for (const key of Object.keys(metrics)) {
    assert.ok(
      !/calorie|tdee|maintenance|deficit|surplus|intake/i.test(key),
      `unexpected calorie-derived field: ${key}`
    );
  }
});

/* ------------------------------------------------------------------ *
 * BMI — the number every other estimate hangs off.
 * ------------------------------------------------------------------ */

test("BMI matches the formula, hand-computed, for two ordinary adults", () => {
  /**
   * 60 kg at 165 cm: 60 / 1.65² = 60 / 2.7225 = 22.0385674… → 22.0 on the card.
   * 82 kg at 178 cm: 82 / 1.78² = 82 / 3.1684 = 25.8805706… → 25.9 on the card.
   * Both worked out by hand from kg/m² before either was run through the module.
   */
  const a = computeWellness(
    input({ age: 30, gender: "female", heightCm: 165, weightKg: 60 })
  );
  assert.equal(a.bmi?.value, 22.0);

  const b = computeWellness(
    input({ age: 45, gender: "male", heightCm: 178, weightKg: 82 })
  );
  assert.equal(b.bmi?.value, 25.9);
});

test("BMI agrees with kg/m² across the whole realistic sweep", () => {
  for (const person of realisticAdults()) {
    const { bmi } = computeWellness(input(person));
    assert.ok(bmi, `no BMI for ${JSON.stringify(person)}`);
    const exact = bmiRef(person.weightKg, person.heightCm);

    /**
     * Tolerance 0.05 + 1e-9: the module publishes the BMI rounded to one
     * decimal, so the displayed figure may legitimately differ from the true
     * value by up to half a tenth. The 1e-9 slack on top absorbs the last-bit
     * disagreement between `kg/(cm/100)²` and `kg*10000/cm²`, which are equal in
     * real arithmetic but not in IEEE-754 — asserting exact equality here would
     * produce a test that fails on some inputs for no defect at all.
     */
    assert.ok(
      Math.abs(bmi.value - exact) <= 0.05 + 1e-9,
      `BMI ${bmi.value} is not ${exact} rounded to 1dp (${JSON.stringify(person)})`
    );
  }
});

test("BMI rises with weight and falls with height", () => {
  /**
   * Monotonicity is the property that catches a swapped numerator and
   * denominator, or centimetres used where metres were meant — the class of bug
   * that a single hand-checked value can slip past if it happens to be near the
   * fixed point of the error.
   */
  let previous = 0;
  for (let weightKg = 40; weightKg <= 120; weightKg += 5) {
    const { bmi } = computeWellness(
      input({ age: 30, gender: "male", heightCm: 170, weightKg })
    );
    assert.ok(bmi && bmi.value > previous, `BMI did not rise at ${weightKg}kg`);
    previous = bmi.value;
  }

  previous = Infinity;
  for (let heightCm = 150; heightCm <= 200; heightCm += 5) {
    const { bmi } = computeWellness(
      input({ age: 30, gender: "male", heightCm, weightKg: 70 })
    );
    assert.ok(bmi && bmi.value < previous, `BMI did not fall at ${heightCm}cm`);
    previous = bmi.value;
  }
});

/* ------------------------------------------------------------------ *
 * L3 — the band labels. The highest-stakes assertions in the file.
 * ------------------------------------------------------------------ */

test("L3: no forbidden category word appears at ANY BMI, swept in 0.1 steps", () => {
  /**
   * Swept rather than sampled, and swept at 0.1 — the resolution the card
   * displays — because a forbidden word would hide at a band edge, not in the
   * middle of a band. Three heights so the sweep is not an artefact of one
   * height's arithmetic. 10 to 60 covers everything the module will publish.
   *
   * This test is the one that must never be weakened. "Obesity" is a scheduled
   * condition under the Drugs and Magic Remedies Act 1954 s.3 and the report is
   * an advertisement for the coach.
   */
  const keysSeen = new Set<string>();
  let checked = 0;

  for (const heightCm of [152, 168, 183]) {
    for (let target = 10; target <= 60.0001; target += 0.1) {
      const bmiTarget = round1(target);
      const weightKg = bmiTarget * (heightCm / 100) ** 2;
      const { bmi } = computeWellness(
        input({ age: 30, gender: "female", heightCm, weightKg })
      );
      assert.ok(bmi, `refused a plausible BMI of ${bmiTarget} at ${heightCm}cm`);

      assert.ok(
        !FORBIDDEN_CATEGORY_WORDS.test(bmi.band.label),
        `RULES.md L3 violated at BMI ${bmi.value}: ${JSON.stringify(bmi.band.label)}`
      );
      assert.ok(
        !FORBIDDEN_CATEGORY_WORDS.test(bmi.band.key),
        `RULES.md L3 violated in the band key at BMI ${bmi.value}: ${bmi.band.key}`
      );
      keysSeen.add(bmi.band.key);
      checked++;
    }
  }

  // Coverage guard: a sweep that only ever produced one band would pass the
  // assertions above while proving nothing about the other three labels.
  assert.deepEqual([...keysSeen].sort(), ["above", "below", "in", "just_above"]);
  assert.ok(checked > 1400, `sweep collapsed to ${checked} cases`);
});

test("L3: every label is one of the four permitted phrasings, exactly", () => {
  /**
   * Exact-string equality against RULES.md L3's own wording. Paraphrasing is the
   * realistic failure mode here — "Above the healthy range" reads as harmless and
   * reintroduces a judgement about the person, which is precisely what the
   * neutral phrasing exists to avoid.
   */
  for (const heightCm of [155, 170]) {
    for (const bmiTarget of [12, 18.4, 18.5, 20, 22.9, 23, 24.9, 25, 30, 55]) {
      const weightKg = bmiTarget * (heightCm / 100) ** 2;
      const { bmi } = computeWellness(
        input({ age: 30, gender: "male", heightCm, weightKg })
      );
      assert.ok(bmi);
      assert.equal(bmi.band.label, PERMITTED_LABELS[bmi.band.key]);
    }
  }
});

test("bands change at the WHO Asia-Pacific cut-offs 18.5 / 23 / 25", () => {
  /**
   * Height 200cm makes h² exactly 4 m², so BMI is weight/4 and each edge can be
   * hit with an exactly-representable weight — no rounding argument needed to
   * know which side of a cut-off the input is on. The expected keys come from
   * D12's cut-offs (healthy 18.5–22.9, so 23.0 is already outside it), not from
   * the module's constants.
   */
  const cases: Array<[number, string]> = [
    [73.6, "below"], //  BMI 18.4
    [74.0, "in"], //     BMI 18.5 — the lower edge is INSIDE
    [91.6, "in"], //     BMI 22.9 — last healthy tenth
    [92.0, "just_above"], // BMI 23.0 — the upper edge is OUTSIDE
    [99.6, "just_above"], // BMI 24.9
    [100.0, "above"], // BMI 25.0
  ];

  for (const [weightKg, expected] of cases) {
    const { bmi } = computeWellness(
      input({ age: 30, gender: "female", heightCm: 200, weightKg })
    );
    assert.ok(bmi);
    assert.equal(bmi.band.key, expected, `BMI ${bmi.value} banded as ${bmi.band.key}`);
  }

  // The exported constants must agree with the cut-offs the card cites (D12).
  assert.equal(HEALTHY_BMI_MIN, 18.5);
  assert.equal(HEALTHY_BMI_MAX, 23);
});

test("the band never contradicts the number printed beside it", () => {
  /**
   * A card reading "23.0 · In the general range" contradicts the standard it
   * cites in the line underneath. Whatever rounding happens, the label has to
   * describe the figure the prospect can see — so the band is checked against the
   * DISPLAYED value across the sweep, and separately at 22.96, which displays as
   * 23.0 and must therefore not claim to be inside the range.
   */
  for (const heightCm of [148, 163, 177, 192]) {
    for (let target = 12; target <= 45; target += 0.1) {
      const weightKg = round1(target) * (heightCm / 100) ** 2;
      const { bmi } = computeWellness(
        input({ age: 30, gender: "male", heightCm, weightKg })
      );
      assert.ok(bmi);
      assert.equal(
        bmi.band.key,
        bandKeyForDisplayedBmi(bmi.value),
        `printed ${bmi.value} but banded ${bmi.band.key}`
      );
    }
  }

  const nearlyTwentyThree = computeWellness(
    input({ age: 30, gender: "male", heightCm: 200, weightKg: 91.84 }) // BMI 22.96
  );
  assert.equal(nearlyTwentyThree.bmi?.value, 23.0);
  assert.equal(nearlyTwentyThree.bmi?.band.key, "just_above");
});

test("band keys are monotonic in BMI — no band can appear out of order", () => {
  const order = ["below", "in", "just_above", "above"];
  let lowest = 0;
  for (let target = 10; target <= 60; target += 0.1) {
    const weightKg = round1(target) * 1.7 ** 2;
    const { bmi } = computeWellness(
      input({ age: 30, gender: "female", heightCm: 170, weightKg })
    );
    assert.ok(bmi);
    const rank = order.indexOf(bmi.band.key);
    assert.ok(rank >= lowest, `band went backwards to ${bmi.band.key} at ${bmi.value}`);
    lowest = rank;
  }
  assert.equal(lowest, order.length - 1, "the sweep never reached the top band");
});

/* ------------------------------------------------------------------ *
 * Body fat — Deurenberg, published as a range.
 * ------------------------------------------------------------------ */

test("body fat matches Deurenberg, hand-computed, for two adults", () => {
  /**
   * Female, 30, BMI 22.0385674…: 1.2(22.0385674) + 0.23(30) − 0 − 5.4
   *   = 26.4462809 + 6.9 − 5.4 = 27.9462809 → range 24–32.
   * Male, 45, BMI 25.8805706…: 1.2(25.8805706) + 0.23(45) − 10.8 − 5.4
   *   = 31.0566857 + 10.35 − 16.2 = 25.2066848 → range 21–29.
   * Both worked through on paper from the 1991 coefficients.
   */
  const a = computeWellness(
    input({ age: 30, gender: "female", heightCm: 165, weightKg: 60 })
  );
  assert.deepEqual(a.bodyFatPct, { low: 24, high: 32 });

  const b = computeWellness(
    input({ age: 45, gender: "male", heightCm: 178, weightKg: 82 })
  );
  assert.deepEqual(b.bodyFatPct, { low: 21, high: 29 });
});

test("body fat is computed from the true BMI, not the rounded one on the card", () => {
  /**
   * A display-rounded intermediate must never feed a calculation. 76.64 kg at
   * 200 cm is BMI 19.16 exactly, printed as 19.2 — and the two give different
   * answers once rounded to whole percentage points:
   *   from 19.16 → 1.2(19.16) + 6.9 − 5.4 = 24.492 → range 20–28   (correct)
   *   from 19.2  → 1.2(19.20) + 6.9 − 5.4 = 24.540 → range 21–29   (wrong)
   * So this is a genuine discriminator, not a restatement of the formula.
   */
  const metrics = computeWellness(
    input({ age: 30, gender: "female", heightCm: 200, weightKg: 76.64 })
  );
  assert.equal(metrics.bmi?.value, 19.2);
  assert.deepEqual(metrics.bodyFatPct, { low: 20, high: 28 });
});

test("body fat is a range that straddles the estimate and spans the ±4pt error", () => {
  /**
   * D16: the Deurenberg standard error is ~4 percentage points, so a single
   * decimal would claim precision the equation does not have. Two invariants
   * follow, and they hold at every input rather than at a chosen one:
   *  - the published low/high bracket the point estimate;
   *  - the span is exactly 8 points wide, because adding 8 to a number leaves
   *    its fractional part alone, so rounding both ends cannot change the width.
   *    The one exception is the clamp at zero (a range cannot start negative).
   */
  for (const person of realisticAdults()) {
    const metrics = computeWellness(input(person));
    const range = metrics.bodyFatPct;
    assert.ok(range, `body fat refused for a realistic adult ${JSON.stringify(person)}`);

    const point = bodyFatRef(
      bmiRef(person.weightKg, person.heightCm),
      person.age,
      person.gender === "male"
    );

    assert.ok(range.low >= 0, `negative body fat floor ${range.low}`);
    // 0.5 of slack: low/high are whole numbers rounded from point∓4, so each end
    // may sit up to half a point on the far side of the unrounded bound.
    assert.ok(
      range.low <= point + 0.5 && range.high >= point - 0.5,
      `range ${range.low}-${range.high} does not straddle ${point}`
    );
    if (range.low > 0) {
      assert.equal(range.high - range.low, 8, `range width at ${JSON.stringify(person)}`);
    }
  }
});

test("body fat moves the way Deurenberg says: up with age and BMI, lower for men", () => {
  /**
   * Directional properties catch a sign error on the sex or age term, which a
   * single hand-checked case can absorb silently. The 10.8-point sex offset is
   * the largest term in the equation, so a flipped sign there is both the easiest
   * mistake and the most visible on a card.
   */
  const at = (over: Partial<WellnessInput>) =>
    computeWellness(input({ heightCm: 170, weightKg: 70, ...over })).bodyFatPct;

  const young = at({ age: 20, gender: "female" });
  const old = at({ age: 60, gender: "female" });
  assert.ok(young && old && old.low > young.low, "body fat did not rise with age");

  const lighter = at({ age: 30, gender: "female", weightKg: 55 });
  const heavier = at({ age: 30, gender: "female", weightKg: 85 });
  assert.ok(lighter && heavier && heavier.low > lighter.low, "did not rise with BMI");

  const female = at({ age: 30, gender: "female" });
  const male = at({ age: 30, gender: "male" });
  assert.ok(female && male && male.low < female.low, "sex term has the wrong sign");
  // 10.8 points apart before rounding; whole-point rounding can shave a point.
  assert.ok(Math.abs(female.low - male.low - 10.8) <= 0.5);
});

/* ------------------------------------------------------------------ *
 * BMR.
 * ------------------------------------------------------------------ */

test("BMR matches Mifflin-St Jeor, hand-computed, for two adults", () => {
  /**
   * Female, 60 kg, 165 cm, 30: 600 + 1031.25 − 150 − 161 = 1320.25 kcal.
   * Male, 82 kg, 178 cm, 45:   820 + 1112.50 − 225 + 5   = 1712.50 kcal.
   * The module publishes to the nearest 10 (see the property test below for why
   * that granularity is treated as a display choice rather than a requirement),
   * giving 1320 and 1710.
   */
  const a = computeWellness(
    input({ age: 30, gender: "female", heightCm: 165, weightKg: 60 })
  );
  assert.equal(a.bmrKcal, 1320);

  const b = computeWellness(
    input({ age: 45, gender: "male", heightCm: 178, weightKg: 82 })
  );
  assert.equal(b.bmrKcal, 1710);
});

test("BMR never drifts more than half a display step from the equation", () => {
  /**
   * The assertion is the PROPERTY — "whatever granularity is published, it must
   * not distort the estimate" — rather than the constant 10. Neither Section 5.2
   * nor DECISIONS.md fixes the granularity; it is an honest-precision choice
   * argued in a code comment, and pinning it would turn a defensible future
   * change into a test failure. Distorting the number, by contrast, would be a
   * defect at any granularity.
   */
  for (const person of realisticAdults()) {
    const { bmrKcal } = computeWellness(input(person));
    assert.ok(bmrKcal, `BMR refused for a realistic adult ${JSON.stringify(person)}`);
    const exact = bmrRef(
      person.weightKg,
      person.heightCm,
      person.age,
      person.gender === "male"
    );
    assert.equal(bmrKcal % 10, 0, `${bmrKcal} is not a whole display step`);
    assert.ok(
      Math.abs(bmrKcal - exact) <= 5 + 1e-9,
      `published ${bmrKcal} against an exact ${exact}`
    );
  }
});

test("the BMR sex term is exactly 166 kcal, and BMR moves the right way", () => {
  /**
   * Mifflin-St Jeor's constant is +5 for men and −161 for women, so two people
   * identical but for that term differ by exactly 166 kcal. Asserting the
   * difference rather than the two values tests the term in isolation. 166 is not
   * a multiple of 10, so the published figures can round to 160 or 170 apart —
   * hence the comparison against the unrounded reference.
   */
  const body = { age: 35, heightCm: 172, weightKg: 68 };
  const male = bmrRef(body.weightKg, body.heightCm, body.age, true);
  const female = bmrRef(body.weightKg, body.heightCm, body.age, false);
  assert.equal(male - female, 166);

  const publishedMale = computeWellness(input({ ...body, gender: "male" })).bmrKcal;
  const publishedFemale = computeWellness(input({ ...body, gender: "female" })).bmrKcal;
  assert.ok(publishedMale && publishedFemale);
  assert.ok(publishedMale > publishedFemale, "men should not have the lower BMR");
  assert.ok(Math.abs(publishedMale - publishedFemale - 166) <= 10);

  const younger = computeWellness(
    input({ ...body, age: 25, gender: "male" })
  ).bmrKcal;
  const older = computeWellness(input({ ...body, age: 65, gender: "male" })).bmrKcal;
  assert.ok(younger && older && younger > older, "BMR should fall with age");

  const lighter = computeWellness(
    input({ ...body, weightKg: 55, gender: "male" })
  ).bmrKcal;
  const heavier = computeWellness(
    input({ ...body, weightKg: 90, gender: "male" })
  ).bmrKcal;
  assert.ok(lighter && heavier && heavier > lighter, "BMR should rise with weight");
});

/* ------------------------------------------------------------------ *
 * Gender "other" and gender absent — omitted, never guessed (D16).
 * ------------------------------------------------------------------ */

test("D16: body fat and BMR are omitted, not guessed, when sex is not binary", () => {
  /**
   * Every published form of both equations is keyed to a binary sex term and
   * averaging the two has never been validated, so the honest output is no
   * output. The height-and-weight metrics are unaffected, and — per D15 — the
   * report is still made: gender is not one of the three fields a snapshot
   * requires, so omitting two metrics is the designed behaviour rather than the
   * degraded card D15 refuses to produce.
   */
  for (const gender of [null, "other"] as Array<Gender | null>) {
    const details = { age: 30, heightCm: 170, weightKg: 70, gender };
    const metrics = computeWellness(input(details));

    assert.equal(metrics.bodyFatPct, null, `body fat guessed for gender ${gender}`);
    assert.equal(metrics.bmrKcal, null, `BMR guessed for gender ${gender}`);
    assert.ok(metrics.bmi, "BMI does not depend on sex and should still be published");
    assert.ok(metrics.healthyWeightKg, "the weight range does not depend on sex");
    assert.deepEqual(reportEligibility(input(details)), { ok: true });
  }

  // Absent gender is reported as missing so the coach can fill it in; "other" is
  // an answer, not a blank, so it is not chased.
  assert.deepEqual(
    computeWellness(input({ age: 30, heightCm: 170, weightKg: 70 })).missing,
    ["gender"]
  );
  assert.deepEqual(
    computeWellness(input({ age: 30, gender: "other", heightCm: 170, weightKg: 70 }))
      .missing,
    []
  );
});

test("missing inputs are reported completely and in a stable order", () => {
  assert.deepEqual(computeWellness(input({})).missing, [
    "height",
    "weight",
    "age",
    "gender",
  ]);
  assert.deepEqual(
    computeWellness(input({ age: 30, gender: "male" })).missing,
    ["height", "weight"]
  );
  assert.deepEqual(
    computeWellness(input({ age: 30, gender: "male", heightCm: 170, weightKg: 70 }))
      .missing,
    []
  );
});

/* ------------------------------------------------------------------ *
 * Healthy weight range — derived from the bands, and self-consistent.
 * ------------------------------------------------------------------ */

const tenth = (kg: number) => Math.round(kg * 10) / 10;

test("the healthy weight range holds exactly the weights whose card reads as healthy", () => {
  /**
   * This test used to assert `bounds × height²`, and asserting that is what let a
   * real defect through.
   *
   * 23 is the EXCLUSIVE top of the healthy band, and the band is decided on the
   * ROUNDED BMI — so `23 × h²` published a weight the very same card then labelled
   * "Just above the general range", at every height from 140 to 200 cm. The lower
   * bound was wrong in the opposite direction: `18.5 × h²` rounded UP to a weight
   * whose true BMI was below 18.5, excluding a tenth that does read as healthy.
   *
   * So the range is not an algebraic identity, it is a question about rounding, and
   * the property that matters is self-consistency: every weight the card offers as
   * healthy must band as healthy, and one tenth outside either end must not. That is
   * what is asserted, at five heights across the plausible span.
   */
  for (const heightCm of [140, 152, 165, 178, 200]) {
    const range = computeWellness(
      input({ age: 30, gender: "male", heightCm, weightKg: 70 })
    ).healthyWeightKg;
    assert.ok(range, `no range at ${heightCm}cm`);

    const bandAt = (weightKg: number) =>
      computeWellness(input({ age: 30, gender: "male", heightCm, weightKg })).bmi?.band
        .key;

    assert.equal(
      bandAt(range.min),
      "in",
      `${heightCm}cm: min ${range.min}kg does not read as healthy`
    );
    assert.equal(
      bandAt(range.max),
      "in",
      `${heightCm}cm: max ${range.max}kg does not read as healthy`
    );
    assert.notEqual(
      bandAt(tenth(range.min - 0.1)),
      "in",
      `${heightCm}cm: min is not the LOWEST healthy tenth`
    );
    assert.notEqual(
      bandAt(tenth(range.max + 0.1)),
      "in",
      `${heightCm}cm: max is not the HIGHEST healthy tenth`
    );

    /**
     * Unit-slip guard, kept from the original test because it is the only thing here
     * that would catch a centimetre/metre confusion — that error is off by a factor
     * of 10,000 and would sail past every band assertion above. Half a kilo is loose
     * enough for the rounding correction and nowhere near loose enough to hide a
     * unit bug.
     */
    const h2 = (heightCm / 100) ** 2;
    assert.ok(
      Math.abs(range.min - HEALTHY_BMI_MIN * h2) < 0.5,
      `${heightCm}cm: min ${range.min} is nowhere near ${HEALTHY_BMI_MIN}×h²`
    );
    assert.ok(
      Math.abs(range.max - HEALTHY_BMI_MAX * h2) < 0.5,
      `${heightCm}cm: max ${range.max} is nowhere near ${HEALTHY_BMI_MAX}×h²`
    );
  }
});

test("the range widens with height and never inverts", () => {
  let previousMin = 0;
  let previousMax = 0;
  for (let heightCm = 140; heightCm <= 200; heightCm += 1) {
    const range = computeWellness(
      input({ age: 30, gender: "male", heightCm, weightKg: 70 })
    ).healthyWeightKg;
    assert.ok(range, `no range at ${heightCm}cm`);

    assert.ok(range.min < range.max, `inverted range at ${heightCm}cm`);
    // Strictly increasing: a taller person's healthy range cannot start or end lower.
    // One centimetre changes h² by enough that this holds at every step.
    assert.ok(
      range.min > previousMin && range.max > previousMax,
      `not monotonic at ${heightCm}cm`
    );
    previousMin = range.min;
    previousMax = range.max;
  }
});

test("a weight from inside the healthy range bands as in the general range", () => {
  /**
   * The round trip, which is what makes the range meaningful: if the card tells a
   * prospect their general range is 50.4–62.6 kg, then weighing something in
   * there has to read back as "In the general range". A hardcoded pair of
   * kilograms would pass even if the two halves of the card disagreed.
   *
   * The lower bound and the interior are checked here and they hold. The TOP of
   * the range does NOT, at any height — that is the `todo` test immediately
   * below, kept separate so this one can guard against regressions instead of
   * being permanently red.
   *
   * One thing to know before changing anything here: the lower bound holds by
   * luck rather than by construction. `min` is rounded to the nearest tenth, so
   * it can land under the bound (150 cm → 41.6 kg → a true BMI of 18.4889), and
   * it reads as healthy only because the DISPLAYED figure rounds back up to 18.5.
   * Both ends are one rounding decision away from disagreeing with their label.
   */
  for (let heightCm = 140; heightCm <= 200; heightCm += 1) {
    const range = computeWellness(
      input({ age: 30, gender: "female", heightCm, weightKg: 60 })
    ).healthyWeightKg;
    assert.ok(range);

    const probes = [
      range.min,
      range.min + (range.max - range.min) * 0.25,
      (range.min + range.max) / 2,
      range.min + (range.max - range.min) * 0.75,
    ];
    for (const weightKg of probes) {
      const { bmi } = computeWellness(
        input({ age: 30, gender: "female", heightCm, weightKg })
      );
      assert.ok(bmi, `refused ${weightKg}kg at ${heightCm}cm`);
      assert.equal(
        bmi.band.key,
        "in",
        `${weightKg}kg at ${heightCm}cm is inside the published range but bands as ` +
          `"${bmi.band.label}" (BMI ${bmi.value})`
      );
    }
  }
});

test(
  "the TOP of the healthy range also bands as in the general range",
  {
    /**
     * KNOWN FAILING — a real inconsistency, reported rather than blessed.
     *
     * `healthyWeightKg.max` is HEALTHY_BMI_MAX × h², and HEALTHY_BMI_MAX is 23.
     * But 23 is the EXCLUSIVE top of the healthy band (D12: healthy is 18.5–22.9,
     * overweight starts at 23), and `bmiBand` implements it that way with
     * `bmi < HEALTHY_BMI_MAX`. So the heaviest weight the card presents as
     * healthy computes to a BMI of exactly 23.0, which the same module labels
     * "Just above the general range".
     *
     * Rounding to one decimal makes it unconditional rather than occasional:
     * anything in [22.95, 23) displays as 23.0 and is banded from the displayed
     * figure, so even heights where max lands slightly under 23 (165 cm → 62.6 kg
     * → true BMI 22.9936) still come out "just above". Checked at every height
     * from 140 to 200 cm: it fails at all of them.
     *
     * Why it matters beyond tidiness: the card prints the range and the band side
     * by side, and D13 turns on the two never contradicting each other. A
     * prospect at the top of their own stated healthy range being told they are
     * above it is exactly the judgement-about-the-person that the neutral
     * phrasing exists to avoid.
     *
     * The fix is a product decision, not a test change — and note that simply
     * banding from the unrounded BMI would swap one inconsistency for another: at
     * 150 cm the published minimum of 41.6 kg is a true BMI of 18.4889, which is
     * genuinely BELOW 18.5 and only reads as healthy because the display rounds
     * it up. A range that round-trips at both ends has to be built from the
     * tenths the card can actually print — 22.9 × h² floored to a tenth at the
     * top, 18.5 × h² ceiled to a tenth at the bottom — rather than from the
     * endpoints of an open interval.
     *
     * FIXED. `healthyWeightRange` in src/lib/wellness.ts now searches for the extreme
     * printable tenths and verifies each against the same `bmiBand` the card uses, so
     * this is a live assertion rather than a recorded gap. Both ends moved: at 165 cm
     * the range went from 50.4–62.6 to 50.3–62.4, because the old lower bound was
     * excluding a tenth that does read as healthy.
     */
  },
  () => {
    for (let heightCm = 140; heightCm <= 200; heightCm += 1) {
      const range = computeWellness(
        input({ age: 30, gender: "female", heightCm, weightKg: 60 })
      ).healthyWeightKg;
      assert.ok(range);
      const { bmi } = computeWellness(
        input({ age: 30, gender: "female", heightCm, weightKg: range.max })
      );
      assert.ok(bmi);
      assert.equal(
        bmi.band.key,
        "in",
        `${range.max}kg is the top of the published range at ${heightCm}cm but ` +
          `bands as "${bmi.band.label}" (BMI ${bmi.value})`
      );
    }
  }
);

/* ------------------------------------------------------------------ *
 * Water — fixed adult guidance, never weight-derived (D16).
 * ------------------------------------------------------------------ */

test("D16: water is the EFSA adult intake and never varies with weight", () => {
  /**
   * The regression this guards is specific and named in D16: weight × 30–35 ml is
   * a clinical IV-maintenance heuristic for hospitalised patients, not a
   * population recommendation, and presenting the product as a prospect's
   * personal target invents a requirement. So the test asserts INDEPENDENCE from
   * weight — a 45 kg and a 120 kg adult of the same sex must be told the same
   * thing — which is a property the weight-times-a-number formula cannot satisfy.
   */
  const fixed: Array<[Gender | null, { low: number; high: number }]> = [
    ["female", { low: 2.0, high: 2.0 }],
    ["male", { low: 2.5, high: 2.5 }],
    ["other", { low: 2, high: 2.5 }], // a span, because the figure is sex-keyed
    [null, { low: 2, high: 2.5 }],
  ];

  for (const [gender, expected] of fixed) {
    for (const weightKg of [45, 60, 85, 120]) {
      for (const heightCm of [150, 175]) {
        for (const age of [18, 40, 70]) {
          const metrics = computeWellness(
            input({ age, gender, heightCm, weightKg })
          );
          assert.deepEqual(
            metrics.waterLitres,
            expected,
            `water changed for ${gender} at ${weightKg}kg/${heightCm}cm/${age}y`
          );
        }
      }
    }
  }
});

test("water guidance survives a missing height and weight", () => {
  /**
   * It is fixed adult guidance, so there is nothing to withhold when the body
   * measurements are absent — and a card that drops it whenever a field is blank
   * would send the coach back to the prospect for a number the figure does not
   * use. Worth pinning: the type says `| null`, and nothing in the spec would
   * justify exercising that null.
   */
  assert.deepEqual(computeWellness(input({ gender: "female" })).waterLitres, {
    low: 2.0,
    high: 2.0,
  });
  assert.deepEqual(computeWellness(input({})).waterLitres, { low: 2, high: 2.5 });
});

/* ------------------------------------------------------------------ *
 * Plausibility guards — refuse the absurd, never refuse a real adult.
 * ------------------------------------------------------------------ */

test("absurd height and weight combinations are refused, not rendered", () => {
  /**
   * The spec-level requirement is behavioural: an implausible result must not
   * reach a prospect, because publishing a BMI of 166 to someone met on a morning
   * walk is both absurd and alarming. The numeric cut-offs the module uses are an
   * implementation constant with no spec backing, so the probes below are all
   * unambiguously absurd rather than sitting on a threshold — a test that pinned
   * the threshold would fail the day someone reasonably widened it.
   */
  const absurd: Array<[string, Partial<WellnessInput>]> = [
    ["dropped digit: 160cm typed as 60cm", { heightCm: 60, weightKg: 60 }],
    ["zero weight", { heightCm: 170, weightKg: 0 }],
    ["negative weight", { heightCm: 170, weightKg: -70 }],
    ["zero height", { heightCm: 0, weightKg: 70 }],
    ["negative height", { heightCm: -170, weightKg: 70 }],
    ["three metres tall", { heightCm: 300, weightKg: 70 }],
    ["five hundred kilos", { heightCm: 170, weightKg: 500 }],
    ["both absurd", { heightCm: 250, weightKg: 400 }],
  ];

  for (const [why, details] of absurd) {
    const full = input({ age: 30, gender: "female", ...details });
    const metrics = computeWellness(full);
    assert.equal(metrics.bmi, null, `published a BMI for ${why}`);
    assert.equal(metrics.bodyFatPct, null, `published body fat for ${why}`);

    const eligibility = reportEligibility(full);
    assert.equal(eligibility.ok, false, `allowed a snapshot for ${why}`);
    /**
     * The reason must not be "under_age" — that would tell a coach with a
     * perfectly adult prospect that the person is a minor. Zero and negative
     * values come back as "implausible" rather than "incomplete": they are values
     * the coach typed, not blanks, and D15's "needs age and height and weight"
     * speaks to absence. Either refusal satisfies the rule, so only the harmful
     * mislabel is asserted against here.
     */
    assert.notEqual(
      eligibility.ok === false ? eligibility.reason : null,
      "under_age",
      `${why} was reported as an age problem`
    );
  }
});

test("no plausibility guard ever refuses a real adult", () => {
  /**
   * The other half of the guard, and the more dangerous half to get wrong: a
   * refusal shown to a coach standing in front of a prospect costs the sale and
   * the trust. BMI 16 to 40 at 140–200 cm, ages 18–75, spans everyone who walks
   * into a wellness club, and every one of the four estimates must be published.
   */
  let checked = 0;
  for (const person of realisticAdults()) {
    const metrics = computeWellness(input(person));
    const who = JSON.stringify(person);
    assert.ok(metrics.bmi, `BMI refused for ${who}`);
    assert.ok(metrics.bodyFatPct, `body fat refused for ${who}`);
    assert.ok(metrics.bmrKcal, `BMR refused for ${who}`);
    assert.ok(metrics.healthyWeightKg, `weight range refused for ${who}`);
    assert.deepEqual(reportEligibility(input(person)), { ok: true }, `refused ${who}`);
    checked++;
  }
  assert.ok(checked > 800, `sweep collapsed to ${checked} people`);
});

test("an absurd body fat is dropped on its own, without dropping the card", () => {
  /**
   * BMI 60.0 is inside the module's plausible band but Deurenberg on it gives a
   * body fat over 70% for a young woman: 1.2(60) + 0.23(20) − 5.4 = 71.2. The
   * right answer is to omit the one estimate the equation cannot support while
   * still publishing the ones it can — the same "omit rather than guess" reasoning
   * D16 applies to non-binary sex. 135 kg at 150 cm is BMI 60.0 exactly.
   */
  const metrics = computeWellness(
    input({ age: 20, gender: "female", heightCm: 150, weightKg: 135 })
  );
  assert.equal(metrics.bmi?.value, 60.0);
  assert.equal(metrics.bodyFatPct, null, "published a body fat percentage over 70");
  assert.ok(metrics.bmrKcal, "BMR is unaffected and should still be published");
  assert.deepEqual(reportEligibility(
    input({ age: 20, gender: "female", heightCm: 150, weightKg: 135 })
  ), { ok: true });
});

/* ------------------------------------------------------------------ *
 * L6 — the age gate. Refuse, do not degrade.
 * ------------------------------------------------------------------ */

test("L6: the age gate is exactly 18 — 17 is refused, 18 is allowed", () => {
  /**
   * RULES.md L6 and D15: the DPDP Rules 2025 (Rule 10) require verifiable
   * parental consent before processing a child's data, which a roadside
   * conversation cannot deliver. 18 is the legal threshold, so the boundary is
   * asserted on both sides and at the fractional edge — an off-by-one here is a
   * statutory breach, not a rounding preference.
   */
  const adult = { gender: "male" as Gender, heightCm: 170, weightKg: 62 };

  assert.equal(MIN_REPORT_AGE, 18);
  assert.deepEqual(reportEligibility(input({ ...adult, age: 18 })), { ok: true });
  assert.deepEqual(reportEligibility(input({ ...adult, age: 19 })), { ok: true });

  for (const age of [17, 17.5, 17.99, 16, 12, 1]) {
    assert.deepEqual(
      reportEligibility(input({ ...adult, age })),
      { ok: false, reason: "under_age" },
      `age ${age} was not refused as under-age`
    );
  }
});

test("L6: refusal is total — a minor's body fat is not computed either", () => {
  /**
   * "Refuse rather than degrade" (D15) has to hold at the metric level and not
   * only at the gate, because a blank on a card gets filled in verbally, off the
   * record, which is the one channel no control reaches. Deurenberg also has a
   * separate children's equation, so the adult one has no meaning here.
   */
  const minor = input({ age: 15, gender: "female", heightCm: 160, weightKg: 48 });
  assert.equal(computeWellness(minor).bodyFatPct, null);
  assert.equal(reportEligibility(minor).ok, false);

  /**
   * Worth knowing while reading this: BMI, its band and BMR are still computed
   * for a minor, on adult WHO Asia-Pacific cut-offs that D15 says do not apply
   * below 19. Nothing reaches a screen — `reportEligibility` gates the report and
   * the prospect page only renders metrics once a report exists — so this is a
   * latent inconsistency in `computeWellness`, not a live leak, and it is
   * deliberately NOT asserted either way here: doing so would either bless it or
   * demand a change the spec does not clearly require.
   */
});

test("L6: an age of zero or a negative age is refused as under-age", () => {
  /**
   * Zero is the value a numeric input yields when someone clears it and a
   * coercion writes 0 rather than null, so it is a realistic input rather than a
   * hypothetical. It must land on the safe side of the gate. Absent age is a
   * different answer — the coach is asked for it — and the ORDER matters: a
   * prospect whose age is missing must be told to add it, never told they are
   * under 18.
   */
  const adult = { gender: "female" as Gender, heightCm: 158, weightKg: 55 };
  assert.deepEqual(reportEligibility(input({ ...adult, age: 0 })), {
    ok: false,
    reason: "under_age",
  });
  assert.deepEqual(reportEligibility(input({ ...adult, age: -5 })), {
    ok: false,
    reason: "under_age",
  });
  assert.deepEqual(reportEligibility(input({ ...adult, age: null })), {
    ok: false,
    reason: "incomplete",
    missing: ["age"],
  });
});

test("an incomplete prospect is told exactly which details are missing", () => {
  /**
   * The refusal reason is rendered to the coach verbatim by
   * `eligibilityMessage`, so a wrong or partial list tells them to add a detail
   * they already filled in. Height, weight and age are the three a snapshot
   * needs (D15); gender is not, so it is never a blocker.
   */
  assert.deepEqual(reportEligibility(input({})), {
    ok: false,
    reason: "incomplete",
    missing: ["height", "weight", "age"],
  });
  assert.deepEqual(reportEligibility(input({ age: 30 })), {
    ok: false,
    reason: "incomplete",
    missing: ["height", "weight"],
  });
  assert.deepEqual(reportEligibility(input({ age: 30, heightCm: 170 })), {
    ok: false,
    reason: "incomplete",
    missing: ["weight"],
  });
  assert.deepEqual(
    reportEligibility(input({ heightCm: 170, weightKg: 70, gender: "other" })),
    { ok: false, reason: "incomplete", missing: ["age"] }
  );
  // Gender alone never blocks a snapshot.
  assert.deepEqual(
    reportEligibility(input({ age: 30, heightCm: 170, weightKg: 70 })),
    { ok: true }
  );
});

test("a minor with absurd measurements is still refused on age, or refused at all", () => {
  /**
   * Overlapping refusals must not cancel out. Whichever reason wins, the answer
   * is no — and it must never come back ok.
   */
  const cases: WellnessInput[] = [
    input({ age: 14, gender: "male", heightCm: 60, weightKg: 60 }),
    input({ age: 14, gender: "male", heightCm: 170, weightKg: 500 }),
    input({ age: 0, gender: null, heightCm: 0, weightKg: 0 }),
  ];
  for (const c of cases) {
    assert.equal(reportEligibility(c).ok, false, `allowed ${JSON.stringify(c)}`);
  }
});

/* ------------------------------------------------------------------ *
 * report-copy.ts — the words that travel with the numbers.
 * ------------------------------------------------------------------ */

test("L5: the Section 5.2 disclaimer is present verbatim", () => {
  /**
   * Quoted from CLAUDE.md Section 5.2 character for character. Every report
   * carries it, and paraphrasing it is the failure mode — "Estimates for general
   * wellness. Not medical advice." reads identically to a human and is no longer
   * the sentence the spec mandates.
   */
  assert.equal(
    reportCopy.DISCLAIMER,
    "Estimates for general wellness only. Not medical advice."
  );
});

test("L5: the second, ASCI-driven line travels with it and says both required things", () => {
  /**
   * D13: the Consumer Affairs / ASCI guidance for health-and-wellness influencers
   * requires saying this is not a substitute for professional advice AND
   * encouraging a consult. The Section 5.2 line does neither, which is why there
   * are two lines and why they are not merged.
   */
  const line = reportCopy.NOT_A_DOCTOR;
  assert.ok(line.length > 0);
  assert.notEqual(line, reportCopy.DISCLAIMER);
  assert.match(line, /not a medical professional/i);
  assert.match(line, /doctor/i);
});

test("L5: the WhatsApp message carries the disclaimer with the link", () => {
  /**
   * The WhatsApp body is editable plain text and a coach may trim it, so the
   * numbers deliberately live behind the link. The disclaimer still rides along,
   * because the link may be forwarded on its own.
   */
  const body = reportCopy.whatsappMessage({
    firstName: "Asha",
    url: "https://example.test/r/tok",
    coachName: "Ravi",
  });
  assert.ok(body.includes(reportCopy.DISCLAIMER));
  assert.ok(body.includes("https://example.test/r/tok"));
  // First name only, never a phone number (RULES.md P3).
  assert.ok(!/\+?\d{10}/.test(body), "a phone-shaped number reached the message");
});

test("F9: the coach's page rides on the message, and is absent when unpublished", () => {
  /**
   * F9 says the portfolio link travels with every report sent. It is also the only
   * distribution the portfolio has — a page nobody links to is a page nobody visits.
   *
   * The absent case matters more than the present one. A coach who has not published
   * must get NO link rather than a dead one: a prospect who taps through to a 404 learns
   * something worse about the coach than they would have learned from no link at all.
   */
  const withPage = reportCopy.whatsappMessage({
    firstName: "Asha",
    url: "https://example.test/r/tok",
    coachName: "Ravi",
    portfolioUrl: "https://example.test/ravi",
  });
  assert.ok(withPage.includes("https://example.test/ravi"));
  // The disclaimer stays last, so it is the line above the message box as they send.
  assert.ok(withPage.trimEnd().endsWith(`(${reportCopy.DISCLAIMER})`));

  for (const missing of [null, undefined, ""]) {
    const without = reportCopy.whatsappMessage({
      firstName: "Asha",
      url: "https://example.test/r/tok",
      coachName: "Ravi",
      portfolioUrl: missing,
    });
    assert.ok(!/A bit about me/.test(without), `a dangling label survived ${missing}`);
    assert.ok(without.includes(reportCopy.DISCLAIMER));
  }
});

test("L3: no report string anywhere names a clinical category", () => {
  /**
   * Sweeps every exported string in report-copy, including nested objects and the
   * whole next-step pool harvested by calling `nextStepLine` over many ids. This
   * is the companion to the BMI sweep: the labels are one place a forbidden word
   * could appear, and the surrounding prose is the other.
   */
  const strings = collectStrings(reportCopy);
  for (let i = 0; i < 500; i++) strings.push(reportCopy.nextStepLine(`report-${i}`));
  strings.push(
    reportCopy.whatsappMessage({ firstName: "A", url: "u", coachName: "C" })
  );
  assert.ok(strings.length > 12, "the copy sweep found almost nothing to check");

  for (const s of strings) {
    assert.ok(
      !FORBIDDEN_CATEGORY_WORDS.test(s),
      `RULES.md L3 violated by report copy: ${JSON.stringify(s)}`
    );
    assert.ok(
      !FORBIDDEN_QUANTITIES.test(s),
      `Section 5.2 forbids a quantity named in: ${JSON.stringify(s)}`
    );
    assert.ok(
      !INCOME_WORDS.test(s),
      `RULES.md L4 violated by report copy: ${JSON.stringify(s)}`
    );
  }
});

test("L1/L8: the coach's role on a report is fixed, not free text", () => {
  /**
   * A text field here is how a company product name or a rank name ends up on a
   * prospect-facing card (L1, L8). The value is a constant, so the assertion is
   * that it stays one and stays brand-neutral.
   */
  assert.equal(reportCopy.COACH_ROLE, "Wellness Coach");
  assert.equal(typeof reportCopy.COACH_ROLE, "string");
});

test("D13: the next-step line is stable per report and independent of the numbers", () => {
  /**
   * Copy that varies with a health estimate is advice-by-algorithm, which is the
   * short path from "general wellness" software to a medical purpose. The line is
   * therefore chosen from a fixed pool by a hash of the report id — so it is
   * stable for a given report (a prospect who reloads sees the same card) and it
   * cannot correlate with a band. The signature enforces this: `nextStepLine`
   * takes an id and nothing else, so there is no channel for a metric to reach it.
   */
  assert.equal(reportCopy.nextStepLine.length, 1);

  for (const id of ["rpt_a", "rpt_b", "zzz", ""]) {
    assert.equal(reportCopy.nextStepLine(id), reportCopy.nextStepLine(id));
  }

  const pool = new Set<string>();
  for (let i = 0; i < 2000; i++) pool.add(reportCopy.nextStepLine(`id-${i}`));
  assert.ok(pool.size > 1, "the pool collapsed to a single line");
  for (const line of pool) {
    assert.ok(line.length > 0);
    assert.ok(!/\d+(\.\d+)?\s*(kg|bmi|%)/i.test(line), `a metric leaked into: ${line}`);
  }
});

test("the short notes for the card keep every hedge the long notes carry", () => {
  /**
   * The image and PDF use shortened notes because a paragraph per metric will not
   * fit legibly. Shortening may drop words; it may not drop the hedge that tells
   * a reader how to weigh the number. Each short note must still say the figure
   * is an estimate, a guide, or not measured.
   */
  const notes = reportCopy.SHORT_NOTES;
  assert.deepEqual(Object.keys(notes).sort(), [
    "bmi",
    "bmr",
    "bodyFat",
    "water",
    "weightRange",
  ]);
  for (const [key, note] of Object.entries(notes)) {
    assert.match(
      note,
      /estimate|guide|not measured|not a target|guidance/i,
      `${key} lost its hedge: ${note}`
    );
  }
  assert.match(notes.bmi, /not a diagnosis/i);
  assert.match(notes.weightRange, /not a target/i);
});
