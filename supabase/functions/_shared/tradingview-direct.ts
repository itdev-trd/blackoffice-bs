// supabase/functions/_shared/tradingview-direct.ts
// ยิง TradingView ตรงจาก Supabase Edge — ใช้แทน n8n
//
// ทำไมเคยต้องมี n8n: คอมเมนต์เดิมใน tradingview/index.ts อ้างว่า Deno ส่ง header "Cookie" ไม่ได้
// พิสูจน์แล้วว่าไม่จริง — ทดสอบด้วย edge function ชั่วคราวยิงหาตัวเอง header ไปถึงครบทั้งค่า
// (supabase-edge-runtime 1.74.4 / Deno 2.1.4) ข้อห้าม Cookie เป็นกฎของเบราว์เซอร์ ไม่ใช่ของ Deno
//
// TradingView ไม่มี public API สำหรับจัดการสิทธิ์ invite-only script — ทั้งหมดนี้เป็น endpoint ภายใน
// ตัวเดียวกับที่หน้า "Manage access" ของเว็บมันเองเรียก จึงยืนยันตัวตนด้วย session cookie อย่างเดียว
// ผลที่ตามมา: TradingView เปลี่ยนเมื่อไหร่ก็พังได้โดยไม่แจ้งล่วงหน้า — ทุกฟังก์ชันจึงคืน error
// เป็นข้อความอ่านออก และผู้เรียกต้องบันทึกลง tv_api_log เสมอ

const TV_BASE_DEFAULT = "https://www.tradingview.com";

export type TvCookie = { sessionid?: string; sign?: string; tv_base?: string };
export type TvResult = {
  ok: boolean;
  error?: string;
  endpoint: string;
  http_status?: number;
  /** เนื้อคำตอบแบบย่อ ไว้ลง log — ตัดที่ 2000 ตัวกันตารางบวม */
  raw?: string;
  /** เนื้อคำตอบเต็ม สำหรับ parse เท่านั้น — ห้ามเอาไปลง log หรือส่งออกหน้าเว็บ
      (เคยพลาด: เอา raw ที่ตัดแล้วไป JSON.parse คำตอบที่มีรูป base64 20 คนเลยพังทุกครั้ง) */
  _full?: string;
  [k: string]: unknown;
};

// tv_base เป็นช่องกรอกอิสระในหน้าตั้งค่า (มีไว้เผื่อโดเมนสำรองของ TradingView)
// ถ้ากรอกอะไรที่ไม่ใช่ URL เช่นเผลอใส่ชื่อแบรนด์ จะได้ error "Invalid URL: 'besight/pine_perm/...'"
// ซึ่งอ่านแล้วไม่รู้เลยว่าต้องไปแก้ตรงไหน — จึงรับเฉพาะ http(s) URL ที่ parse ได้จริง
// นอกนั้นถอยไปใช้โดเมนมาตรฐาน ดีกว่าปล่อยให้พังทั้งระบบเพราะพิมพ์ผิดช่องเดียว
function baseOf(cookie: TvCookie) {
  const raw = String(cookie.tv_base || "").trim();
  if (!raw) return TV_BASE_DEFAULT;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
  } catch { /* ไม่ใช่ URL — ใช้ค่ามาตรฐานแทน */ }
  return TV_BASE_DEFAULT;
}

function headersFor(cookie: TvCookie, base: string): HeadersInit {
  if (!cookie.sessionid) throw new Error("ยังไม่ได้ตั้งค่าคุกกี้ TradingView ของแบรนด์นี้");
  // sessionid_sign เป็นของบัญชีรุ่นใหม่ บางบัญชีไม่มี — ใส่เฉพาะเมื่อมี
  const cookieStr = [
    `sessionid=${cookie.sessionid}`,
    cookie.sign ? `sessionid_sign=${cookie.sign}` : "",
  ].filter(Boolean).join("; ");
  return {
    cookie: cookieStr,
    origin: base,
    referer: `${base}/`,
    // TradingView ปฏิเสธ request ที่ไม่มี user-agent แบบเบราว์เซอร์
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
}

/** ยิงจริง + จับ error ทุกแบบให้กลายเป็น TvResult ไม่ throw ออกไปให้ผู้เรียกเดา */
async function post(base: string, path: string, cookie: TvCookie, form: Record<string, string>): Promise<TvResult> {
  const endpoint = `${base}${path}`;
  const body = new URLSearchParams(form).toString();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { ...headersFor(cookie, base), "content-type": "application/x-www-form-urlencoded" },
      body,
      // กันค้าง — ปล่อยไว้จะลาก edge function ไปตายพร้อมกัน
      signal: AbortSignal.timeout(20_000),
    });
    const full = await res.text();
    const raw = full.slice(0, 2000);
    // ถูกเด้งไปหน้า login = คุกกี้หมดอายุ ซึ่งเป็นสาเหตุที่เจอบ่อยที่สุด บอกให้ตรงจุด
    if (res.status === 401 || res.status === 403 || /"detail":\s*"[^"]*[Aa]uth/.test(raw)) {
      return { ok: false, endpoint, http_status: res.status, raw, _full: full, error: "คุกกี้ TradingView หมดอายุหรือใช้ไม่ได้ — ต้องใส่ใหม่ในหน้าตั้งค่า" };
    }
    if (!res.ok) return { ok: false, endpoint, http_status: res.status, raw, _full: full, error: `TradingView ตอบ ${res.status}` };
    return { ok: true, endpoint, http_status: res.status, raw, _full: full };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "TradingView ไม่ตอบใน 20 วินาที" : e.message) : String(e);
    return { ok: false, endpoint, error: msg };
  }
}

