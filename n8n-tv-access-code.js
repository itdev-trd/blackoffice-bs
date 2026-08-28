// ===== TV Access: รับคำสั่ง grant/revoke จากแอป แล้วยิง TradingView =====
const H = this.helpers;
const cfg = $('Config').first().json;
const body = ($('Webhook').first().json.body) || {};

// คุกกี้: ใช้จาก payload ที่แอปส่งมา (ต่อแบรนด์) ก่อน ถ้าไม่มีค่อย fallback ไป Config เดิม
const sessionid = ((body.sessionid || cfg.sessionid) || '').trim();
const sign = ((body.sessionid_sign || cfg.sessionid_sign) || '').trim();
const secret = (cfg.secret||'').trim();
const cookie = 'sessionid=' + sessionid + (sign ? '; sessionid_sign=' + sign : '');

const BASE = (((body.tv_base || cfg.tv_base || 'https://www.tradingview.com').trim().replace(/\/$/,'')) || 'https://www.tradingview.com');
const TV = {
  hint: BASE+'/username_hint/',
  list: BASE+'/pine_perm/list_users/',
  add:  BASE+'/pine_perm/add/',       // endpoint จริงจาก cURL (ไม่ใช่ add_access)
  modify: BASE+'/pine_perm/modify/',
  remove: BASE+'/pine_perm/remove/',
};
// เลียนแบบ header ที่ browser ของ TradingView ส่งเป๊ะ
const TVH = { cookie, accept:'application/json, text/javascript, */*; q=0.01', origin: BASE, referer: BASE+'/', 'x-requested-with':'XMLHttpRequest', 'x-language':'th_TH',
  'user-agent':'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36' };
const TVF = { ...TVH, 'content-type':'application/x-www-form-urlencoded; charset=UTF-8' };

const out = (o) => [{ json:o }];
const qs = (o) => Object.keys(o).map(k => encodeURIComponent(k)+'='+encodeURIComponent(o[k])).join('&');
// สร้าง multipart/form-data เอง (add/remove ของ TradingView ใช้ multipart)
function multipart(fields){
  const b = '----n8nFB' + Math.random().toString(16).slice(2);
  let s = '';
  for (const k in fields){ s += '--'+b+'\r\nContent-Disposition: form-data; name="'+k+'"\r\n\r\n'+fields[k]+'\r\n'; }
  s += '--'+b+'--\r\n';
  return { ct:'multipart/form-data; boundary='+b, body:s };
}
const bodyText = (r) => typeof r.body==='string' ? r.body : JSON.stringify(r.body||'');
const authFail = (t) => /is-not-authenticated/i.test(t);
async function req(opts){ return H.httpRequest({ ...opts, returnFullResponse:true, ignoreHttpStatusErrors:true }); }

if (secret && body.secret !== secret) return out({ ok:false, error:'unauthorized (secret ไม่ตรง)' });

const action = body.action;
const username = (body.username||'').trim();
const pineId = (body.pine_id||'').trim();
const expiration = body.expiration || null;

