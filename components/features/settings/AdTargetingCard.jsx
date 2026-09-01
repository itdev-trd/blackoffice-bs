"use client";

// การ์ดคุมค่าที่ Meta Ads Manager มีแต่ระบบเราเคยฝังตายไว้ในโค้ด
// เขียนลง settings.launch_config (คีย์เดียวกับที่ AI วิเคราะห์แล้วเซฟ) แบบ merge
// -> ค่าที่ AI ตั้งให้ (copy_length / creative_format / bid_strategy ฯลฯ) ต้องไม่หายเวลาแอดมินแก้ตรงนี้
// ฝั่งรับคือ supabase/functions/launch-campaign/index.ts

import { useState } from "react";
import { Plus, X } from "lucide-react";

const OBJECTIVES = [
  {
    value: "OUTCOME_LEADS",
    label: "เก็บลีด",
    desc: "ให้คนกรอกฟอร์ม/สมัคร วัดผลจาก Pixel หรือฟอร์มในเพจ",
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "ให้คนทักแชท",
    desc: "พาคนเข้ากล่องข้อความ Messenger หรือ IG โดยตรง",
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "คลิกไปเว็บ",
    desc: "ส่งคนไปหน้าเว็บ/แลนดิ้ง เน้นจำนวนคลิก",
  },
];

// รหัสประเทศ ISO-3166 alpha-2 — ชุดที่ใช้บ่อยในตลาดนี้ เลือกนอกเหนือจากนี้ได้ด้วยช่องเพิ่มเอง
const COMMON_COUNTRIES = [
  ["TH", "ไทย"],
  ["MY", "มาเลเซีย"],
  ["SG", "สิงคโปร์"],
  ["ID", "อินโดนีเซีย"],
  ["VN", "เวียดนาม"],
  ["PH", "ฟิลิปปินส์"],
  ["LA", "ลาว"],
  ["KH", "กัมพูชา"],
  ["MM", "เมียนมา"],
  ["TW", "ไต้หวัน"],
];

const GENDER_OPTIONS = [
  [null, "ทุกเพศ"],
  [1, "ชาย"],
  [2, "หญิง"],
];

const PLATFORMS = [
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["messenger", "Messenger"],
];

// ตำแหน่งย่อยที่เปิดให้เลือก — ตรงกับ ALLOWED_POSITIONS ฝั่ง edge function เป๊ะๆ
// ถ้าเพิ่มตรงนี้ต้องไปเพิ่มฝั่งโน้นด้วย ไม่งั้นจะถูกกรองทิ้งเงียบๆ
const POSITIONS = {
  facebook_positions: [
    ["feed", "หน้าฟีด"],
    ["facebook_reels", "Reels"],
    ["story", "สตอรี่"],
    ["marketplace", "Marketplace"],
    ["video_feeds", "ฟีดวิดีโอ"],
  ],
  instagram_positions: [
    ["stream", "หน้าฟีด"],
    ["reels", "Reels"],
    ["story", "สตอรี่"],
    ["explore", "Explore"],
    ["profile_feed", "ฟีดโปรไฟล์"],
  ],
};

