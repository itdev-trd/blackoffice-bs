// ============================================================
// n8n: แจ้งเตือน "คุกกี้ TradingView หมดอายุ" ไปทาง Telegram (รองรับหลายแบรนด์)
// ------------------------------------------------------------
// วิธีตั้ง workflow ใหม่ใน n8n:
//   1) Schedule Trigger  (เช่น ทุก 6 ชั่วโมง)  →  2) Code node (วางโค้ดนี้ทั้งหมด)
//   โหมด Code node: "Run Once for All Items"
//
// โค้ดนี้จะ:
//   - ดึงแบรนด์ที่ active + คุกกี้ (sessionid/sign) จาก Supabase (ตาราง tv_brands / app_secrets)
//   - ยิงเช็คกับ TradingView ต่อแบรนด์ว่ายังล็อกอินอยู่ไหม
//   - ถ้ามีแบรนด์ไหนคุกกี้หมดอายุ/ล็อกอินไม่ได้ → ส่งข้อความเตือนไป Telegram
//
// *** เติมค่า CONFIG 4 ตัวด้านล่างให้ครบก่อนใช้งาน ***
// ============================================================

const SUPABASE_URL         = 'https://xxxxxxxx.supabase.co';   // Project URL (Supabase → Settings → API)
const SUPABASE_SERVICE_KEY = 'ใส่_service_role_key';            // service_role key (ห้ามใช้ anon) — เก็บเป็นความลับ
const TELEGRAM_BOT_TOKEN   = 'ใส่_telegram_bot_token';          // จาก @BotFather
const TELEGRAM_CHAT_ID     = 'ใส่_chat_id';                     // chat id / group id ที่จะรับแจ้งเตือน
const DEFAULT_TV_BASE      = 'https://www.tradingview.com';
const ALERT_WHEN_OK        = false;                            // true = ส่งข้อความทุกครั้งแม้ปกติ (ไว้ทดสอบ)

const H = this.helpers;
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36';

// ---- helper: ยิง Supabase REST ด้วย service role (bypass RLS) ----
async function sb(path) {
  return await H.httpRequest({
    method: 'GET',
    url: SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY },
    json: true, ignoreHttpStatusErrors: true,
  });
}

// ---- helper: เช็คว่าคุกกี้ยังล็อกอิน TradingView อยู่ไหม ----
async function isAuthed(cookieStr, base, pineId) {
  const headers = {
    cookie: cookieStr,
    accept: 'application/json, text/javascript, */*; q=0.01',
    origin: base, referer: base + '/',
    'x-requested-with': 'XMLHttpRequest',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'user-agent': UA,
  };
  // ใช้ pine_perm/list_users (แม่นกว่ายิงหน้าแรก) ถ้ามี pine ของแบรนด์
  const r = await H.httpRequest({
    method: 'POST',
    url: base + '/pine_perm/list_users/?limit=1&order_by=-created',
    headers, body: 'pine_id=' + encodeURIComponent(pineId || ''),
    returnFullResponse: true, ignoreHttpStatusErrors: true,
  });
  const t = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || '');
  return r.statusCode >= 200 && r.statusCode < 300 && !/is-not-authenticated/i.test(t) && !/<!DOCTYPE/i.test(t);
}

// ---- main ----
const brands = await sb('tv_brands?select=id,name&active=eq.true&order=created_at');
const expired = [];   // แบรนด์ที่คุกกี้หมดอายุ/ยังไม่ตั้ง
const errors  = [];   // เช็คไม่ได้ (network/อื่นๆ)

for (const b of (Array.isArray(brands) ? brands : [])) {
  try {
    const sec = await sb('app_secrets?select=value&key=eq.tv_cookie_' + b.id);
    let ck = {};
    try { ck = JSON.parse((sec && sec[0] && sec[0].value) || '{}'); } catch (e) { /* ignore */ }
    if (!ck.sessionid) { expired.push(b.name + ' (ยังไม่ได้ตั้งคุกกี้)'); continue; }

    const cookieStr = 'sessionid=' + ck.sessionid + (ck.sign ? '; sessionid_sign=' + ck.sign : '');
    const base = (ck.tv_base || DEFAULT_TV_BASE).trim().replace(/\/$/, '') || DEFAULT_TV_BASE;
    const sc = await sb('tv_scripts?select=pine_id&brand_id=eq.' + b.id + '&limit=1');
    const pineId = sc && sc[0] && sc[0].pine_id;

    const ok = await isAuthed(cookieStr, base, pineId);
    if (!ok) expired.push(b.name);
  } catch (e) {
    errors.push(b.name + ': ' + (e && e.message ? e.message : String(e)));
  }
}

// ---- ประกอบข้อความ + ส่ง Telegram ----
let msg = '';
if (expired.length) {
  msg = '⚠️ คุกกี้ TradingView หมดอายุ/ล็อกอินไม่ได้:\n• ' + expired.join('\n• ')
      + '\n\nอัปเดตคุกกี้ที่: แอป → ตั้งค่า → ตั้งค่า TV (แก้ไขแบรนด์)';
} else if (ALERT_WHEN_OK) {
  msg = '✅ คุกกี้ TradingView ปกติทุกแบรนด์ (' + (Array.isArray(brands) ? brands.length : 0) + ')';
}
if (errors.length) msg += (msg ? '\n\n' : '') + '❗ เช็คไม่ได้:\n• ' + errors.join('\n• ');

if (msg) {
  await H.httpRequest({
    method: 'POST',
    url: 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage',
    body: { chat_id: TELEGRAM_CHAT_ID, text: msg, disable_web_page_preview: true },
    json: true, ignoreHttpStatusErrors: true,
  });
}

return [{ json: { checked: Array.isArray(brands) ? brands.length : 0, expired, errors, sent: !!msg } }];
