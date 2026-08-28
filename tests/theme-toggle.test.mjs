import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../ai-ads-app.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("theme toggle persists and updates the document theme", () => {
  assert.match(app, /localStorage\.setItem\("ui\.theme", theme\)/);
  assert.match(app, /root\.classList\.toggle\("theme-light", theme === "light"\)/);
  assert.match(app, /function ThemeToggle\(\)/);
  assert.match(app, /aria-label=\{light \? "เปลี่ยนเป็นธีมมืด" : "เปลี่ยนเป็นธีมสว่าง"\}/);
});

test("light theme loads before React and defines shared light tokens", () => {
  assert.match(html, /localStorage\.getItem\("ui\.theme"\) === "light"/);
  assert.match(css, /html\.theme-light \{/);
  assert.match(css, /--bg: #F4F7FB/);
  assert.match(css, /html\.theme-light \.customer-export-modal-panel/);
  assert.match(css, /html\.theme-light \.knowledge-manual-card/);
  assert.match(css, /html\.theme-light \.chat-compose-guide/);
});

test("light theme keeps gold admin bubbles and leaderboard avatars readable", () => {
  assert.match(css, /html\.theme-light \.chat-bubble-me,[\s\S]*color: #3B2800 !important/);
  assert.match(app, /fontSize: m\.av \* 0\.3, color: "#F8FAFC"/);
  assert.match(css, /html\.theme-light \.text-slate-300,[\s\S]*color: #0F172A !important/);
  assert.match(app, /WebkitTextFillColor: isLight \? "#0F172A" : "transparent"/);
});