async function validate(u){
  const r = await req({ method:'GET', url:TV.hint, qs:{s:u}, headers:TVH });
  let arr=[]; try { arr = typeof r.body==='string'?JSON.parse(r.body):r.body; } catch(e){}
  for (const x of (arr||[])) if ((x.username||'').toLowerCase()===u.toLowerCase()) return x.username;
  return null;
}
async function grant(user, pine, exp){
  const fields = { pine_id: pine, username_recip: user };
  if (exp) fields.expiration = exp;
  const doAdd = async () => { const mp = multipart(fields); const r = await req({ method:'POST', url:TV.add, headers:{ ...TVH, 'content-type':mp.ct }, body:mp.body }); return { r, t: bodyText(r) }; };
  let { r, t } = await doAdd();
  // ถ้ามีสิทธิ์อยู่แล้ว (add ตอบ "exists") วันหมดอายุจะไม่อัปเดต → ลบก่อนแล้วเพิ่มใหม่ให้วันหมดอายุเปลี่ยนจริง
  if (/exist/i.test(t)) {
    const mpr = multipart({ pine_id: pine, username_recip: user });
    await req({ method:'POST', url:TV.remove, headers:{ ...TVH, 'content-type':mpr.ct }, body:mpr.body });
    ({ r, t } = await doAdd());
  }
  const ok = r.statusCode>=200 && r.statusCode<300 && !/is-not-authenticated|error/i.test(t);
  return { ok, action:'add', status_code:r.statusCode, response:t.slice(0,220), error: ok?undefined:('add HTTP '+r.statusCode+': '+t.slice(0,200)) };
}
async function revoke(user, pine){
  const mp = multipart({ pine_id:pine, username_recip:user });
  const r = await req({ method:'POST', url:TV.remove, headers:{ ...TVH, 'content-type':mp.ct }, body:mp.body });
  const t = bodyText(r);
  const ok = r.statusCode>=200 && r.statusCode<300;
  return { ok, action:'remove', status_code:r.statusCode, response:t.slice(0,220), error: ok?undefined:('remove HTTP '+r.statusCode+': '+t.slice(0,200)) };
}
// อ่านรายการสิทธิ์จาก TradingView แล้วตรวจชื่อแบบตรงตัว (ไม่เดาจากสถานะในแอป)
function collectUsers(value, out=[], depth=0){
  if (depth > 6 || value == null) return out;
  if (Array.isArray(value)) { for (const item of value) collectUsers(item, out, depth+1); return out; }
  if (typeof value !== 'object') return out;
  if (typeof value.username === 'string' || typeof value.user === 'string') out.push(value);
  const keys = ['users','rows','data','results','items','entries','permissions','recipients'];
  let traversed = false;
  for (const key of keys) if (value[key] != null) { traversed = true; collectUsers(value[key], out, depth+1); }
  // รองรับรูปแบบ response ที่ TradingView เปลี่ยนชื่อฟิลด์ โดยไม่ผูกกับ key เดียว
  if (!traversed) for (const child of Object.values(value)) collectUsers(child, out, depth+1);
  return out;
}
const userName = (x) => String(x?.username || x?.user || x?.name || '').trim();
const userExpiration = (x) => x?.expiration ?? x?.expires_at ?? x?.expiresAt ?? null;
// TradingView ส่งวันที่เพิ่มสิทธิ์ในฟิลด์ created (บางรุ่นใช้ชื่ออื่น)
// เก็บค่าดิบไว้ให้ Supabase แปลงเป็น ISO และไม่เดาวันที่จากเวลาซิงก์
const userGrantedAt = (x) => x?.created ?? x?.created_at ?? x?.createdAt ?? x?.granted_at ?? x?.grantedAt ?? null;
const paginationTotal = (value) => {
  const candidates = [value?.total, value?.count, value?.total_count, value?.totalCount,
    value?.pagination?.total, value?.pagination?.count, value?.meta?.total, value?.data?.total];
  for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n >= 0) return n; }
  return null;
};
// ดึงรายชื่อสิทธิ์ครบต่อ Pine Script สำหรับงานซิงก์กลางคืน
// ถ้าปลายทางไม่รองรับ offset หรือข้อมูลเกินขนาดที่อ่านได้ จะคืน complete=false
// เพื่อให้ฝั่ง Supabase ไม่เผลอสรุปว่าคนที่หายไปถูกถอนสิทธิ์
async function listAccess(pine){
  let limit = 100;
  let offset = 0;
  let total = null;
  let complete = false;
  let pages = 0;
  const all = [];
  const seen = new Set();
  while (pages < 100) {
    let r;
    for (const candidate of [limit, 50, 25, 10, 1]) {
      r = await req({ method:'POST', url:TV.list, qs:{limit:candidate, offset, order_by:'-created'}, headers:TVF, body:qs({pine_id:pine}) });
      const t = bodyText(r);
      if (!(r.statusCode === 400 && /bad_pagination_request/i.test(t))) { limit = candidate; break; }
    }
    const t = bodyText(r);
    const ok = r.statusCode>=200 && r.statusCode<300 && !authFail(t) && !/<!DOCTYPE/i.test(t);
    if (!ok) return { ok:false, status_code:r.statusCode, error:'list_users HTTP '+r.statusCode+': '+t.slice(0,220) };
    let parsed;
    try { parsed = typeof r.body==='string' ? JSON.parse(r.body) : r.body; }
    catch(e) { return { ok:false, error:'TradingView ตอบข้อมูลรายการสิทธิ์ไม่ใช่ JSON' }; }
    const rows = collectUsers(parsed);
    total = paginationTotal(parsed) ?? total;
    let added = 0;
    for (const row of rows) {
      const key = userName(row).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); all.push(row); added++;
    }
    pages++;
    if (total != null && all.length >= total) { complete = true; break; }
    if (rows.length < limit || rows.length === 0) { complete = true; break; }
    // บางรุ่นของ endpoint ไม่สนใจ offset: หยุดแบบปลอดภัยแทนการมาร์คผู้ใช้ที่เหลือว่าถูกถอน
    if (added === 0) break;
    offset += rows.length;
  }
  return { ok:true, users:all, complete, total, pages };
}
async function checkAccess(user, pine){
  // ใช้ pagination เดียวกับงานซิงก์ เพื่อให้ตรวจเจอสมาชิกเก่าที่ไม่อยู่หน้าแรกด้วย
  const listed = await listAccess(pine);
  if (!listed.ok) return { ...listed, action:'check_access' };
  const rows = listed.users || [];
  const wanted = user.toLowerCase();
  const matched = rows.find((x) => userName(x).toLowerCase() === wanted) || null;
  const found = !!matched;
  if (!found && listed.complete !== true) return { ok:false, action:'check_access', error:'TradingView ส่งรายการมาไม่ครบ จึงยืนยันว่าไม่พบสิทธิ์ไม่ได้' };
  return { ok:true, action:'check_access', found, username:user, pine_id:pine, matched_count:rows.length,
    ...(matched && userGrantedAt(matched) != null ? { tv_granted_at:userGrantedAt(matched) } : {}) };
}

