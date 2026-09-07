"use client";
// หน้า "แอดไหนได้ลูกค้า" — ตอบคำถามว่าเงินโฆษณาที่ยิงไป แอดตัวไหนทำให้เกิดแชทและเปิดบัญชีจริง
// ที่มาของข้อมูลมี 2 ทาง (นับรวมกันในตารางเดียว แต่แยกคอลัมน์ให้เห็น):
//   1. DM จากแอด  — entry_ad_id ที่ Meta ส่งมากับ event referral ตอนลูกค้ากดจากโฆษณา
//   2. คอมเมนต์ใต้แอด — comment_ad_ids ที่ระบบ map จากโพสต์ของโฆษณา
// "เปิดบัญชีแล้ว" ใช้ stage = account_opened (ตรงกับที่แอดมินกดยืนยันในระบบ)
import { useCallback, useEffect, useState } from "react";
import { Megaphone, RefreshCw, Info } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import Spinner from "@/components/shared/Spinner";
import { EmptyState, FilterPill } from "@/components/ui";

const RANGES = [
  { key: "7", label: "7 วัน", days: 7 },
  { key: "30", label: "30 วัน", days: 30 },
  { key: "all", label: "ทั้งหมด", days: null },
];

export default function AdChatsTab({ active = true }) {
  const [ads, setAds] = useState(null);
  const [totals, setTotals] = useState(null);
  const [err, setErr] = useState("");
  const [range, setRange] = useState("30");

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
      setErr("");
    } catch (e) {
      setErr(e?.message || "โหลดข้อมูลไม่สำเร็จ");
      setAds([]);
    }
  }, [range]);

  useEffect(() => { if (active) { setAds(null); load(); } }, [active, load]);

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
            <div className="font-semibold text-slate-700">ความหมายของแต่ละคอลัมน์</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><b>ลูกค้า</b> = จำนวนห้องที่ผูกกับแอดนั้น</li>
              <li><b>เปิดบัญชี</b> = ห้องที่สถานะเป็น <span className="font-mono">account_opened</span> ซึ่งแอดมินกดยืนยันเองในระบบ (ไม่ใช่ AI เดา)</li>
              <li><b>% ปิดได้</b> = เปิดบัญชี ÷ ลูกค้า ของแอดนั้น</li>
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
            {[["ลูกค้าทั้งหมดในช่วงนี้", totals?.total ?? 0], ["รู้ที่มาจากแอด", totals?.with_ad ?? 0],
              ["ไม่รู้ที่มา", Math.max(0, (totals?.total ?? 0) - (totals?.with_ad ?? 0))], ["เปิดบัญชีแล้ว", totals?.opened ?? 0]].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-lg font-semibold text-slate-800">{Number(value).toLocaleString("th-TH")}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold" title="ชื่อ/ไอดีโฆษณาที่ลูกค้าเข้ามาจาก">โฆษณา</th>
                  <th className="px-3 py-2 text-right font-semibold" title="จำนวนห้องแชท/คอมเมนต์ที่ผูกกับแอดนี้">ลูกค้า</th>
                  <th className="px-3 py-2 text-right font-semibold" title="กดปุ่มส่งข้อความจากโฆษณา (entry_ad_id จาก event messaging_referrals)">ทักจากแอด</th>
                  <th className="px-3 py-2 text-right font-semibold" title="คอมเมนต์ใต้โพสต์ของโฆษณานี้ (comment_ad_ids)">คอมเมนต์</th>
                  <th className="px-3 py-2 text-right font-semibold" title="สถานะ account_opened ที่แอดมินกดยืนยันในระบบ">เปิดบัญชี</th>
                  <th className="px-3 py-2 text-right font-semibold" title="เปิดบัญชี ÷ ลูกค้า ของแอดนี้">% ปิดได้</th>
                  <th className="px-3 py-2 text-right font-semibold" title="ข้อความล่าสุดยังเป็นของลูกค้า (awaiting_reply)">ค้างตอบ</th>
                  <th className="px-3 py-2 text-left font-semibold" title="เวลาข้อความล่าสุดในห้องของแอดนี้">ล่าสุด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ads.map((a) => (
                  <tr key={a.ad_id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{a.ad_name || "(ยังไม่รู้ชื่อแอด)"}</div>
                      <div className="font-mono text-[10.5px] text-slate-400">{a.ad_id}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{Number(a.chats).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{Number(a.dm).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{Number(a.comments).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">{Number(a.opened).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{Number(a.chats) ? `${Math.round((Number(a.opened) / Number(a.chats)) * 100)}%` : "—"}</td>
                    <td className={`px-3 py-2 text-right ${Number(a.waiting) > 0 ? "text-amber-700 font-medium" : "text-slate-400"}`}>{Number(a.waiting).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-2 text-left text-[11.5px] text-slate-500">{fmt(a.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
