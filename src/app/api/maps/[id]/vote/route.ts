import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getVoterId, newVoterId, VOTER_COOKIE } from "@/lib/voter";
import { tallyMap } from "@/lib/votes";

export const runtime = "nodejs";

// POST /api/maps/:id/vote — toggle the caller's vote on one parcel.
// Voter identity is a server-set httpOnly cookie: one vote per parcel per browser.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { parcel_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parcelId = String(body?.parcel_id ?? "");
  if (!parcelId) {
    return NextResponse.json({ error: "parcel_id is required." }, { status: 400 });
  }

  const { data: map, error: mapErr } = await db
    .from("maps")
    .select("id, is_open")
    .eq("id", params.id)
    .single();
  if (mapErr || !map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }
  if (!map.is_open) {
    return NextResponse.json({ error: "This map is closed to new votes." }, { status: 403 });
  }

  let voterId = getVoterId(req);
  const isNewVoter = !voterId;
  if (!voterId) voterId = newVoterId();

  // Toggle: remove the vote if it exists, otherwise add it.
  const { data: existing } = await db
    .from("votes")
    .select("id")
    .eq("map_id", map.id)
    .eq("parcel_id", parcelId)
    .eq("voter_id", voterId)
    .maybeSingle();

  if (existing) {
    await db.from("votes").delete().eq("id", existing.id);
  } else {
    const { error: insErr } = await db
      .from("votes")
      .insert({ map_id: map.id, parcel_id: parcelId, voter_id: voterId });
    // Ignore unique-violation races (double click); surface anything else.
    if (insErr && insErr.code !== "23505") {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const tally = await tallyMap(map.id, voterId);
  const res = NextResponse.json(tally);
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
