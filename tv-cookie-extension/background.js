// TV Cookie Sync — อ่านคุกกี้ TradingView (sessionid/sessionid_sign) แล้วยิงเข้าระบบอัตโนมัติ
// ตั้งค่า Endpoint URL + Token ได้ที่ป๊อปอัพของ extension (คลิกไอคอน)

const TV_URL = "https://www.tradingview.com";

async function getCfg() {
  return await chrome.storage.local.get(["url", "token"]);
}

async function readTvCookies() {
  // chrome.cookies อ่านคุกกี้ HttpOnly ได้ (ต่างจาก document.cookie)
  const sid = await chrome.cookies.get({ url: TV_URL, name: "sessionid" });
  const sign = await chrome.cookies.get({ url: TV_URL, name: "sessionid_sign" });
  return { sessionid: (sid && sid.value) || "", sessionid_sign: (sign && sign.value) || "" };
}

async function sendCookies(reason) {
  const { url, token } = await getCfg();
  if (!url || !token) { await setStatus(false, reason, "ยังไม่ได้ตั้งค่า URL/Token"); return { ok: false, error: "no config" }; }
  const c = await readTvCookies();
  if (!c.sessionid) { await setStatus(false, reason, "ยังไม่มี sessionid (ยังไม่ได้ล็อกอิน TradingView?)"); return { ok: false, error: "no cookie" }; }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "ingest_cookie", token, sessionid: c.sessionid, sessionid_sign: c.sessionid_sign }),
    });
    const j = await r.json().catch(() => ({}));
    await setStatus(!!j.ok, reason, j.ok ? "" : (j.error || ("HTTP " + r.status)));
    return j;
  } catch (e) {
    await setStatus(false, reason, String(e && e.message ? e.message : e));
    return { ok: false, error: String(e) };
  }
}

async function setStatus(ok, reason, error) {
  await chrome.storage.local.set({ lastSync: { at: Date.now(), ok, reason, error } });
  try { chrome.action.setBadgeText({ text: ok ? "✓" : "!" }); chrome.action.setBadgeBackgroundColor({ color: ok ? "#16a34a" : "#dc2626" }); } catch (e) {}
}

// auto: เมื่อคุกกี้ sessionid ของ TradingView ถูกตั้ง/เปลี่ยน (= เพิ่งล็อกอิน) → ส่งอัตโนมัติ (หน่วง 3 วิ กันยิงรัว)
let debounce = null;
chrome.cookies.onChanged.addListener((info) => {
  if (info.removed) return;
  const dom = (info.cookie && info.cookie.domain ? info.cookie.domain : "").replace(/^\./, "");
  if (!/(^|\.)tradingview\.com$/i.test(dom)) return;
  if (!info.cookie || info.cookie.name !== "sessionid") return;
  clearTimeout(debounce);
  debounce = setTimeout(() => sendCookies("auto"), 3000);
});

// ปุ่ม "ส่งเดี๋ยวนี้" จากป๊อปอัพ
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "send-now") { sendCookies("manual").then(reply); return true; }
});
