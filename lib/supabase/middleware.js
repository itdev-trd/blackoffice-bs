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

  const { data: { user } } = await supabase.auth.getUser();

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
