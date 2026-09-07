"use client";
// หน้า "แอดไหนได้ลูกค้า" — ตอบคำถามว่าเงินโฆษณาที่ยิงไป แอดตัวไหนทำให้เกิดแชทและเปิดบัญชีจริง
// ที่มาของข้อมูลมี 2 ทาง (นับรวมกันในตารางเดียว แต่แยกคอลัมน์ให้เห็น):
//   1. DM จากแอด  — entry_ad_id ที่ Meta ส่งมากับ event referral ตอนลูกค้ากดจากโฆษณา
//   2. คอมเมนต์ใต้แอด — comment_ad_ids ที่ระบบ map จากโพสต์ของโฆษณา
// "เปิดบัญชีแล้ว" ใช้ stage = account_opened (ตรงกับที่แอดมินกดยืนยันในระบบ)
//
// แยก "ลูกค้าใหม่ / ลูกค้าเก่า" ด้วย: เวลากดแอดครั้งแรก เทียบกับ เวลาที่คุยกับเพจครั้งแรก
// เพราะบางแอดคนที่ทักมาคือลูกค้าที่คุยกันอยู่แล้ว ถ้านับรวมกันจะอ่านผิดว่าแอดหาคนใหม่ได้เท่าไร
// เกณฑ์เต็มอยู่ในกล่อง "ตัวเลขในหน้านี้นับมาจากไหน" ด้านล่าง และในฟังก์ชัน app_ad_chat_rooms
import { useCallback, useEffect, useState } from "react";
import { Megaphone, RefreshCw, Info, ChevronRight, ChevronDown, MessageSquare, Repeat, Sparkles, HelpCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import Spinner from "@/components/shared/Spinner";
import { EmptyState, FilterPill } from "@/components/ui";

const RANGES = [
  { key: "7", label: "7 วัน", days: 7 },
  { key: "30", label: "30 วัน", days: 30 },
  { key: "all", label: "ทั้งหมด", days: null },
];

export default function AdChatsTab({ active = true, onOpenChat }) {
  const [ads, setAds] = useState(null);
  const [totals, setTotals] = useState(null);
  const [err, setErr] = useState("");
  const [range, setRange] = useState("30");
  // รายชื่อคนที่ทักมาต่อแอด — ดึงตอนกดเปิดเท่านั้น (ไม่ดึงล่วงหน้าทุกแอด)
  const [openAd, setOpenAd] = useState(null);
  const [people, setPeople] = useState({});     // { [ad_id]: rows | "loading" | { error } }

  // รวมยอดฝั่งฐานข้อมูล (RPC) — ดึงแถวมานับเองไม่ได้เพราะ PostgREST คืนได้สูงสุด 1,000 แถว
  // ข้อมูลจะเพี้ยนเงียบ ๆ ทันทีที่ลูกค้าเกินพันคน
  const load = useCallback(async () => {
    try {
      const days = RANGES.find((r) => r.key === range)?.days ?? null;
      const [statsRes, totalsRes] = await Promise.all([
        supabase.rpc("app_ad_chat_stats", { p_days: days }),
        supabase.rpc("app_ad_chat_totals", { p_days: days }),
      ]);
      if (statsRes.error) throw statsRes.error;
      if (totalsRes.error) throw totalsRes.error;
      setAds(statsRes.data || []);
      setTotals(totalsRes.data?.[0] || { total: 0, with_ad: 0, opened: 0 });
      setPeople({});          // ช่วงเวลาเปลี่ยน = รายชื่อที่แคชไว้ใช้ไม่ได้แล้ว
      setErr("");
    } catch (e) {
      setErr(e?.message || "โหลดข้อมูลไม่สำเร็จ");
      setAds([]);
    }
  }, [range]);

  useEffect(() => { if (active) { setAds(null); load(); } }, [active, load]);

  // กดที่แถว = เปิด/ปิดรายชื่อคนที่ทักมาจากแอดนั้น
  const toggleAd = useCallback(async (adId) => {
    if (openAd === adId) { setOpenAd(null); return; }
    setOpenAd(adId);
    if (people[adId] && people[adId] !== "loading" && !people[adId]?.error) return;   // มีแล้วไม่ต้องดึงซ้ำ
    setPeople((p) => ({ ...p, [adId]: "loading" }));
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const { data, error } = await supabase.rpc("app_ad_chat_people", { p_ad_id: adId, p_days: days });
    setPeople((p) => ({ ...p, [adId]: error ? { error: error.message || "โหลดรายชื่อไม่สำเร็จ" } : (data || []) }));
  }, [openAd, people, range]);

  const fmt = (v) => (v == null ? "—" : new Date(v).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Megaphone size={18} /> แอดไหนได้ลูกค้า</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            นับจากลูกค้าที่ระบบรู้ที่มาจริง — ทักจากโฆษณา (referral) และคอมเมนต์ใต้โฆษณา
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <FilterPill key={r.key} active={range === r.key} onClick={() => setRange(r.key)}>{r.label}</FilterPill>
          ))}
          <button type="button" onClick={load} title="รีเฟรช" className="rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{err}</div>}

      {/* ที่มาของตัวเลขต้องอยู่ติดกับตัวเลข — ไม่งั้นคนอ่านรายงานเดาเอง แล้วเอาไปใช้ตัดสินใจผิด */}
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-700">
          ตัวเลขในหน้านี้นับมาจากไหน (กดเพื่อดู)
        </summary>
        <div className="space-y-2.5 border-t border-slate-100 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-600">
          <div>
            <div className="font-semibold text-slate-700">แหล่งข้อมูล</div>
            ทุกตัวเลขนับจากตาราง <span className="font-mono">chat_customers</span> (ห้องแชท/คอมเมนต์ของเราเอง)
            ไม่ได้ดึงสดจาก Meta ตอนเปิดหน้า · รวมยอดด้วยฟังก์ชันในฐานข้อมูล
            (<span className="font-mono">app_ad_chat_stats</span> / <span className="font-mono">app_ad_chat_totals</span>)
            เพราะถ้าให้หน้าเว็บนับเอง ระบบจะคืนแถวได้สูงสุด 1,000 แถว แล้วยอดจะเพี้ยนเงียบ ๆ
          </div>

          <div>
            <div className="font-semibold text-slate-700">ที่มาของ “แอด” ต่อ 1 ลูกค้า (นับแอดเดียวเท่านั้น)</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><b>ทักจากแอด</b> = ช่อง <span className="font-mono">entry_ad_id</span> ที่ Meta ส่งมาพร้อม event
                <span className="font-mono"> messaging_referrals</span> ตอนลูกค้ากดปุ่มส่งข้อความจากโฆษณา (Click-to-Messenger)</li>
              <li><b>คอมเมนต์</b> = ช่อง <span className="font-mono">comment_ad_ids</span> ตัวแรก ที่ระบบ map จากโพสต์ของโฆษณา</li>
              <li>ถ้ามีทั้งสองอย่าง ใช้ “ทักจากแอด” เป็นหลัก — กันการนับซ้ำจนยอดรวมเกินจริง</li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-700">“ลูกค้าใหม่” กับ “ลูกค้าเก่า” ตัดสินจากอะไร</div>
            เทียบ <b>เวลากดแอดครั้งแรก</b> กับ <b>เวลาที่คุยกับเพจครั้งแรก</b> ที่ระบบรู้
            (เวลาที่คุยครั้งแรก = ค่าที่เก่าสุดระหว่าง <span className="font-mono">first_customer_message_at</span>,
            <span className="font-mono"> created_at</span> ของห้อง และข้อความแรกของลูกค้าในบทสนทนา)
            <ul className="ml-4 list-disc space-y-0.5">
              <li>เรียงลำดับการตัดสิน: แท็กที่แอดมินกดเอง → เปิดบัญชีไปก่อนกดแอด → เคยคุยก่อนกดแอดเกิน 30 นาที → นอกนั้นเป็นลูกค้าใหม่</li>
              <li><b>ผ่อนผัน 30 นาที</b> เพราะ event referral จาก Meta มาช้ากว่าข้อความแรกได้จริง (วัดได้ถึง 19 นาที)
                ถ้าไม่ผ่อนผัน ลูกค้าใหม่จะถูกนับเป็นเก่า</li>
              <li>อยากแก้เป็นรายคน: เปิดห้องแชทนั้นแล้วกดแท็ก <span className="font-mono">🔁 ลูกค้าเก่า</span> หรือ
                <span className="font-mono"> 🆕 ลูกค้าใหม่</span> — แท็กชนะการคำนวณทุกกรณี</li>
              <li>เวลากดแอดใช้ “ครั้งแรก” (<span className="font-mono">first_received_at</span>) การกดซ้ำจึงไม่ทำให้กลายเป็นลูกค้าเก่า
                — ในรายชื่อจะบอกว่ากดแอดกี่ครั้ง</li>
              <li>แถวที่มาจากคอมเมนต์ไม่มีเวลากดแอด (Meta ไม่ส่งมา) จึงขึ้นเป็น “แยกไม่ได้” ไม่เดาให้เป็นใหม่</li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-700">ความหมายของแต่ละคอลัมน์</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><b>ลูกค้า</b> = จำนวนห้องที่ผูกกับแอดนั้น (กดที่แถวเพื่อดูรายชื่อว่าใครทักมา)</li>
              <li><b>ใหม่ / เก่า</b> = แยกตามเกณฑ์ข้างบน · เลข <span className="font-mono">+n?</span> ข้างช่อง “เก่า” คือจำนวนที่แยกไม่ได้</li>
              <li><b>% ปิดได้ (ใหม่)</b> = เปิดบัญชีของลูกค้าใหม่ ÷ ลูกค้าใหม่ — ไม่เอาลูกค้าเก่ามาปั่นเปอร์เซ็นต์ของแอด</li>
              <li><b>เปิดบัญชี</b> = ห้องที่สถานะเป็น <span className="font-mono">account_opened</span> ซึ่งแอดมินกดยืนยันเองในระบบ (ไม่ใช่ AI เดา)</li>
              <li><b>ค้างตอบ</b> = ห้องที่ข้อความล่าสุดยังเป็นของลูกค้า (<span className="font-mono">awaiting_reply</span>)</li>
              <li><b>ล่าสุด</b> = เวลาข้อความล่าสุดในห้องของแอดนั้น</li>
              <li><b>ช่วงเวลา 7/30 วัน</b> นับจาก <span className="font-mono">created_at</span> = วันที่ลูกค้าเข้าระบบเรา ไม่ใช่วันที่ยิงแอด</li>
              <li>ไม่นับห้องที่ถูกบล็อกว่าเป็นสแปม</li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-slate-700">ข้อจำกัดที่ต้องรู้ก่อนใช้ตัดสินใจ</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>ad_id เก็บได้เฉพาะลูกค้าที่ทักเข้ามา <b>ตั้งแต่ 07/09/2569 04:41</b> เป็นต้นไป (เวลาที่ webhook เริ่มส่ง referral เข้าระบบ)
                — ก่อนหน้านั้น Meta ไม่ให้ดึงย้อนหลัง จึงขึ้นเป็น “ไม่รู้ที่มา” ทั้งหมด</li>
              <li>ลูกค้าที่ทักเองที่เพจ/ค้นเจอเอง จะไม่มี ad_id เป็นเรื่องปกติ ไม่ใช่ข้อมูลหาย</li>
              <li>ยังไม่มีคอลัมน์ค่าโฆษณา/ต้นทุนต่อลูกค้า (ดูกล่องเหลืองด้านบน)</li>
            </ul>
          </div>
        </div>
      </details>

      {/* บอกข้อจำกัดตรง ๆ ดีกว่าโชว์คอลัมน์ค่าโฆษณาว่างเปล่าให้เข้าใจผิด */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] text-amber-800">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          ยังไม่มีคอลัมน์ค่าโฆษณา/ต้นทุนต่อลูกค้า เพราะ token ปัจจุบันเข้าถึงบัญชีโฆษณาที่รันแอดพวกนี้ไม่ได้
          (เห็นแค่ IB Protential Shares-A, TRAP, XM) — มอบสิทธิ์บัญชีโฆษณานั้นให้ system user ใน Business settings
          แล้วบอกผม ผมเติมคอลัมน์ค่าโฆษณาและต้นทุนต่อการเปิดบัญชีให้ทันที
        </span>
      </div>

      {ads === null ? <Spinner label="กำลังรวมข้อมูล..." /> : ads.length === 0 ? (
        <EmptyState icon={Megaphone} title="ยังไม่มีลูกค้าที่รู้ที่มาจากแอด"
          hint="ลูกค้าที่กดจากโฆษณาจะถูกบันทึก ad_id ให้เองผ่าน webhook · ลองเปลี่ยนช่วงเวลาเป็น “ทั้งหมด”" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[["ลูกค้าทั้งหมดในช่วงนี้", totals?.total ?? 0, "ทุกห้องแชท/คอมเมนต์ที่เข้าระบบในช่วงนี้ (ไม่นับที่บล็อกว่าสแปม)"],
              ["รู้ที่มาจากแอด", totals?.with_ad ?? 0, "ห้องที่ผูกกับ ad_id ได้"],
              ["ลูกค้าใหม่จากแอด", totals?.ad_new ?? 0, "ทักครั้งแรกพร้อมกับการกดแอด — คนที่แอดหามาได้จริง", "text-emerald-700"],
              ["ลูกค้าเก่ากลับมา", totals?.ad_old ?? 0, "เคยคุยกับเพจอยู่แล้วแต่กดแอดเข้ามาใหม่ — ไม่ใช่คนใหม่ที่แอดหามาได้", "text-amber-700"]].map(([label, value, hint, tone]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-3" title={hint}>
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className={`text-lg font-semibold ${tone || "text-slate-800"}`}>{Number(value).toLocaleString("th-TH")}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500">
            <span>ไม่รู้ที่มา {Math.max(0, (totals?.total ?? 0) - (totals?.with_ad ?? 0)).toLocaleString("th-TH")}</span>
            <span>เปิดบัญชีแล้วทั้งหมด {Number(totals?.opened ?? 0).toLocaleString("th-TH")}</span>
            {Number(totals?.ad_unknown ?? 0) > 0 && (
              <span title="มาจากคอมเมนต์ — Meta ไม่ส่งเวลากดแอดมา จึงบอกไม่ได้ว่าเก่าหรือใหม่">
                แยกเก่า/ใหม่ไม่ได้ {Number(totals.ad_unknown).toLocaleString("th-TH")}
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold" title="ชื่อ/ไอดีโฆษณาที่ลูกค้าเข้ามาจาก · กดที่แถวเพื่อดูรายชื่อคนที่ทักมา">โฆษณา</th>
                  <th className="px-3 py-2 text-right font-semibold" title="จำนวนห้องแชท/คอมเมนต์ที่ผูกกับแอดนี้">ลูกค้า</th>
                  <th className="px-3 py-2 text-right font-semibold" title="ทักครั้งแรกพร้อมกับการกดแอดนี้ = คนใหม่ที่แอดหามาได้">ใหม่</th>
                  <th className="px-3 py-2 text-right font-semibold" title="เคยคุยกับเพจอยู่แล้วแต่กดแอดเข้ามาใหม่ — ไม่ใช่คนใหม่ที่แอดหามาได้">เก่า</th>
                  <th className="px-3 py-2 text-right font-semibold" title="กดปุ่มส่งข้อความจากโฆษณา (entry_ad_id จาก event messaging_referrals)">ทักจากแอด</th>
                  <th className="px-3 py-2 text-right font-semibold" title="คอมเมนต์ใต้โพสต์ของโฆษณานี้ (comment_ad_ids)">คอมเมนต์</th>
                  <th className="px-3 py-2 text-right font-semibold" title="สถานะ account_opened ที่แอดมินกดยืนยันในระบบ · ในวงเล็บคือเฉพาะลูกค้าใหม่">เปิดบัญชี</th>
                  <th className="px-3 py-2 text-right font-semibold" title="เปิดบัญชีของลูกค้าใหม่ ÷ ลูกค้าใหม่ ของแอดนี้">% ปิดได้ (ใหม่)</th>
                  <th className="px-3 py-2 text-right font-semibold" title="ข้อความล่าสุดยังเป็นของลูกค้า (awaiting_reply)">ค้างตอบ</th>
                  <th className="px-3 py-2 text-left font-semibold" title="เวลาข้อความล่าสุดในห้องของแอดนี้">ล่าสุด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ads.map((a) => {
                  const isOpen = openAd === a.ad_id;
                  const rows = people[a.ad_id];
                  return [
                    <tr key={a.ad_id} onClick={() => toggleAd(a.ad_id)}
                      className={`cursor-pointer ${isOpen ? "bg-brand-50/50" : "hover:bg-slate-50/60"}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          {isOpen ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-brand-600" />
                                  : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
                          <div>
                            <div className="font-medium text-slate-800">{a.ad_name || "(ยังไม่รู้ชื่อแอด)"}</div>
                            <div className="font-mono text-[10.5px] text-slate-400">{a.ad_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{Number(a.chats).toLocaleString("th-TH")}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700">{Number(a.new_cust).toLocaleString("th-TH")}</td>
                      <td className={`px-3 py-2 text-right ${Number(a.old_cust) > 0 ? "font-medium text-amber-700" : "text-slate-400"}`}>
                        {Number(a.old_cust).toLocaleString("th-TH")}
                        {Number(a.unknown_cust) > 0 && <span className="ml-1 text-[10px] text-slate-400" title="แยกเก่า/ใหม่ไม่ได้">+{Number(a.unknown_cust)}?</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{Number(a.dm).toLocaleString("th-TH")}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{Number(a.comments).toLocaleString("th-TH")}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                        {Number(a.opened).toLocaleString("th-TH")}
                        {Number(a.opened) !== Number(a.opened_new) && (
                          <span className="ml-1 text-[10px] font-normal text-slate-400" title="เฉพาะลูกค้าใหม่">({Number(a.opened_new)})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {Number(a.new_cust) ? `${Math.round((Number(a.opened_new) / Number(a.new_cust)) * 100)}%` : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right ${Number(a.waiting) > 0 ? "text-amber-700 font-medium" : "text-slate-400"}`}>{Number(a.waiting).toLocaleString("th-TH")}</td>
                      <td className="px-3 py-2 text-left text-[11.5px] text-slate-500">{fmt(a.last_at)}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${a.ad_id}-people`} className="bg-slate-50/70">
                        <td colSpan={10} className="px-3 py-2.5">
                          <PeopleList rows={rows} fmt={fmt} onOpenChat={onOpenChat} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// รายชื่อคนที่ทักมาจากแอดหนึ่ง ๆ — แยกกลุ่มลูกค้าเก่า/ใหม่ให้เห็นด้วยตา ไม่ต้องอ่านตัวเลขเทียบ
// ทำเป็นการ์ดไม่ใช่ตารางซ้อนตาราง เพราะซ้อนแล้วจอมือถืออ่านไม่ได้
function PeopleList({ rows, fmt, onOpenChat }) {
  if (rows === "loading" || rows === undefined) return <div className="py-1 text-[11.5px] text-slate-500">กำลังโหลดรายชื่อ…</div>;
  if (rows?.error) return <div className="py-1 text-[11.5px] text-rose-600">{rows.error}</div>;
  if (!rows.length) return <div className="py-1 text-[11.5px] text-slate-500">ไม่มีรายชื่อในช่วงเวลานี้</div>;

  const groups = [
    { key: "old", label: "ลูกค้าเก่ากลับมา", icon: Repeat, tone: "text-amber-700 bg-amber-50 border-amber-200", border: "border-amber-200",
      hint: "เคยคุยกับเพจอยู่แล้วก่อนกดแอดนี้ — ไม่ควรนับเป็นผลงานหาคนใหม่ของแอด",
      items: rows.filter((r) => r.is_returning === true) },
    { key: "new", label: "ลูกค้าใหม่", icon: Sparkles, tone: "text-emerald-700 bg-emerald-50 border-emerald-200", border: "border-emerald-200",
      hint: "ทักครั้งแรกพร้อมกับการกดแอดนี้",
      items: rows.filter((r) => r.is_returning === false) },
    { key: "unknown", label: "แยกไม่ได้", icon: HelpCircle, tone: "text-slate-600 bg-slate-100 border-slate-200", border: "border-slate-200",
      hint: "ไม่มีเวลากดแอดให้เทียบ (มาจากคอมเมนต์)",
      items: rows.filter((r) => r.is_returning === null || r.is_returning === undefined) },
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600" title={g.hint}>
            <g.icon size={12} /> {g.label} · {g.items.length} คน
          </div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {g.items.map((r) => (
              <div key={r.id} className={`rounded-lg border bg-white px-2.5 py-2 ${g.border}`}>
                <div className="flex items-start gap-2">
                  {r.profile_pic
                    ? <img src={r.profile_pic} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    : <div className="h-7 w-7 shrink-0 rounded-full bg-slate-200" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-slate-800">{r.customer_name || "(ไม่ทราบชื่อ)"}</span>
                      <span className={`rounded-full border px-1.5 py-[1px] text-[10px] font-semibold ${g.tone}`} title={r.why}>
                        {g.key === "old" ? "เก่า" : g.key === "new" ? "ใหม่" : "?"}
                      </span>
                      {r.is_opened && <span className="rounded-full bg-emerald-100 px-1.5 py-[1px] text-[10px] font-semibold text-emerald-700">เปิดบัญชีแล้ว</span>}
                      {r.is_waiting && <span className="rounded-full bg-amber-100 px-1.5 py-[1px] text-[10px] font-semibold text-amber-700">ค้างตอบ</span>}
                      {Number(r.clicks) > 1 && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-[1px] text-[10px] text-slate-500" title="กดโฆษณาตัวนี้เข้ามาหลายครั้ง">
                          กดแอด {Number(r.clicks)} ครั้ง
                        </span>
                      )}
                    </div>
                    {/* เหตุผลที่จัดเป็นเก่า/ใหม่ — ต้องเห็นตรงนี้ ไม่ให้เชื่อป้ายลอย ๆ */}
                    <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{r.why}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-slate-400">
                      <span title="เพจที่ลูกค้าทักเข้ามา">{r.page_name || "—"}</span>
                      <span title="ช่องทางที่ผูกกับแอด">{r.is_dm ? "ทักจากแอด" : "คอมเมนต์"}</span>
                      <span title="เวลาที่คุยกับเพจครั้งแรกที่ระบบรู้">คุยครั้งแรก {fmt(r.first_contact)}</span>
                      {r.click_at && <span title="เวลากดแอดครั้งแรก">กดแอด {fmt(r.click_at)}</span>}
                      <span title="ข้อความทั้งหมดในห้อง / ที่ลูกค้าพิมพ์เอง">{Number(r.msgs || 0)} ข้อความ (ลูกค้า {Number(r.user_msgs || 0)})</span>
                      {r.trade_id && <span title="เลขบัญชีเทรดที่บันทึกไว้">บัญชี {r.trade_id}</span>}
                    </div>
                  </div>
                  {onOpenChat && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpenChat(r.id); }}
                      title="เปิดห้องแชทนี้ในกล่องแชท"
                      className="shrink-0 rounded-lg border border-slate-300 p-1 text-slate-500 hover:bg-slate-50">
                      <MessageSquare size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
