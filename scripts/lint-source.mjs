import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensions = new Set([".js", ".jsx", ".ts"]);
const ignored = new Set(["node_modules", "dist", "dist_check", ".git", "backup"]);
const files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.includes(".timestamp-")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
}

await walk(root);
const failures = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  try {
    parse(source, {
      sourceType: "module",
      plugins: [
        ...(file.endsWith(".jsx") ? ["jsx"] : []),
        ...(file.endsWith(".ts") ? ["typescript"] : []),
      ],
    });
  } catch (error) {
    failures.push(`${relative(root, file)}:${error.loc?.line || "?"}:${error.loc?.column || "?"} ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Parsed ${files.length} source files successfully.`);
