import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getParticipant } from "@/lib/auth";
import { tallyMap } from "@/lib/votes";
import { commentCounts } from "@/lib/comments";

export const runtime = "nodejs";

// GET /api/maps/:id — map, tally, your votes, comment counts, and the name you
// are signed in as on this map (me), or null if not joined.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { data: map, error } = await db
    .from("maps")
    .select("id, question, parcels, is_open")
    .eq("id", params.id)
    .single();
  if (error || !map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }

  const me = await getParticipant(req, map.id);
  const { counts, totalVoters, yourVotes } = await tallyMap(map.id, me?.id ?? null);
  const cc = await commentCounts(map.id);
  return NextResponse.json({
    ...map,
    counts,
    totalVoters,
    yourVotes,
    commentCounts: cc,
    me: me?.name ?? null,
  });
}
