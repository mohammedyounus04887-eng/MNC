import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEMO_ROLES, demoRole, demoRoleForUid } from "@/lib/demo";

/**
 * The demo role table is an allowlist, and an allowlist is only worth what its lookup is
 * worth. These test the lookup, not the flag — `isDemoMode()` reads an environment
 * variable, and the useful assertions about it are the ones in `e2e/demo-gate.spec.ts`
 * that check a running server actually 404s.
 */

describe("the demo role allowlist", () => {
  test("keys and uids are both unique", () => {
    // A duplicate key would make one seat unreachable; a duplicate uid would make the
    // switcher's "you are here" tick point at the wrong row.
    const keys = DEMO_ROLES.map((r) => r.key);
    const uids = DEMO_ROLES.map((r) => r.uid);
    assert.equal(new Set(keys).size, keys.length, "duplicate role key");
    assert.equal(new Set(uids).size, uids.length, "duplicate role uid");
  });

  test("every role is fully described, because the picker renders all of it", () => {
    for (const role of DEMO_ROLES) {
      assert.ok(role.name.trim(), `${role.key} has no name`);
      assert.ok(role.headline.trim(), `${role.key} has no headline`);
      assert.ok(role.shows.trim(), `${role.key} has no description`);
      // Seeded uids, so a typo here is a 409 in the middle of somebody's demo.
      assert.match(role.uid, /^usr_[a-z0-9]+$/, `${role.key} uid looks wrong`);
    }
  });

  test("demoRole accepts only the exact keys", () => {
    for (const role of DEMO_ROLES) {
      assert.equal(demoRole(role.key)?.uid, role.uid);
    }
    for (const bad of [
      "admin",
      "usr_root0000000000000000", // a raw uid must not be a way in
      "MIDDLE", // case-sensitive on purpose
      "../middle",
      "",
      null,
      undefined,
      5,
      {},
      ["middle"],
    ]) {
      assert.equal(demoRole(bad), null, `${JSON.stringify(bad)} must be refused`);
    }
  });

  test("demoRoleForUid recognises a demo seat and nothing else", () => {
    for (const role of DEMO_ROLES) {
      assert.equal(demoRoleForUid(role.uid)?.key, role.key);
    }
    // A real coach signed in normally is not a demo seat, so the chip must not claim
    // they are one.
    assert.equal(demoRoleForUid("usr_someone_else"), null);
    assert.equal(demoRoleForUid(""), null);
  });

  test("the three seats cover the whole story", () => {
    // The demo exists to show a relationship, so it needs at least a top, a middle and a
    // bottom of the tree. Fewer than three and "here is what your downline sees" cannot
    // be demonstrated at all.
    assert.ok(DEMO_ROLES.length >= 3, "a demo needs an upline, a middle and a downline");
  });
});