async function get(base: string, path: string, cookie: TvCookie): Promise<TvResult> {
  const endpoint = `${base}${path}`;
  try {
    const res = await fetch(endpoint, { headers: headersFor(cookie, base), signal: AbortSignal.timeout(20_000) });
    const full = await res.text();
    const raw = full.slice(0, 2000);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, endpoint, http_status: res.status, raw, _full: full, error: "คุกกี้ TradingView หมดอายุหรือใช้ไม่ได้" };
    }
    return { ok: res.ok, endpoint, http_status: res.status, raw, _full: full, error: res.ok ? undefined : `TradingView ตอบ ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "TradingView ไม่ตอบใน 20 วินาที" : e.message) : String(e);
    return { ok: false, endpoint, error: msg };
  }
}

const parse = (raw?: string) => { try { return JSON.parse(raw || ""); } catch { return null; } };

// ---------- action ----------

/** มี username นี้อยู่จริงไหม + คืนตัวสะกดที่ถูกต้องจาก TradingView */
export async function tvValidate(username: string, cookie: TvCookie): Promise<TvResult> {
  const base = baseOf(cookie);
  const r = await get(base, `/username_hint/?s=${encodeURIComponent(username)}`, cookie);
  if (!r.ok) return { ...r, exists: false };
  const list = parse(r._full);
  if (!Array.isArray(list)) return { ...r, ok: false, exists: false, error: "อ่านคำตอบจาก TradingView ไม่ได้" };
  // เทียบแบบไม่สนตัวพิมพ์ แล้วคืนตัวสะกดจริงของ TradingView กลับไปใช้ต่อ
  const hit = list.find((u: any) => String(u?.username || "").toLowerCase() === username.toLowerCase());
  return { ...r, exists: !!hit, username: hit?.username || username };
}

/**
 * รายชื่อคนที่มีสิทธิ์ในสคริปต์นี้ — ต้องได้ครบทุกคน
 *
 * TradingView ใช้ cursor pagination: คำตอบมี { results, next } โดย next เป็น path พร้อม ?c=<cursor>
 * ทดลองแล้วพบว่า (วัดจริงกับ endpoint จริง):
 *   · limit=50 หรือ 100 → 400 bad_pagination_request · หน้าละ 20 คือค่าที่ให้มา
 *   · offset / page ถูกเพิกเฉยทั้งคู่ — ส่งไปก็คืนหน้าเดิม จึงห้ามใช้เลื่อนหน้า
 *   · ไม่มีฟิลด์ count บอกยอดรวม ต้องเดินจนกว่า next จะเป็น null เท่านั้น
 * เหตุที่ต้องได้ครบ: sync เอาผลนี้ไป "แทนที่" snapshot ทั้งชุด ถ้าขาดคนที่อยู่หน้าหลัง
 * พวกเขาจะหายจากฐานทั้งที่ยังมีสิทธิ์จริง — จึงคืน complete = true เฉพาะตอนเดินจบจริง
 */
export async function tvListUsers(pineId: string, cookie: TvCookie, username?: string): Promise<TvResult> {
  const base = baseOf(cookie);
  const MAX_PAGES = 500;   // 500 × 20 = 10,000 คน เผื่อโตอีกนาน

  // เช็คคนเดียว ไม่ต้องไล่หน้า
  if (username) {
    const r = await post(base, `/pine_perm/list_users/?order_by=-created`, cookie, { pine_id: pineId, username });
    if (!r.ok) return r;
    const j = parse(r._full);
    return { ...r, users: j?.results ?? [], total: (j?.results ?? []).length, complete: true, pages: 1 };
  }

  const all: any[] = [];
  let path = `/pine_perm/list_users/?order_by=-created`;
  let pages = 0;
  let last: TvResult | null = null;

  while (pages < MAX_PAGES) {
    const r = await post(base, path, cookie, { pine_id: pineId });
    last = r;
    if (!r.ok) return { ...r, users: all, total: all.length, complete: false, pages };
    const j = parse(r._full);
    if (!j || !Array.isArray(j.results)) {
      return { ...r, ok: false, users: all, total: all.length, complete: false, pages, error: "อ่านรายชื่อจาก TradingView ไม่ได้" };
    }
    all.push(...j.results);
    pages++;
    const next = j.next ? String(j.next) : "";
    if (!next) return { ...r, users: all, total: all.length, complete: true, pages };   // เดินจบแล้ว
    path = next.startsWith("http") ? new URL(next).pathname + new URL(next).search : next;
  }

  // ชนเพดานก่อนเจอ next = null → ถือว่าไม่ครบ ปล่อยให้ sync ปฏิเสธดีกว่าเขียนทับแล้วคนหาย
  return { ...(last as TvResult), users: all, total: all.length, complete: false, pages,
           ok: false, error: `รายชื่อยาวเกิน ${MAX_PAGES} หน้า — ดึงไม่ครบ จึงไม่อัปเดตเพื่อกันข้อมูลหาย` };
}

export async function tvCheckAccess(username: string, pineId: string, cookie: TvCookie): Promise<TvResult> {
  const r = await tvListUsers(pineId, cookie, username);
  if (!r.ok) return { ...r, has_access: false };
  const users = (r.users as any[]) || [];
  const hit = users.find((u) => String(u?.username || "").toLowerCase() === username.toLowerCase());
  return { ...r, has_access: !!hit, expiration: hit?.expiration ?? null };
}

/** ให้สิทธิ์ · expiration = null คือตลอดชีพ */
export async function tvGrant(username: string, pineId: string, expiration: string | null, cookie: TvCookie): Promise<TvResult> {
  const base = baseOf(cookie);
  const form: Record<string, string> = { pine_id: pineId, username_recip: username };
  if (expiration) form.expiration = expiration;
  const r = await post(base, "/pine_perm/add/", cookie, form);
  if (!r.ok) return r;
  const j = parse(r._full);
  // TradingView ตอบ status เป็นข้อความ — ของจริงคือ "exists" (มี s) แปลว่ามีสิทธิ์อยู่แล้ว = สำเร็จ ไม่ใช่ error
  // เดิมผมเขียน "exist" ไม่มี s ทำให้เคสที่ปกติที่สุด (ให้สิทธิ์ซ้ำ) ถูกรายงานว่าล้มเหลว
  const st = String(j?.status || "").toLowerCase();
  if (st && !["ok", "success", "exist", "exists", "created", "updated"].includes(st)) {
    return { ...r, ok: false, error: `TradingView ปฏิเสธ: ${j?.status}` };
  }
  return { ...r, already: st === "exist" || st === "exists" };
}

export async function tvRevoke(username: string, pineId: string, cookie: TvCookie): Promise<TvResult> {
  const base = baseOf(cookie);
  const r = await post(base, "/pine_perm/remove/", cookie, { pine_id: pineId, username_recip: username });
  if (!r.ok) return r;
  const j = parse(r._full);
  const st = String(j?.status || "").toLowerCase();
  // "not_exists" = ไม่มีสิทธิ์อยู่แล้ว ซึ่งผลลัพธ์สุดท้ายตรงกับที่ต้องการ ถือว่าสำเร็จ
  if (st && !["ok", "success", "removed", "not_exists", "notexists"].includes(st)) {
    return { ...r, ok: false, error: `TradingView ปฏิเสธ: ${j?.status}` };
  }
  return r;
}

/** คุกกี้ยังใช้ได้อยู่ไหม — ใช้สคริปต์ตัวใดตัวหนึ่งเป็นตัวทดสอบ */
export async function tvPing(pineId: string, cookie: TvCookie): Promise<TvResult> {
  if (!cookie.sessionid) return { ok: false, endpoint: "-", error: "ยังไม่ได้ใส่คุกกี้ TradingView" };
  if (!pineId) return { ok: false, endpoint: "-", error: "ยังไม่มีสคริปต์ในแบรนด์นี้ให้ใช้ทดสอบ" };
  const r = await tvListUsers(pineId, cookie);
  return { ...r, logged_in: r.ok };
}
