"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Eye,
  Globe2,
  Megaphone,
  Search,
  Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { readFunctionErrorMessage } from "@/lib/utils/errors";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilterPill,
  Input,
  SectionTitle,
  Select,
  Skeleton,
} from "@/components/ui";

// ประเทศยอดนิยมโชว์เป็นปุ่มให้กดเลย ที่เหลือซ่อนอยู่ในช่อง "ประเทศอื่น"
// (ดรอปดาวน์ 10 ประเทศบังคับให้ผู้ใช้เปิดอ่านทุกครั้ง ทั้งที่ 90% กดไทย)
const QUICK_COUNTRIES = ["TH", "US", "SG", "MY", "JP"];

// รหัสประเทศ ISO-3166-1 alpha-2 ที่ Meta Ad Library ค้นได้ — ชื่อภาษาไทยและธง
// สร้างจาก Intl ตอนรัน จึงไม่ต้องแปะรายชื่อ 200 ประเทศไว้ในโค้ดให้หลุดสมัย
const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF " +
  "BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CD CF CG CH " +
  "CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE " +
  "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL " +
  "GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ " +
  "IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB " +
  "LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN " +
  "MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP " +
  "NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV " +
  "SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["th-TH"], { type: "region" });
  } catch {
    return null;
  }
})();

const flagOf = (code) =>
  code.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const countryName = (code) => {
  const name = regionNames?.of(code);
  return name && name !== code ? name : code;
};

// เรียงตามชื่อไทยเพื่อให้ไล่หาในเมนูได้ตามลำดับตัวอักษร
const ALL_COUNTRIES = COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
  flag: flagOf(code),
})).sort((a, b) => a.name.localeCompare(b.name, "th"));

const STATUSES = [
  ["ACTIVE", "กำลังยิงอยู่"],
  ["ALL", "ทั้งหมด"],
  ["INACTIVE", "หยุดแล้ว"],
];

const EXAMPLES = ["forex", "ทองคำ", "คอร์สเทรด", "tradingview", "ประกันชีวิต"];

function fmtDate(value) {
  return value
    ? new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })
    : "-";
}

function fmtNumber(value) {
  return value ? Number(String(value).replace(/[^0-9.]/g, "")).toLocaleString("th-TH") : "-";
}

