import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privacyContact, HEALTH_RETENTION_DAYS } from "@/modules/privacy/model";
import { RETENTION_DAYS } from "@/modules/retention/model";

/**
 * The privacy notice (v2 §5.4).
 *
 * Two things are worth testing about a legal document. First, that it cannot be
 * published half-written — the gate. Second, that the numbers it quotes are the numbers
 * the code actually enforces, because a notice which promises a 180-day deletion the job
 * does not perform is a false statement to a regulator, and nothing else in the suite
 * compares prose to behaviour.
 */

const full = {
  entityName: "Some Entity Pvt Ltd",
  grievanceOfficer: "A Person",
  grievanceEmail: "grievance@example.com",
  postalAddress: "1 Street, Bengaluru 560001",
};

describe("the notice cannot be published with a gap in it", () => {
  test("all four facts present publishes", () => {
    assert.notEqual(privacyContact(full), null);
  });

  test("any one missing withholds the whole notice", () => {
    // Three out of four is still a notice a person cannot act on. DPDP Rules 2025
    // require a reachable grievance officer; a document naming three of the four is a
    // legal commitment that fails the duty it exists to discharge.
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      for (const bad of ["", "   ", undefined]) {
        const env = { ...full, [key]: bad };
        assert.equal(privacyContact(env), null, `${key}=${JSON.stringify(bad)} should withhold`);
      }
    }
  });

  test("a grievance address that cannot receive mail is not an address", () => {
    // The cheapest possible guard against a placeholder reaching production.
    assert.equal(privacyContact({ ...full, grievanceEmail: "TBD" }), null);
    assert.equal(privacyContact({ ...full, grievanceEmail: "ask support" }), null);
  });

  test("surrounding whitespace does not defeat the gate or reach the page", () => {
    const c = privacyContact({ ...full, entityName: "  Some Entity Pvt Ltd  " });
    assert.notEqual(c, null);
    assert.equal(c?.entityName, "Some Entity Pvt Ltd");
  });
});

describe("the numbers in the notice are the numbers the code enforces", () => {
  test("the retention figure is the purge job's own constant", () => {
    // Re-exported rather than restated. If the purge window changes, the notice changes
    // with it in the same commit — it cannot quietly keep promising the old one.
    assert.equal(HEALTH_RETENTION_DAYS, RETENTION_DAYS);
  });

  test("the notice imports the link window from the token module, not a literal", () => {
    // Asserted by reading the page rather than by importing the constant: `@/lib/report`
    // reaches the admin SDK, and importing it here would make this unit test require a
    // Firebase configuration to run.
    const src = readFileSync("src/app/privacy/page.tsx", "utf8");
    assert.match(src, /REPORT_TTL_DAYS as REPORT_LINK_DAYS[\s\S]*from "@\/lib\/report"/);
  });

  test("the page quotes those constants rather than typing numbers", () => {
    const src = readFileSync("src/app/privacy/page.tsx", "utf8");
    assert.match(src, /HEALTH_RETENTION_DAYS/, "retention is hardcoded in the notice");
    assert.match(src, /REPORT_LINK_DAYS/, "the link window is hardcoded in the notice");
  });
});

describe("all four surfaces v2 §5.4 names actually link the notice", () => {
  /*
   * The spec names four places, and the first pass shipped three — the manual capture
   * flow was missed and nothing noticed, because a missing link renders as nothing and
   * PrivacyLink renders as nothing when unpublished too. The two absences are
   * indistinguishable by eye.
   *
   * Checked as imports rather than by rendering: PrivacyLink is a server component
   * reading server configuration, so a DOM test would need a server, and the thing worth
   * pinning is that each surface reaches for it at all.
   */
  const SURFACES: [string, string][] = [
    ["the QR self-fill form", "src/app/c/[code]/page.tsx"],
    ["the wellness report page", "src/app/r/[token]/page.tsx"],
    ["Settings", "src/app/(app)/settings/page.tsx"],
    ["the manual capture flow (Mode A)", "src/app/(app)/prospects/new/page.tsx"],
  ];

  for (const [what, file] of SURFACES) {
    test(`${what} links it`, () => {
      const src = readFileSync(file, "utf8");
      assert.match(src, /PrivacyLink/, `${file} does not link the privacy notice`);
    });
  }
});

describe("the notice does not describe a nicer product than the one running", () => {
  const src = readFileSync("src/app/privacy/page.tsx", "utf8");

  test("it states that activity counts flow upward regardless of the toggle", () => {
    // The thing a reader would NOT expect, and therefore the thing a notice has to say.
    assert.match(src, /counts flow upward|numbers only/i);
  });

  test("it states that a report link is a bearer credential", () => {
    // RULES P3. Describing it as "private" without saying anyone holding it can open it
    // would be the comfortable phrasing and the misleading one.
    assert.match(src, /[Aa]nyone holding that\s+link/);
  });

  test("it names no clinical category, and disclaims rather than stays quiet", () => {
    // RULES L3: no clinical word may describe a person, anywhere — including here.
    assert.doesNotMatch(src, /\b(obese|overweight|underweight)\b/i);
    // RULES L2: avoiding a claim is not the same as denying one. A notice that simply
    // omits the word "medical" leaves a reader to assume; these must be affirmative.
    assert.match(src, /not medical advice/i);
    assert.match(src, /not a diagnosis/i);
    // And it must name what the app refuses to calculate, since that is the reassurance
    // a person handing over a weight actually wants.
    assert.match(src, /cholesterol/i);
    assert.match(src, /blood pressure/i);
  });

  test("it does not claim a calculation the app deliberately refuses to make", () => {
    /*
     * The notice listed "general calorie guidance" among the estimates. wellness.ts
     * deliberately does NOT produce maintenance calories — capture collects no activity
     * level, so any figure would apply an invented multiplier, and the restraint is
     * documented at the top of that file.
     *
     * Over-declaring in a privacy notice is a smaller sin than under-declaring, but it
     * is still a false statement about what is done with somebody's body measurements.
     */
    assert.doesNotMatch(src, /calorie/i);
    const wellness = readFileSync("src/lib/wellness.ts", "utf8");
    assert.match(wellness, /Maintenance calories are NOT produced/);
  });

  test("it states RULES L7 as a fact about the data model", () => {
    assert.match(src, /never sees or stores|no field for one/i);
  });
});
