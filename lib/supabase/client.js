"use client";

import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// export ไว้ให้ service worker ใช้ต่ออายุ push subscription ตอนแอปปิด (pushsubscriptionchange)
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// ใช้ browser client ของ SSR package เพื่อเก็บ session ใน cookie ด้วย
// middleware จึงมองเห็น session หลัง login และไม่ redirect กลับ /login วนซ้ำ
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