// หน้าเว็บ Ad Library ของ Meta เปิดดูได้โดยไม่ต้องใช้ API
// เก็บไว้เป็นทางออกเมื่อ API ถูกปฏิเสธสิทธิ์ หรือค้นแล้วไม่เจอ
function adLibraryWebUrl(terms, country, status) {
  const params = new URLSearchParams({
    active_status: status === "ALL" ? "all" : status === "INACTIVE" ? "inactive" : "active",
    ad_type: "all",
    country,
    q: terms.join(" "),
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params}`;
}

// Meta ตอบเรื่องสิทธิ์มาเป็นภาษาอังกฤษล้วน แปลให้เป็นสิ่งที่ผู้ใช้ลงมือทำต่อได้
function explainError(message) {
  if (/permission|not authorized|OAuth/i.test(message)) {
    return "แอป Meta ยังไม่ได้รับสิทธิ์ใช้ Ad Library API — ต้องเพิ่มโปรดักต์ “Ad Library API” ในแอป ขอสิทธิ์ ads_read และยืนยันตัวตน/ธุรกิจกับ Meta ก่อน ระหว่างนี้กดปุ่มด้านขวาเพื่อเปิดดูในเว็บ Ad Library ได้เลย";
  }
  return message;
}

// หัวข้อขั้นตอน — เลขวงกลมบอกลำดับว่าต้องทำอะไรก่อนหลัง
function Step({ number, title, hint, children }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="flex h-6 w-6 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-brand-600 text-[12px] font-bold text-white">
          {number}
        </span>
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        {hint && <span className="text-[12.5px] text-slate-500">{hint}</span>}
      </div>
      <div className="mt-3 sm:pl-[34px]">{children}</div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-control bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold text-slate-900 tabular">{value}</div>
    </div>
  );
}

function AdCard({ ad }) {
  const isActive = !ad.ad_delivery_stop_time;
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-slate-900">
            {ad.page_name || "ไม่ทราบชื่อเพจ"}
          </div>
          <div className="mt-0.5 truncate text-2xs text-slate-400">
            เริ่มยิง {fmtDate(ad.ad_delivery_start_time)}
          </div>
        </div>
        <Badge tone={isActive ? "green" : "slate"} dot className="shrink-0">
          {isActive ? "กำลังยิงอยู่" : "หยุดแล้ว"}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={Eye} label="คนเห็น" value={fmtNumber(ad.reach)} />
          <Stat icon={Megaphone} label="ครั้งที่แสดง" value={fmtNumber(ad.impressions)} />
          <Stat
            icon={Wallet}
            label="ใช้จ่าย"
            value={ad.spend ? `${ad.currency || ""} ${fmtNumber(ad.spend)}`.trim() : "-"}
          />
        </div>
        <div className="min-w-0 text-2xs text-slate-400">
          ลงบน {(ad.publisher_platforms || []).join(", ") || "-"} · Page ID {ad.page_id || "-"}
        </div>
      </div>

      {ad.ad_snapshot_url && (
        <div className="border-t border-slate-100 p-3">
          <Button
            variant="secondary"
            className="w-full"
            icon={ExternalLink}
            onClick={() => window.open(ad.ad_snapshot_url, "_blank", "noopener")}
          >
            ดูโฆษณาตัวจริง
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function AdLibraryTab() {
  const [terms, setTerms] = useState("");
  const [country, setCountry] = useState("TH");
  const [status, setStatus] = useState("ACTIVE");
  const [adType, setAdType] = useState("ALL");
  const [pageIds, setPageIds] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const parsedTerms = useMemo(
    () => terms.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
    [terms]
  );
  const isQuickCountry = QUICK_COUNTRIES.includes(country);
  const canSearch = parsedTerms.length > 0 && !loading;

  async function search() {
    if (!parsedTerms.length) return;
    setLoading(true);
    setError("");
    setResult(null);
    const { data, error: fnError } = await supabase.functions.invoke("search-meta-ad-library", {
      body: {
        search_terms: parsedTerms,
        ad_reached_countries: [country],
        ad_active_status: status,
        ad_type: adType,
        search_page_ids: pageIds,
      },
    });
    setLoading(false);
    if (fnError) {
      setError(await readFunctionErrorMessage(fnError));
      return;
    }
    if (!data?.ok) {
      setError(data?.error || "ค้นหาโฆษณาไม่สำเร็จ");
      return;
    }
    setResult(data);
  }

  function openOnMeta() {
    if (!parsedTerms.length) return;
    window.open(adLibraryWebUrl(parsedTerms, country, status), "_blank", "noopener");
  }

  function searchExample(word) {
    setTerms(word);
    setError("");
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] min-w-0 space-y-5">
      <SectionTitle
        eyebrow="Meta Ad Library"
        title="ดูโฆษณาของคู่แข่ง"
        subtitle="พิมพ์คำที่อยากรู้ แล้วกดค้นหา ระบบจะดึงโฆษณาที่กำลังยิงอยู่จริงบน Facebook และ Instagram มาให้ดู"
        right={
          <span className="hidden rounded-full bg-brand-50 px-3 py-1.5 text-2xs font-medium text-brand-700 sm:inline-block">
            ข้อมูลสาธารณะจาก Meta · ดูได้อย่างเดียว
          </span>
        }
      />

      <Card className="min-w-0 space-y-6 p-4 sm:p-6">
        <Step number={1} title="พิมพ์คำที่อยากค้นหา" hint="เช่น ชื่อสินค้า หรือชื่อเพจคู่แข่ง">
          <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") search();
                }}
                className="h-12 pl-11 text-[15px]"
                placeholder="พิมพ์ที่นี่ เช่น forex"
                aria-label="คำค้นหา"
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              icon={Search}
              loading={loading}
              disabled={!canSearch}
              onClick={search}
              className="h-12 shrink-0 sm:w-40"
            >
              {loading ? "กำลังค้นหา..." : "ค้นหา"}
            </Button>
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-2xs text-slate-400">ลองคำนี้:</span>
            {EXAMPLES.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => searchExample(word)}
                className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-2xs text-slate-600 transition-colors hover:border-brand-500 hover:text-brand-700"
              >
                {word}
              </button>
            ))}
          </div>
          {parsedTerms.length > 1 && (
            <div className="mt-2 text-2xs text-slate-400">
              จะค้นหา {parsedTerms.length} คำพร้อมกัน: {parsedTerms.join(" · ")}
            </div>
          )}
        </Step>

        <Step number={2} title="เลือกประเทศ" hint="ประเทศที่โฆษณานี้เผยแพร่ถึง">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {QUICK_COUNTRIES.map((code) => (
              <FilterPill
                key={code}
                active={country === code}
                onClick={() => setCountry(code)}
                className="px-4 py-2 text-sm"
              >
                <span className="mr-1.5">{flagOf(code)}</span>
                {countryName(code)}
              </FilterPill>
            ))}
            {/* ประเทศที่เลือกจากเมนูจะโผล่เป็นปุ่มด้วย ผู้ใช้จึงเห็นตลอดว่าตอนนี้ค้นประเทศไหน */}
            {!isQuickCountry && (
              <FilterPill active className="px-4 py-2 text-sm">
                <span className="mr-1.5">{flagOf(country)}</span>
                {countryName(country)} ({country})
              </FilterPill>
            )}
            <div className="w-[230px] shrink-0">
              <Select
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                className="rounded-full py-2 text-sm"
                aria-label="เลือกประเทศทั้งหมด"
              >
                {ALL_COUNTRIES.map(({ code, name, flag }) => (
                  <option key={code} value={code}>
                    {flag} {name} ({code})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-2.5 text-2xs text-slate-500">
            กำลังจะค้นโฆษณาที่เข้าถึงคนใน{" "}
            <strong className="font-semibold text-slate-700">
              {flagOf(country)} {countryName(country)} ({country})
            </strong>{" "}
            · เลือกจากเมนูได้ทั้งหมด {ALL_COUNTRIES.length} ประเทศ
          </div>
        </Step>

        <Step number={3} title="เลือกสถานะโฆษณา" hint="ปกติเลือก “กำลังยิงอยู่” ก็พอ">
          <div className="flex min-w-0 flex-wrap gap-2">
            {STATUSES.map(([value, label]) => (
              <FilterPill
                key={value}
                active={status === value}
                onClick={() => setStatus(value)}
                className="px-4 py-2 text-sm"
              >
                {label}
              </FilterPill>
            ))}
          </div>
        </Step>

        <div className="border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500 transition-colors hover:text-slate-700"
          >
            <ChevronDown size={15} className={showAdvanced ? "rotate-180 transition-transform" : "transition-transform"} />
            ตัวเลือกเพิ่มเติม (ไม่ใส่ก็ได้)
          </button>
          {showAdvanced && (
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="ประเภทโฆษณา">
                <Select value={adType} onChange={(event) => setAdType(event.target.value)}>
                  <option value="ALL">ทุกประเภท</option>
                  <option value="POLITICAL_AND_ISSUE_ADS">การเมือง/ประเด็นสังคม</option>
                </Select>
              </Field>
              <Field label="เจาะจงเพจ" hint="ใส่ Page ID คั่นด้วยเครื่องหมายจุลภาค">
                <Input
                  value={pageIds}
                  onChange={(event) => setPageIds(event.target.value)}
                  placeholder="เช่น 1234567890, 9876543210"
                />
              </Field>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-card border border-rose-200 bg-rose-50 p-4">
          <AlertCircle size={20} className="shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-rose-700">ค้นหาไม่สำเร็จ</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-rose-700">{explainError(error)}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={search}>
              ลองอีกครั้ง
            </Button>
            <Button variant="primary" size="sm" icon={ExternalLink} onClick={openOnMeta}>
              เปิดดูในเว็บ Meta
            </Button>
          </div>
        </div>
      )}

      {loading && (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Card key={index} className="space-y-3 p-4">
              <Skeleton h={18} className="w-2/3" />
              <Skeleton h={54} className="w-full" />
              <Skeleton h={14} className="w-1/2" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !result && !error && (
        <Card>
          <EmptyState
            icon={Globe2}
            title="ยังไม่ได้ค้นหา"
            hint="พิมพ์คำที่อยากรู้ในช่องด้านบน แล้วกดปุ่มสีน้ำเงิน “ค้นหา” ได้เลย"
          />
        </Card>
      )}

      {!loading && result && (
        <section className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="text-[15px] font-semibold text-slate-900">
              เจอโฆษณา {result.count?.toLocaleString("th-TH")} ชิ้น
            </div>
            <div className="min-w-0 truncate text-[12.5px] text-slate-500">
              จากคำว่า “{result.query?.terms?.join(", ")}” ในประเทศ
              {" "}
              {(result.query?.countries || []).map((code) => `${flagOf(code)} ${countryName(code)}`).join(", ")}
            </div>
            {result.truncated && (
              <Badge tone="gold">แสดงบางส่วน เพราะผลลัพธ์เยอะมาก</Badge>
            )}
          </div>

          {result.count === 0 ? (
            <Card>
              <EmptyState
                icon={Search}
                title="ไม่เจอโฆษณาตามที่ค้น"
                hint="ลองเปลี่ยนคำให้สั้นลง เปลี่ยนประเทศ หรือเลือกสถานะเป็น “ทั้งหมด” แล้วค้นอีกครั้ง"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="secondary" onClick={() => setStatus("ALL")}>
                      เปลี่ยนเป็นทั้งหมด
                    </Button>
                    <Button variant="primary" icon={ExternalLink} onClick={openOnMeta}>
                      เปิดดูในเว็บ Meta
                    </Button>
                  </div>
                }
              />
            </Card>
          ) : (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
