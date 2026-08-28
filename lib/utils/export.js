"use client";

// แถบเมนู "ย้อนกลับ / กลับหน้าหลัก" ที่ฝังไปในหน้า export (PDF/HTML) ที่เปิดเป็นแท็บใหม่
export function exportPageNavHtml(backTab = "analyze") {
  const base = `${window.location.origin}${window.location.pathname}`;
  const backUrl = `${base}?tab=${encodeURIComponent(backTab)}`;
  const homeUrl = `${base}?tab=overview`;
  return `<style>
    .export-nav{position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:8px;padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:rgba(255,255,255,.96);border-bottom:1px solid #e2e8f0;box-shadow:0 2px 10px rgba(15,23,42,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    .export-nav button{appearance:none;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#1e293b;font:600 14px system-ui,-apple-system,sans-serif;padding:8px 12px;min-height:40px;cursor:pointer}
    .export-nav .home{margin-left:auto;background:#0f172a;border-color:#0f172a;color:#fff}
    @media print{.export-nav{display:none!important}}
  </style>
  <nav class="export-nav noprint" aria-label="เมนูหน้า Export">
    <button type="button" onclick="exportGoBack()">← ย้อนกลับ</button>
    <button type="button" class="home" onclick="location.replace('${homeUrl}')">⌂ กลับหน้าหลัก</button>
  </nav>
  <script>function exportGoBack(){try{if(window.opener&&!window.opener.closed){window.opener.focus();window.close();return}}catch(e){}try{if(history.length>1){history.back();return}}catch(e){}location.replace('${backUrl}')}</script>`;
}
