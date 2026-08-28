import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon-64.png|apple-touch-icon.png|icon-.*\\.png|manifest.webmanifest|sw.js|version.json).*)",
  ],
};
