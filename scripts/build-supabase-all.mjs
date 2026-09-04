// สร้าง supabase-all.sql (ไฟล์เดียวจบสำหรับตั้งโปรเจกต์ Supabase ใหม่) จากไฟล์ต้นทาง 3 ส่วน
//   1. supabase/legacy/01-consolidated-legacy.sql — schema + migration ยุคแรกที่รวมไว้แล้ว (แช่แข็ง ไม่แก้)
//   2. supabase/migrations/*.sql — migration ที่ Supabase CLI ดูแล เรียงตาม timestamp ในชื่อไฟล์
//   3. supabase/legacy/99-utilities.sql — สคริปต์วินิจฉัย/ซ่อมบำรุง ไว้ท้ายสุด (รันเองเป็นครั้ง ๆ ไม่ใช่ลำดับติดตั้ง)
// ห้ามแก้ supabase-all.sql ด้วยมือ — แก้ที่ต้นทางแล้วรัน `npm run build:sql`
// ใส่ --check เพื่อเช็คว่าไฟล์ตรงกับต้นทางไหม (ไม่เขียนทับ, ไม่ตรงจะ exit 1)

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const legacyDir = join(root, "supabase/legacy");
const migrationsDir = join(root, "supabase/migrations");
const target = join(root, "supabase-all.sql");
const checkOnly = process.argv.includes("--check");

const header = `-- ============================================================
-- AdFlow OS — consolidated Supabase SQL (ไฟล์นี้ถูกสร้างอัตโนมัติ ห้ามแก้ด้วยมือ)
-- ============================================================
-- สร้างด้วย: npm run build:sql  (scripts/build-supabase-all.mjs)
-- ต้นทาง: supabase/legacy/01-consolidated-legacy.sql
--         -> supabase/migrations/*.sql (เรียงตาม timestamp)
--         -> supabase/legacy/99-utilities.sql
--
-- ใช้ตอนตั้งโปรเจกต์ Supabase ใหม่: เปิด SQL Editor แล้วรันทั้งไฟล์ตามลำดับที่จัดไว้
-- ส่วน UTILITY ท้ายไฟล์เป็นสคริปต์ไว้เรียกใช้เองเป็นครั้ง ๆ ไม่ต้องรันตอนติดตั้ง
--
-- ถ้าฐานข้อมูลตั้งไว้แล้ว ให้ใช้ \`supabase db push\` กับ supabase/migrations/ ตามปกติ
-- ไฟล์นี้มีไว้สำหรับเครื่อง/โปรเจกต์ที่เริ่มจากศูนย์เท่านั้น
-- ============================================================
`;

function section(title, body) {
  return `\n-- ======================================================================\n-- ${title}\n-- ======================================================================\n\n${body.replace(/\s+$/, "")}\n`;
}

const legacy = await readFile(join(legacyDir, "01-consolidated-legacy.sql"), "utf8");
const utilities = await readFile(join(legacyDir, "99-utilities.sql"), "utf8");

const migrationNames = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const parts = [header, legacy.replace(/\s+$/, ""), ""];

parts.push(`
-- ============================================================
-- MIGRATIONS ที่ Supabase CLI ดูแล (supabase/migrations/) — รันต่อจากส่วนบน
-- ============================================================
`);

for (const name of migrationNames) {
  const body = await readFile(join(migrationsDir, name), "utf8");
  parts.push(section(`FILE: supabase/migrations/${name}`, body));
}

parts.push("\n" + utilities.replace(/\s+$/, "") + "\n");

const output = parts.join("\n").replace(/\n{3,}/g, "\n\n");

if (checkOnly) {
  const current = await readFile(target, "utf8").catch(() => null);
  if (current === output) {
    console.log(`supabase-all.sql ตรงกับต้นทางแล้ว (${migrationNames.length} migrations)`);
    process.exit(0);
  }
  console.error("supabase-all.sql ไม่ตรงกับต้นทาง — รัน `npm run build:sql` แล้ว commit ไฟล์ที่ได้");
  process.exit(1);
}

await writeFile(target, output);
console.log(
  `เขียน supabase-all.sql แล้ว: legacy + ${migrationNames.length} migrations + utilities (${output.split("\n").length} บรรทัด)`,
);