const chipOn = "border-brand-600 bg-brand-600 text-white";
const chipOff = "border-slate-300 bg-white text-slate-600 hover:border-slate-400";
function Chip({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${active ? chipOn : chipOff}`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-sm text-slate-600">{label}</label>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// Meta รับ ISO 8601 — <input type="datetime-local"> ให้เวลาท้องถิ่นไม่มีโซน จึงเก็บดิบไว้แล้วให้ backend แปลง
// (new Date("2026-09-01T10:00") ตีความเป็นเวลาเครื่อง ซึ่งคือสิ่งที่แอดมินตั้งใจพอดี)
export default function AdTargetingCard({ value, onChange }) {
  const cfg = value || {};
  const [customCountry, setCustomCountry] = useState("");

  const set = (patch) => onChange({ ...cfg, ...patch });

  const objective = OBJECTIVES.some((o) => o.value === cfg.objective) ? cfg.objective : "OUTCOME_LEADS";
  const countries = Array.isArray(cfg.countries) && cfg.countries.length ? cfg.countries : ["TH"];
  const genders = Array.isArray(cfg.genders) ? cfg.genders : [];
  const gender = genders.length === 1 ? genders[0] : null;
  const placements = cfg.placements || {};
  const manual = placements.mode === "manual";
  const platforms = Array.isArray(placements.publisher_platforms) ? placements.publisher_platforms : [];

  function toggleCountry(code) {
    const next = countries.includes(code) ? countries.filter((c) => c !== code) : [...countries, code];
    // ห้ามว่าง — ไม่มีประเทศ = Meta ปฏิเสธทั้ง adset
    set({ countries: next.length ? next : ["TH"] });
  }

  function addCustomCountry() {
    const code = customCountry.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || countries.includes(code)) return;
    set({ countries: [...countries, code] });
    setCustomCountry("");
  }

  function setPlacements(patch) {
    set({ placements: { ...placements, ...patch } });
  }

  function togglePlatform(p) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    setPlacements({ mode: "manual", publisher_platforms: next });
  }

  function togglePosition(key, val) {
    const cur = Array.isArray(placements[key]) ? placements[key] : [];
    const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
    setPlacements({ [key]: next });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
      <div>
        <h3 className="font-semibold text-slate-800">การยิงแอด (เหมือนใน Ads Manager)</h3>
        <p className="text-xs text-slate-500 mt-1">
          ค่าที่ตั้งตรงนี้จะใช้กับทุกแคมเปญที่กดลอนช์จากหน้า "รออนุมัติ" — ทุกแคมเปญยังถูกสร้างแบบ{" "}
          <span className="font-medium text-slate-600">หยุดชั่วคราว (PAUSED)</span> เสมอ ต้องไปกดเปิดเองใน Ads Manager
        </p>
      </div>

      <Field label="เป้าหมายแคมเปญ">
        <div className="grid gap-2 sm:grid-cols-3">
          {OBJECTIVES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set({ objective: o.value })}
              className={`text-left rounded-xl border p-3 transition ${
                objective === o.value ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className={`text-sm font-semibold ${objective === o.value ? "text-brand-700" : "text-slate-700"}`}>
                {o.label}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 leading-snug">{o.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      {objective === "OUTCOME_ENGAGEMENT" && (
        <Field label="ให้ทักเข้ากล่องไหน" hint="ต้องตั้ง Facebook Page ID ในการ์ดด้านบนก่อน ไม่งั้นลอนช์ไม่ผ่าน">
          <div className="flex gap-2">
            {[
              ["MESSENGER", "Messenger"],
              ["INSTAGRAM_DIRECT", "Instagram Direct"],
            ].map(([v, l]) => (
              <Chip
                key={v}
                active={(cfg.message_destination || "MESSENGER") === v}
                onClick={() => set({ message_destination: v })}
              >
                {l}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <Field label="ประเทศ" hint="เลือกได้หลายประเทศ — ถ้าไม่เลือกเลยระบบใช้ไทยเป็นค่าเริ่มต้น">
        <div className="flex flex-wrap gap-1.5">
          {COMMON_COUNTRIES.map(([code, name]) => (
            <Chip key={code} active={countries.includes(code)} onClick={() => toggleCountry(code)} title={code}>
              {name}
            </Chip>
          ))}
          {/* ประเทศที่ไม่อยู่ในลิสต์ยอดนิยม — โชว์เป็นชิปถอดได้ */}
          {countries
            .filter((c) => !COMMON_COUNTRIES.some(([code]) => code === c))
            .map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white"
              >
                {c}
                <button type="button" onClick={() => toggleCountry(c)} aria-label={`เอา ${c} ออก`}>
                  <X size={13} />
                </button>
              </span>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={customCountry}
            onChange={(e) => setCustomCountry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomCountry();
              }
            }}
            maxLength={2}
            placeholder="เพิ่มเอง เช่น JP"
            className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
          />
          <button
            type="button"
            onClick={addCustomCountry}
            className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus size={15} /> เพิ่ม
          </button>
        </div>
      </Field>

      <Field label="เพศ">
        <div className="flex gap-2">
          {GENDER_OPTIONS.map(([v, l]) => (
            <Chip key={l} active={gender === v} onClick={() => set({ genders: v === null ? [] : [v] })}>
              {l}
            </Chip>
          ))}
        </div>
      </Field>

      <Field
        label="ช่วงอายุ"
        hint='ตั้งที่การ์ด "ค่าเริ่มต้นแคมเปญ" ด้านบน (อายุขั้นต่ำ/สูงสุด) — ใช้เมื่อยังไม่ได้ระบุ Audience ID'
      >
        <div className="text-sm text-slate-500">
          ปัจจุบันใช้ค่าจากการ์ดด้านบน ถ้าเว้นว่างไว้ระบบใช้ 22–55 ปี
        </div>
      </Field>

      <Field
        label="ตำแหน่งจัดวาง"
        hint="Advantage+ = ให้ Meta เลือกให้เอง (แนะนำถ้ายังไม่มีข้อมูลมากพอ) · Audience Network ถูกตัดออกเสมอเพื่อกันแชทผี"
      >
        <div className="flex gap-2">
          <Chip active={!manual} onClick={() => setPlacements({ mode: "advantage" })}>
            Advantage+ (อัตโนมัติ)
          </Chip>
          <Chip
            active={manual}
            onClick={() =>
              setPlacements({
                mode: "manual",
                publisher_platforms: platforms.length ? platforms : ["facebook", "instagram"],
              })
            }
          >
            กำหนดเอง
          </Chip>
        </div>
        {manual && (
          <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div>
              <div className="text-[12px] font-medium text-slate-600 mb-1.5">แพลตฟอร์ม</div>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map(([p, l]) => (
                  <Chip key={p} active={platforms.includes(p)} onClick={() => togglePlatform(p)}>
                    {l}
                  </Chip>
                ))}
              </div>
              {platforms.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1.5">
                  ยังไม่ได้เลือกแพลตฟอร์ม — ระบบจะกลับไปใช้ Advantage+ ให้อัตโนมัติ
                </p>
              )}
            </div>
            {[
              ["facebook", "facebook_positions", "ตำแหน่งบน Facebook"],
              ["instagram", "instagram_positions", "ตำแหน่งบน Instagram"],
            ]
              .filter(([p]) => platforms.includes(p))
              .map(([, key, label]) => (
                <div key={key}>
                  <div className="text-[12px] font-medium text-slate-600 mb-1.5">
                    {label} <span className="font-normal text-slate-400">(ไม่เลือก = ทุกตำแหน่ง)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {POSITIONS[key].map(([v, l]) => (
                      <Chip
                        key={v}
                        active={(placements[key] || []).includes(v)}
                        onClick={() => togglePosition(key, v)}
                      >
                        {l}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </Field>

      <Field label="กำหนดเวลา" hint="เว้นว่าง = เริ่มทันทีที่กดเปิด และยิงต่อเนื่องจนสั่งหยุดเอง">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[12px] text-slate-500 mb-1">วันเริ่ม</div>
            <input
              type="datetime-local"
              value={cfg.start_time || ""}
              onChange={(e) => set({ start_time: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <div className="text-[12px] text-slate-500 mb-1">วันจบ</div>
            <input
              type="datetime-local"
              value={cfg.end_time || ""}
              min={cfg.start_time || undefined}
              onChange={(e) => set({ end_time: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {cfg.start_time && cfg.end_time && cfg.end_time <= cfg.start_time && (
          <p className="text-[11px] text-amber-600 mt-1.5">วันจบต้องหลังวันเริ่ม — ตอนนี้ระบบจะข้ามวันจบไปให้ยิงต่อเนื่อง</p>
        )}
      </Field>
    </div>
  );
}
