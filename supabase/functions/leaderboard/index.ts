// supabase/functions/leaderboard/index.ts
// เลิกใช้แล้ว — กระดานแต้มย้ายไปอ่านสมุด point_events ผ่านฟังก์ชัน `points`
// (เดิมคิดแต้มสดจาก reply_stats ทุกครั้ง แต้มย้อนหลังจึงเปลี่ยนตามการตั้งค่า และนับซ้ำได้)
// ยังเปิดไว้เพื่อให้หน้าเว็บเวอร์ชันเก่าที่ค้างในเครื่องได้ข้อความให้รีเฟรช แทนที่จะโชว์แต้มอีกชุดที่ไม่ตรงกัน
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({ ok: false, error: "กระดานแต้มย้ายไประบบใหม่แล้ว — กรุณารีเฟรชหน้าเว็บ" }), {
    status: 410, headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
