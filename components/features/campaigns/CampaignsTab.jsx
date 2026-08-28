"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, PauseCircle, ArrowUpCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import StatusBadge from "@/components/shared/StatusBadge";

// ---------------------------------------------------------------
// Campaigns (monitor) tab
// ---------------------------------------------------------------
// กล่องแจ้งเตือน "แชทผี" + ปุ่มอนุมัติหยุด/ไม่ใช่แชทผี (โหมด alert — รอแอดมินตัดสิน)
export function GhostAlert({ item, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!item.ghost_flagged) return null;

  async function resolve(action) {
    setBusy(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("resolve-ghost", {
      body: { ad_content_id: item.id, action },
    });
    setBusy(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  return (
    <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 space-y-2">
      <div className="text-sm text-rose-700 flex gap-1.5">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <span>👻 {item.ghost_reason || "สงสัยว่าเป็นแชทผี (ทักแล้วเงียบ)"}</span>
      </div>
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => resolve("pause")}
          className="text-xs bg-rose-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-rose-700 disabled:opacity-60 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="animate-spin" size={13} /> : <PauseCircle size={13} />}
          อนุมัติให้หยุด
        </button>
        <button
          disabled={busy}
          onClick={() => resolve("dismiss")}
          className="text-xs bg-white border border-rose-200 text-rose-700 rounded-lg px-3 py-1.5 font-medium hover:bg-rose-100 disabled:opacity-60"
        >
          ไม่ใช่แชทผี (คงไว้)
        </button>
      </div>
      {error && <div className="text-xs text-rose-600">{error}</div>}
    </div>
  );
}

function CampaignRow({ item, latestMetric, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function respondScale(approve) {
    setBusy(true);
    setError("");
    const { error: fnError } = await supabase.functions.invoke("scale-budget", {
      body: { ad_content_id: item.id, approve },
    });
    setBusy(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    onChanged?.();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-800">{item.headline}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            งบ/วัน: {item.daily_budget_thb ?? "-"} บาท · Ad ID: {item.ad_id || "-"}
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>
      {latestMetric && (
        <div className="flex gap-4 text-sm text-slate-600 pt-1">
          <span>Spend: {latestMetric.spend?.toLocaleString?.() ?? latestMetric.spend}</span>
          <span>Leads: {latestMetric.leads}</span>
          <span>CPA: {latestMetric.cpa ? Math.round(latestMetric.cpa).toLocaleString() : "-"}</span>
        </div>
      )}
      {item.status === "paused_auto" && item.notes && (
        <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{item.notes}</div>
      )}
      <GhostAlert item={item} onChanged={onChanged} />
      {error && <div className="text-xs text-rose-600 bg-rose-50 rounded-lg px-2.5 py-1.5">{error}</div>}
      {item.scale_suggested && (
        <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 mt-2">
          <div className="text-sm text-blue-700 flex items-center gap-1.5">
            <ArrowUpCircle size={16} />
            เสนอเพิ่มงบเป็น {item.suggested_budget_thb} บาท/วัน
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => respondScale(true)}
              className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              อนุมัติ
            </button>
            <button
              disabled={busy}
              onClick={() => respondScale(false)}
              className="text-xs bg-white border border-blue-200 text-blue-700 rounded-lg px-3 py-1.5 font-medium hover:bg-blue-100 disabled:opacity-60"
            >
              ข้ามไปก่อน
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ล้างรายการ (ซ่อน) แบบติ๊กเลือก — ใช้ร่วมกันทั้งหน้าแคมเปญและหน้าวิเคราะห์ ----
// ไม่ลบข้อมูลจริง เพราะ metrics_log ผูกแบบ cascade (ลบแอด = ประวัติผลหายถาวร)
// ใช้ธง archived_at แทน → หายจากรายการ แต่กดกู้คืนได้ตลอด
export function useArchive(onChanged) {
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const isSel = (id) => sel.includes(id);
  async function run(ids, restore) {
    if (!ids.length) return;
    setBusy(true); setMsg("");
    const { error } = await supabase.from("ad_content")
      .update({ archived_at: restore ? null : new Date().toISOString() })
      .in("id", ids);
    setBusy(false);
    if (error) { setMsg(`ไม่สำเร็จ: ${error.message}`); return; }
    setMsg(restore ? `กู้คืนแล้ว ${ids.length} รายการ` : `ซ่อนแล้ว ${ids.length} รายการ (กดดูที่ซ่อนไว้เพื่อกู้คืน)`);
    setSel([]);
    onChanged?.();
    setTimeout(() => setMsg(""), 4000);
  }
  return { sel, setSel, toggle, isSel, busy, msg, showArchived, setShowArchived, archive: (ids) => run(ids, false), restore: (ids) => run(ids, true) };
}

// แถบเครื่องมือด้านบนรายการ: เลือกทั้งหมด/ล้างที่เลือก/สลับดูที่ซ่อนไว้
export function ArchiveBar({ a, visibleIds, archivedCount }) {
  const allSel = visibleIds.length > 0 && visibleIds.every((id) => a.isSel(id));
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      {visibleIds.length > 0 && (
        <button onClick={() => a.setSel(allSel ? [] : visibleIds)} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
          {allSel ? "เอาออกทั้งหมด" : `เลือกทั้งหมด (${visibleIds.length})`}
        </button>
      )}
      {a.sel.length > 0 && (
        <>
          <span className="text-slate-500">เลือกไว้ {a.sel.length} รายการ</span>
          {a.showArchived ? (
            <button onClick={() => a.restore(a.sel)} disabled={a.busy} className="rounded-lg bg-emerald-600 text-white px-3 py-1 font-medium hover:bg-emerald-700 disabled:opacity-50">
              {a.busy ? "กำลังกู้คืน..." : "กู้คืนที่เลือก"}
            </button>
          ) : (
            <button onClick={() => a.archive(a.sel)} disabled={a.busy} className="rounded-lg bg-rose-600 text-white px-3 py-1 font-medium hover:bg-rose-700 disabled:opacity-50">
              {a.busy ? "กำลังซ่อน..." : `ล้างที่เลือก (${a.sel.length})`}
            </button>
          )}
          <button onClick={() => a.setSel([])} className="text-slate-400 hover:text-slate-600">ยกเลิก</button>
        </>
      )}
      <button
        onClick={() => { a.setShowArchived(!a.showArchived); a.setSel([]); }}
        className={`rounded-lg border px-2 py-1 ml-auto ${a.showArchived ? "bg-slate-800 text-white border-slate-800" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}
      >
        {a.showArchived ? "← กลับไปรายการปกติ" : `ดูที่ซ่อนไว้ (${archivedCount})`}
      </button>
      {a.msg && <span className={a.msg.startsWith("ไม่สำเร็จ") ? "text-rose-600 w-full" : "text-emerald-600 w-full"}>{a.msg}</span>}
    </div>
  );
}

function CampaignsTab({ adContent, metricsByAdId, onChanged, filter = "all", onFilterChange }) {
  const arch = useArchive(onChanged);
  // แยกรายการที่ถูกซ่อนออกจากรายการปกติ — สลับดูได้จากปุ่ม "ดูที่ซ่อนไว้"
  const archivedAll = adContent.filter((a) => a.archived_at);
  const pool = adContent.filter((a) => (arch.showArchived ? a.archived_at : !a.archived_at));

  const launched = pool.filter((a) => a.status === "active" || a.status === "paused_auto");
  const filters = [
    { key: "all", label: "ทั้งหมด", count: launched.length },
    { key: "active", label: "กำลังใช้งาน", count: pool.filter((a) => a.status === "active").length },
    { key: "paused_auto", label: "หยุดอัตโนมัติ", count: pool.filter((a) => a.status === "paused_auto").length },
    { key: "scale", label: "รออนุมัติเพิ่มงบ", count: pool.filter((a) => a.scale_suggested).length },
  ];

  let campaigns;
  if (filter === "active") campaigns = pool.filter((a) => a.status === "active");
  else if (filter === "paused_auto") campaigns = pool.filter((a) => a.status === "paused_auto");
  else if (filter === "scale") campaigns = pool.filter((a) => a.scale_suggested);
  else campaigns = launched;

  return (
    <div className="space-y-3">
      <ArchiveBar a={arch} visibleIds={campaigns.map((c) => c.id)} archivedCount={archivedAll.length} />
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange?.(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition ${
              filter === f.key
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
      {campaigns.length === 0 ? (
        <div className="text-sm text-slate-500 py-10 text-center">
          {arch.showArchived ? "ไม่มีรายการที่ซ่อนไว้ในหมวดนี้" : "ยังไม่มีแคมเปญในหมวดนี้"}
        </div>
      ) : (
        campaigns.map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={arch.isSel(item.id)}
              onChange={() => arch.toggle(item.id)}
              className="w-4 h-4 mt-4 shrink-0 cursor-pointer"
              title={arch.showArchived ? "เลือกเพื่อกู้คืน" : "เลือกเพื่อซ่อนออกจากรายการ"}
            />
            <div className="flex-1 min-w-0">
              <CampaignRow item={item} latestMetric={metricsByAdId[item.id]} onChanged={onChanged} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default CampaignsTab;
