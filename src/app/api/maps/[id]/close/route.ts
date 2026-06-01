import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/maps/:id/close?token=ADMIN  — open or close a map.
// Body: { is_open: boolean }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = new URL(req.url).searchParams.get("token") ?? "";

  let body: { is_open?: unknown };
  try {
    body = await req.json();
  } catch {
    body = { is_open: false };
  }
  const isOpen = Boolean(body?.is_open);

  const { data: map } = await db
    .from("maps")
    .select("id, admin_token")
    .eq("id", params.id)
    .single();
  if (!map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }
  if (!token || token !== map.admin_token) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { error } = await db.from("maps").update({ is_open: isOpen }).eq("id", map.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, is_open: isOpen });
}
