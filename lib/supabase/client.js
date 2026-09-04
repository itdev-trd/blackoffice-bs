"use client";

import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ลืมตั้ง environment variable บน Vercel เป็นเรื่องที่พลาดกันบ่อยที่สุดตอน deploy
// ถ้าไม่ดักตรงนี้ จะได้ error "Invalid URL" ลอยๆ ซึ่งไล่หาสาเหตุยากมาก
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY — " +
    "ถ้า deploy บน Vercel ให้ไปเพิ่มที่ Project → Settings → Environment Variables แล้ว redeploy"
  );
}

// export ไว้ให้ service worker ใช้ต่ออายุ push subscription ตอนแอปปิด (pushsubscriptionchange)
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// ใช้ browser client ของ SSR package เพื่อเก็บ session ใน cookie ด้วย
// middleware จึงมองเห็น session หลัง login และไม่ redirect กลับ /login วนซ้ำ
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
