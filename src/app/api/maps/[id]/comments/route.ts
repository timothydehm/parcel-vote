import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getVoterId, newVoterId, VOTER_COOKIE } from "@/lib/voter";

export const runtime = "nodejs";

const MAX_BODY = 500;

async function listComments(mapId: string, parcelId: string) {
  return db
    .from("comments")
    .select("id, body, created_at")
    .eq("map_id", mapId)
    .eq("parcel_id", parcelId)
    .order("created_at", { ascending: true });
}

// GET /api/maps/:id/comments?parcel_id=PID — notes for one parcel.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const parcelId = new URL(req.url).searchParams.get("parcel_id") ?? "";
  if (!parcelId) {
    return NextResponse.json({ error: "parcel_id is required." }, { status: 400 });
  }
  const { data, error } = await listComments(params.id, parcelId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ comments: data ?? [] });
}

// POST /api/maps/:id/comments — add a note { parcel_id, body }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { parcel_id?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parcelId = String(body?.parcel_id ?? "");
  const text = String(body?.body ?? "").trim();
  if (!parcelId) {
    return NextResponse.json({ error: "parcel_id is required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Note cannot be empty." }, { status: 400 });
  }
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: `Note is too long (${MAX_BODY} max).` }, { status: 400 });
  }

  const { data: map } = await db
    .from("maps")
    .select("id, is_open")
    .eq("id", params.id)
    .single();
  if (!map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }
  if (!map.is_open) {
    return NextResponse.json({ error: "This map is closed." }, { status: 403 });
  }

  let voterId = getVoterId(req);
  const isNewVoter = !voterId;
  if (!voterId) voterId = newVoterId();

  const { error: insErr } = await db
    .from("comments")
    .insert({ map_id: map.id, parcel_id: parcelId, voter_id: voterId, body: text });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const { data, error } = await listComments(map.id, parcelId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const res = NextResponse.json({ comments: data ?? [] });
  if (isNewVoter) {
    res.cookies.set(VOTER_COOKIE, voterId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
