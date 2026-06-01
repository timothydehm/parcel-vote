import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getVoterId } from "@/lib/voter";
import { tallyMap } from "@/lib/votes";

export const runtime = "nodejs";

// GET /api/maps/:id — map question, parcels, open state, live tally, your votes.
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
  return NextResponse.json({ ...map, counts, totalVoters, yourVotes });
}
