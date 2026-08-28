import test from "node:test";
import assert from "node:assert/strict";
import { calculateVatInclusiveBudget } from "../budget-vat.js";

test("VAT-inclusive budget is converted to the Meta budget before VAT", () => {
  const result = calculateVatInclusiveBudget(5000, 1000);

  assert.equal(Number(result.beforeVat.toFixed(2)), 4672.9);
  assert.equal(Number(result.vatAmount.toFixed(2)), 327.1);
  assert.equal(result.spentWithVat, 1070);
  assert.equal(Number(result.remainBeforeVat.toFixed(2)), 3672.9);
  assert.equal(result.remainWithVat, 3930);
});

test("negative and invalid budget values are clamped to zero", () => {
  assert.deepEqual(calculateVatInclusiveBudget(-100, "invalid"), {
    totalWithVat: 0,
    beforeVat: 0,
    vatAmount: 0,
    spentBeforeVat: 0,
    spentWithVat: 0,
    remainBeforeVat: 0,
    remainWithVat: 0,
  });
});
