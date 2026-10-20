import { test } from "node:test";
import assert from "node:assert/strict";
import { reversePath } from "./mermaid.ts";

test("reversePath turns a Mermaid edge around", () => {
  assert.equal(reversePath("M1,2L3,4C5,6,7,8,9,10"), "M9,10C7,8,5,6,3,4L1,2");
  assert.equal(reversePath("M0 0 L10 0 L10 10"), "M10,10L10,0L0,0");
  assert.equal(reversePath("M0,0C1,1,2,2,3,3,4,4,5,5,6,6"), "M6,6C5,5,4,4,3,3C2,2,1,1,0,0");
  assert.equal(reversePath("M0,0 Q1,1,2,2"), null, "unknown commands are left alone");
  assert.equal(reversePath("m0,0l1,1"), null);
});
