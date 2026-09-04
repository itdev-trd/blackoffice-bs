"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Globe2, Loader2, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";

function countryLabel(code) {
  try { return new Intl.DisplayNames(["th"], { type: "region" }).of(code) || code; } catch { return code; }
}

export default function AdKeywordCountryScanner({ restricted = false, allowedAccounts = [] }) {
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState("");
  const [keywords, setKeywords] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke("list-ad-accounts", { body: {} });
      if (!alive) return;
      setLoadingAccounts(false);
      if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
      const allow = new Set((allowedAccounts || []).map((v) => String(v).replace(/^act_/, "")));
      const rows = (data?.accounts || []).filter((row) => !restricted || allow.has(String(row.account_id).replace(/^act_/, "")));
      setAccounts(rows);
      if (rows.length === 1) setAccount(rows[0].account_id);
    })();
    return () => { alive = false; };
  }, [allowedAccounts, restricted]);

  const parsedKeywords = useMemo(() => [...new Set(keywords.split(/[\n,]/).map((v) => v.trim()).filter((v) => v.length >= 2))], [keywords]);

  async function scan() {
    if (!account || !parsedKeywords.length) return;
    setLoading(true); setError(""); setResult(null);
    const { data, error: fnError } = await supabase.functions.invoke("scan-ad-keyword-countries", { body: { ad_account_id: account, keywords: parsedKeywords } });
    setLoading(false);
    if (fnError) { setError(await readFunctionErrorMessage(fnError)); return; }
    if (!data?.ok) { setError(data?.error || "ตรวจโฆษณาไม่สำเร็จ"); return; }
    setResult(data);
  }

  return (
    <section className="ds-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Globe2 size={19} className="text-blue-500" /><h2 className="text-base sm:text-lg font-semibold">ตรวจประเทศโฆษณาตามคีย์เวิร์ด</h2></div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">ค้นหาโฆษณาทั้งบัญชีจากชื่อและข้อความ แล้วดูประเทศที่ตั้งเป้าไว้ในชุดโฆษณา</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700"><ShieldCheck size={13} /> ตรวจสิทธิ์บัญชีฝั่งเซิร์ฟเวอร์</span>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)_auto] items-end">
        <label className="block text-xs text-slate-500">บัญชีโฆษณา<select className="ds-input mt-1 w-full" value={account} onChange={(e) => { setAccount(e.target.value); setResult(null); }} disabled={loadingAccounts || loading}><option value="">{loadingAccounts ? "กำลังโหลดบัญชี..." : "เลือกบัญชีโฆษณา"}</option>{accounts.map((row) => <option key={row.account_id} value={row.account_id}>{row.name || row.account_id} · {row.account_id}</option>)}</select></label>
        <label className="block text-xs text-slate-500">คีย์เวิร์ด <span className="text-slate-400">(คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่)</span><textarea className="ds-input mt-1 min-h-[42px] resize-y" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="เช่น tradingview, gold, forex" disabled={loading} /></label>
        <button type="button" onClick={scan} disabled={loading || !account || !parsedKeywords.length} className="ds-btn ds-btn-primary h-11 whitespace-nowrap"><Search size={16} />{loading ? <><Loader2 size={16} className="animate-spin" />กำลังตรวจ...</> : "ตรวจโฆษณา"}</button>
      </div>
      {error && <div className="ds-alert ds-alert-error text-sm">{error}</div>}
      {result && <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>พบโฆษณาที่ตรงคีย์เวิร์ด <strong className="text-slate-800">{result.matched_ads}</strong> รายการ · สแกนแคมเปญ {result.scanned?.campaigns} / ชุดโฆษณา {result.scanned?.adsets} / โฆษณา {result.scanned?.ads}</span>{result.truncated && <span className="text-amber-700">ผลลัพธ์ถูกจำกัดจำนวนเพื่อความปลอดภัย</span>}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{result.summary?.length ? result.summary.map((row) => <div key={row.country_code} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{countryLabel(row.country_code)}</span><span className="text-xs font-semibold text-blue-600">{row.matched_ads} แอด</span></div><div className="text-[11px] text-slate-500 mt-1">{row.country_code} · {row.keywords.join(", ")}</div></div>) : <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 sm:col-span-2 lg:col-span-4">ไม่พบประเทศที่ระบุเป็นรหัสประเทศตรงๆ</div>}</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[760px] w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">โฆษณา</th><th className="p-3">คีย์เวิร์ด</th><th className="p-3">ประเทศที่ตั้งเป้าไว้</th><th className="p-3">สถานะภูมิศาสตร์</th></tr></thead><tbody>{(result.matches || []).map((row) => <tr key={row.ad_id} className="border-t border-slate-100"><td className="p-3"><div className="font-medium text-slate-800">{row.ad_name}</div><div className="text-slate-500">{row.campaign_name} · {row.adset_name}</div></td><td className="p-3 text-slate-600">{row.matched_keywords.join(", ")}</td><td className="p-3">{row.countries?.length ? row.countries.map((code) => <span key={code} className="mr-1 inline-block rounded-full bg-blue-50 px-2 py-1 text-blue-700">{countryLabel(code)} ({code})</span>) : <span className="text-slate-500">ไม่ระบุประเทศตรงๆ</span>}</td><td className="p-3">{row.geo_mode === "countries" ? <span className="text-emerald-700">ระบุประเทศ</span> : <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} />{row.geo_mode === "regions_or_cities" ? "ระบุเป็นเมือง/ภูมิภาค" : "กว้างหรือ Custom"}</span>}</td></tr>)}</tbody></table></div>
        <p className="text-[11px] text-slate-500">หมายเหตุ: ผลนี้เป็นประเทศที่ตั้งเป้าไว้ใน Meta Ad Set ไม่ใช่ประเทศที่ส่งมอบจริงจากรายงาน Insights</p>
      </div>}
    </section>
  );
}
