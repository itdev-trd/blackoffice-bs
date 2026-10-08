import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// รีเฟรช session cookie ทุก request + เด้งไปหน้า login ถ้ายังไม่ล็อกอินและพยายามเข้าโซนแดชบอร์ด
export async function updateSession(request) {
  // middleware ทำงานทุก request — ถ้า env หายจะพังทั้งเว็บเป็น 500 โดยไม่บอกสาเหตุ
  // ปล่อยผ่านไปให้หน้าเว็บแสดงข้อความที่อ่านรู้เรื่องแทน (client.js ดักไว้อีกชั้น)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("[middleware] ไม่พบ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // getUser() ยิงไปเซิร์ฟเวอร์ Auth (ใช้ฐานข้อมูล) ทุกหน้า — ฐานข้อมูลช้า/ล่มเมื่อไหร่ ทุกหน้าค้างจน Vercel ตัด
  // เป็น 504 MIDDLEWARE_INVOCATION_TIMEOUT (เจอจริง 8 ต.ค. 69) · ตั้งเพดาน 2.5 วิ ถ้าไม่ทันให้ดูแค่ว่ามีคุกกี้ล็อกอินไหม
  // ปลอดภัย: ข้อมูลจริงทุกชิ้นถูกคุมด้วย RLS ฝั่งฐานข้อมูลอยู่แล้ว middleware แค่พาไปหน้า login ให้ถูกที่
  const hasAuthCookie = request.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name));
  let user = null;
  try {
    const res = await Promise.race([
      supabase.auth.getUser(),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 2500)),
    ]);
    user = res?.timedOut ? (hasAuthCookie ? { fromCookie: true } : null) : res?.data?.user ?? null;
  } catch {
    user = hasAuthCookie ? { fromCookie: true } : null;
  }

  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    return NextResponse.redirect(url);
  }

  return response;
}
