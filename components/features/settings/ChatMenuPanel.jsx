"use client";

// เมนูปุ่มที่โผล่ในแชทฝั่งลูกค้า — คุยกับ edge function messenger-menu (Messenger Profile API)
// สองอย่างนี้คนละตัวกัน:
//   คำถามเริ่มต้น (ice breakers)  = โผล่ก่อนลูกค้าทักครั้งแรก สูงสุด 4 ข้อ
//   เมนูปุ่ม (persistent menu)     = เมนูข้างช่องพิมพ์ กดได้ตลอด สูงสุด 3 ปุ่ม
// ลูกค้ากดปุ่ม -> Meta ส่ง postback -> meta-webhook แปลงเป็นข้อความ "[กดปุ่ม] ..." เข้ากล่องแชทและเด้งแจ้งเตือน

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, MessageSquare, Link2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";

const MAX_ICE = 4;
const MAX_MENU = 3;

function Row({ children, onRemove }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        title="ลบ"
        className="mt-1 shrink-0 rounded-lg border border-slate-300 p-2 text-slate-500 hover:border-rose-300 hover:text-rose-600"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default function ChatMenuPanel({ allowedPages = null }) {
  const [pages, setPages] = useState([]);
  const [pageId, setPageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [ice, setIce] = useState([]);
  const [menu, setMenu] = useState([]);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const ok = (id) => !allowedPages || allowedPages.includes(String(id));
    supabase
      .from("page_lead_config")
      .select("page_id, page_name")
      .order("page_name")
      .then(({ data }) => {
        const list = (data || []).map((p) => ({ id: p.page_id, name: p.page_name || p.page_id })).filter((p) => ok(p.id));
        setPages(list);
        if (list.length === 1) setPageId(list[0].id);
      });
  }, []);

  async function load(id) {
    if (!id) return;
    setLoading(true);
    setError("");
    setDone("");
    const { data, error: fnErr } = await supabase.functions.invoke("messenger-menu", { body: { action: "get", page_id: id } });
    setLoading(false);
    if (fnErr || !data?.ok) {
      setError(fnErr ? await readFunctionErrorMessage(fnErr) : data?.error || "อ่านเมนูไม่สำเร็จ");
      return;
    }
    setIce(data.ice_breakers || []);
    setMenu(data.persistent_menu || []);
    setGreeting(data.greeting || "");
  }

  useEffect(() => {
    if (pageId) load(pageId);
  }, [pageId]);

  async function save() {
    setSaving(true);
    setError("");
    setDone("");
    const { data, error: fnErr } = await supabase.functions.invoke("messenger-menu", {
      body: {
        action: "save",
        page_id: pageId,
        ice_breakers: ice.filter((i) => i.question?.trim()),
        persistent_menu: menu.filter((m) => m.title?.trim()),
        greeting,
      },
    });
    setSaving(false);
    if (fnErr || !data?.ok) {
      setError(fnErr ? await readFunctionErrorMessage(fnErr) : data?.error || "บันทึกเมนูไม่สำเร็จ");
      return;
    }
    setDone("บันทึกแล้ว — ลูกค้าจะเห็นเมนูใหม่ภายในไม่กี่นาที (บางเครื่องต้องปิด-เปิดแชทใหม่)");
  }

  const setIceAt = (i, k, v) => setIce((cur) => cur.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  const setMenuAt = (i, k, v) => setMenu((cur) => cur.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
      <div>
        <h3 className="font-semibold text-slate-800">เมนูปุ่มในแชท (Messenger)</h3>
        <p className="text-xs text-slate-500 mt-1">
          ตั้งปุ่มให้ลูกค้ากดเลือกเองในแชท ลูกค้ากดแล้วจะเด้งเข้ากล่องแชทเป็นข้อความ <span className="font-medium">[กดปุ่ม] …</span>{" "}
          พร้อมแจ้งเตือนเหมือนลูกค้าพิมพ์เอง
        </p>
      </div>

      <div>
        <label className="text-sm text-slate-600">เพจ</label>
        <div className="mt-1.5 flex gap-2">
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="">— เลือกเพจ —</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pageId || loading}
            onClick={() => load(pageId)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} โหลดใหม่
          </button>
        </div>
        {pages.length === 0 && (
          <p className="mt-1.5 text-[11px] text-amber-600">ยังไม่มีเพจในระบบ — เพิ่มที่หัวข้อ "เพจที่ซิงก์แชท" ก่อน</p>
        )}
      </div>

      {!pageId ? (
        <p className="text-sm text-slate-400">เลือกเพจก่อนเพื่อดูและแก้เมนู</p>
      ) : (
        <>
          {/* ---- ice breakers ---- */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-700">คำถามเริ่มต้น</div>
                <p className="text-[11px] text-slate-400">โผล่ตอนลูกค้าเปิดแชทครั้งแรก ก่อนพิมพ์อะไรเลย — สูงสุด {MAX_ICE} ข้อ</p>
              </div>
              <button
                type="button"
                disabled={ice.length >= MAX_ICE}
                onClick={() => setIce((c) => [...c, { question: "", payload: "" }])}
                className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus size={14} /> เพิ่ม
              </button>
            </div>
            {ice.length === 0 ? (
              <p className="text-xs text-slate-400">ยังไม่มี — กด "เพิ่ม" เพื่อสร้างคำถามแรก</p>
            ) : (
              ice.map((it, i) => (
                <Row key={i} onRemove={() => setIce((c) => c.filter((_, idx) => idx !== i))}>
                  <input
                    value={it.question}
                    maxLength={80}
                    onChange={(e) => setIceAt(i, "question", e.target.value)}
                    placeholder="เช่น สอบถามโปรโมชั่น"
                    className={inputCls}
                  />
                </Row>
              ))
            )}
          </div>

          {/* ---- persistent menu ---- */}
          <div className="space-y-2.5 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-700">เมนูปุ่มถาวร</div>
                <p className="text-[11px] text-slate-400">
                  เมนู ☰ ข้างช่องพิมพ์ กดได้ตลอดการสนทนา — สูงสุด {MAX_MENU} ปุ่ม
                </p>
              </div>
              <button
                type="button"
                disabled={menu.length >= MAX_MENU}
                onClick={() => setMenu((c) => [...c, { type: "postback", title: "", payload: "", url: "" }])}
                className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus size={14} /> เพิ่ม
              </button>
            </div>
            {menu.length === 0 ? (
              <p className="text-xs text-slate-400">ยังไม่มี — กด "เพิ่ม" เพื่อสร้างปุ่มแรก</p>
            ) : (
              menu.map((it, i) => (
                <Row key={i} onRemove={() => setMenu((c) => c.filter((_, idx) => idx !== i))}>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={it.title}
                      maxLength={30}
                      onChange={(e) => setMenuAt(i, "title", e.target.value)}
                      placeholder="ชื่อปุ่ม เช่น คุยกับแอดมิน"
                      className={inputCls}
                    />
                    <select
                      value={it.type}
                      onChange={(e) => setMenuAt(i, "type", e.target.value)}
                      className={`${inputCls} bg-white sm:w-44 sm:shrink-0`}
                    >
                      <option value="postback">ส่งเข้ากล่องแชท</option>
                      <option value="web_url">เปิดลิงก์</option>
                    </select>
                  </div>
                  {it.type === "web_url" ? (
                    <div className="flex items-center gap-2">
                      <Link2 size={14} className="shrink-0 text-slate-400" />
                      <input
                        value={it.url}
                        onChange={(e) => setMenuAt(i, "url", e.target.value)}
                        placeholder="https://…  (ต้องเป็น https เท่านั้น)"
                        className={inputCls}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <MessageSquare size={14} className="shrink-0 text-slate-400" />
                      <span className="text-[11px] text-slate-400">
                        ลูกค้ากดแล้วจะขึ้นในกล่องแชทว่า "[กดปุ่ม] {it.title || "…"}"
                      </span>
                    </div>
                  )}
                  {it.type === "web_url" && it.url && !/^https:\/\//i.test(it.url) && (
                    <p className="text-[11px] text-amber-600">
                      ลิงก์ต้องขึ้นต้นด้วย https:// — ถ้าไม่ถูก ระบบจะบันทึกเป็นปุ่มส่งเข้ากล่องแชทแทน
                    </p>
                  )}
                </Row>
              ))
            )}
          </div>

          {/* ---- greeting ---- */}
          <div className="border-t border-slate-100 pt-4">
            <label className="text-sm font-semibold text-slate-700">ข้อความต้อนรับ</label>
            <p className="text-[11px] text-slate-400 mt-0.5">โชว์ในหน้าแชทเปล่าก่อนลูกค้าเริ่มคุย (เว้นว่างได้)</p>
            <textarea
              value={greeting}
              maxLength={160}
              rows={2}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="เช่น สวัสดีครับ ทักมาได้เลย ตอบไวทุกวัน 9:00–21:00"
              className={`${inputCls} mt-1.5 resize-y`}
            />
            <div className="mt-1 text-right text-[11px] text-slate-400">{greeting.length}/160</div>
          </div>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div>}
          {done && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{done}</div>}

          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? "กำลังบันทึก…" : "บันทึกเมนู"}
          </button>
          <p className="text-[11px] text-slate-400">
            ลบทุกปุ่มออกแล้วกดบันทึก = ปิดเมนูนั้นไปเลย · Instagram ยังไม่รองรับเมนูถาวร รองรับเฉพาะ Messenger
          </p>
        </>
      )}
    </div>
  );
}
