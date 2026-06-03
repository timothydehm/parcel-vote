import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getParticipant } from "@/lib/auth";
import { tallyMap } from "@/lib/votes";

export const runtime = "nodejs";

// POST /api/maps/:id/vote — toggle the signed-in participant's vote on a parcel.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { parcel_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parcelId = String(body?.parcel_id ?? "");
  if (!parcelId) return NextResponse.json({ error: "parcel_id is required." }, { status: 400 });

  const { data: map } = await db.from("maps").select("id, is_open").eq("id", params.id).single();
  if (!map) return NextResponse.json({ error: "Map not found." }, { status: 404 });
  if (!map.is_open) return NextResponse.json({ error: "This map is closed to new votes." }, { status: 403 });

  const me = await getParticipant(req, map.id);
  if (!me) return NextResponse.json({ error: "Join the map with a name first." }, { status: 401 });

  const { data: existing } = await db
    .from("votes")
    .select("id")
    .eq("map_id", map.id)
    .eq("parcel_id", parcelId)
    .eq("voter_id", me.id)
    .maybeSingle();

  if (existing) {
    await db.from("votes").delete().eq("id", existing.id);
  } else {
    const { error: insErr } = await db
      .from("votes")
      .insert({ map_id: map.id, parcel_id: parcelId, voter_id: me.id });
    if (insErr && insErr.code !== "23505") {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const tally = await tallyMap(map.id, me.id);
  return NextResponse.json(tally);
}
