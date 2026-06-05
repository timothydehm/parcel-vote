import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/maps/:id/logout — end the current session (switch name).
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.from("sessions").delete().eq("token", token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