try {
  if (action==='ping') {
    const dbg = { sid_len: sessionid.length, sign_len: sign.length };
    if (pineId) {
      const r = await req({ method:'POST', url:TV.list, qs:{limit:1,order_by:'-created'}, headers:TVF, body:qs({pine_id:pineId}) });
      const t = bodyText(r);
      const authed = r.statusCode>=200 && r.statusCode<300 && !authFail(t) && !/<!DOCTYPE/i.test(t);
      return out({ ok:true, authed, status_code:r.statusCode, sample:t.slice(0,180), ...dbg });
    }
    const r = await req({ method:'GET', url:BASE+'/', headers:TVH });
    return out({ ok:true, authed: !authFail(bodyText(r)), ...dbg });
  }
  if (action==='validate') { const v = await validate(username); return out({ ok:!!v, username:v }); }
  if (action==='grant') {
    if (!username || !pineId) return out({ ok:false, error:'ต้องมี username และ pine_id' });
    const v = await validate(username);
    if (!v) return out({ ok:false, error:'ไม่พบ username "'+username+'" บน TradingView' });
    const res = await grant(v, pineId, expiration);
    return out({ ...res, username:v, pine_id:pineId });
  }
  if (action==='check_access') {
    if (!username || !pineId) return out({ ok:false, error:'ต้องมี username และ pine_id' });
    return out(await checkAccess(username, pineId));
  }
  if (action==='list_users') {
    if (!pineId) return out({ ok:false, action:'list_users', error:'ต้องมี pine_id' });
    const res = await listAccess(pineId);
    if (!res.ok) return out({ ...res, action:'list_users', pine_id:pineId });
    return out({ ok:true, action:'list_users', pine_id:pineId, complete:res.complete, total:res.total,
      pages:res.pages, users:res.users.map((x) => ({ username:userName(x), expiration:userExpiration(x), tv_granted_at:userGrantedAt(x) })).filter((x) => x.username) });
  }
  if (action==='revoke') {
    if (!username || !pineId) return out({ ok:false, error:'ต้องมี username และ pine_id' });
    const v = (await validate(username)) || username;
    const res = await revoke(v, pineId);
    return out({ ...res, username:v, pine_id:pineId });
  }
  return out({ ok:false, error:'unknown action' });
} catch(e) {
  return out({ ok:false, error:'exception: '+e.message });
}
