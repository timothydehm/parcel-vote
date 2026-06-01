import { db } from "./supabase";

// Aggregate votes for a map in one pass.
//  - counts:      parcel __pid -> number of votes
//  - totalVoters: distinct voter_id count (the denominator for "share")
//  - yourVotes:   parcels the given voter has selected
//
// Good to a few thousand votes per map. For very large maps, replace this with
// a SQL `group by` view or an RPC.
export async function tallyMap(mapId: string, voterId: string | null) {
  const { data, error } = await db
    .from("votes")
    .select("parcel_id, voter_id")
    .eq("map_id", mapId);

  if (error) throw error;

  const counts: Record<string, number> = {};
  const voters = new Set<string>();
  const yourVotes: string[] = [];

  for (const row of data ?? []) {
    counts[row.parcel_id] = (counts[row.parcel_id] ?? 0) + 1;
    voters.add(row.voter_id);
    if (voterId && row.voter_id === voterId) yourVotes.push(row.parcel_id);
  }

  return { counts, totalVoters: voters.size, yourVotes };
}
