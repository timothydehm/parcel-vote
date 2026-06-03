import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/maps/:id/close?token=ADMIN — update map settings (admin only).
// Body may include { is_open?: boolean, vote_limit?: number | null }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = new URL(req.url).searchParams.get("token") ?? "";

  let body: { is_open?: unknown; vote_limit?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: map } = await db.from("maps").select("id, admin_token").eq("id", params.id).single();
  if (!map) return NextResponse.json({ error: "Map not found." }, { status: 404 });
  if (!token || token !== map.admin_token) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const update: Record<string, unknown> = {};
  if ("is_open" in body) update.is_open = Boolean(body.is_open);
  if ("vote_limit" in body) {
    const v = body.vote_limit;
    if (v === null || v === undefined || v === "") {
      update.vote_limit = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json(
          { error: "Votes per person must be a whole number of 1 or more." },
          { status: 400 },
        );
      }
      update.vote_limit = Math.min(1000, Math.floor(n));
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await db.from("maps").update(update).eq("id", map.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...update });
}
