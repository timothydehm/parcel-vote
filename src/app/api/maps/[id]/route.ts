import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getVoterId } from "@/lib/voter";
import { tallyMap } from "@/lib/votes";
import { commentCounts } from "@/lib/comments";

export const runtime = "nodejs";

// GET /api/maps/:id — map question, parcels, open state, tally, your votes,
// and the comment count per parcel.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: map, error } = await db
    .from("maps")
    .select("id, question, parcels, is_open")
    .eq("id", params.id)
    .single();

  if (error || !map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }

  const voterId = getVoterId(req);
  const { counts, totalVoters, yourVotes } = await tallyMap(map.id, voterId);
  const cc = await commentCounts(map.id);
  return NextResponse.json({ ...map, counts, totalVoters, yourVotes, commentCounts: cc });
}
