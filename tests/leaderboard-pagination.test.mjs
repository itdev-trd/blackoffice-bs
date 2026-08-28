import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/leaderboard/index.ts", import.meta.url), "utf8");

test("leaderboard paginates reply_stats instead of truncating recent rows", () => {
  assert.match(source, /const PAGE_SIZE = 1000/);
  assert.match(source, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
  assert.match(source, /if \(rows\.length < PAGE_SIZE\) break/);
  assert.doesNotMatch(source, /\.limit\(20000\)/);
});

