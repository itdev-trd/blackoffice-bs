import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerDateRange } from "../customer-date-filter.js";

const now = new Date("2026-08-13T09:52:00.000Z"); // 13 ส.ค. 2569 16:52 เวลาไทย (วันพฤหัสบดี)

test("customer date presets use complete Bangkok calendar days", () => {
  assert.deepEqual(getCustomerDateRange("today", now), {
    from: "2026-08-12T17:00:00.000Z",
    toExclusive: "2026-08-13T17:00:00.000Z",
  });
  assert.deepEqual(getCustomerDateRange("yesterday", now), {
    from: "2026-08-11T17:00:00.000Z",
    toExclusive: "2026-08-12T17:00:00.000Z",
  });
  assert.deepEqual(getCustomerDateRange("last3", now), {
    from: "2026-08-10T17:00:00.000Z",
    toExclusive: "2026-08-13T17:00:00.000Z",
  });
});

test("customer week, month, and year presets use Bangkok boundaries", () => {
  assert.deepEqual(getCustomerDateRange("this_week", now), {
    from: "2026-08-09T17:00:00.000Z",
    toExclusive: "2026-08-13T17:00:00.000Z",
  });
  assert.deepEqual(getCustomerDateRange("last_week", now), {
    from: "2026-08-02T17:00:00.000Z",
    toExclusive: "2026-08-09T17:00:00.000Z",
  });
  assert.deepEqual(getCustomerDateRange("last_month", now), {
    from: "2026-06-30T17:00:00.000Z",
    toExclusive: "2026-07-31T17:00:00.000Z",
  });
  assert.deepEqual(getCustomerDateRange("last_year", now), {
    from: "2024-12-31T17:00:00.000Z",
    toExclusive: "2025-12-31T17:00:00.000Z",
  });
});
