import { db } from "./supabase";

// Per-parcel vote counts + distinct-voter total, computed in the database via
// the vote_tally() function (a GROUP BY) so we transfer small aggregates instead
// of every vote row. yourVotes is a tiny per-person lookup.
export async function tallyMap(mapId: string, voterId: string | null) {
  const { data } = await db.rpc("vote_tally", { p_map_id: mapId });
  const counts = ((data && data.counts) ?? {}) as Record<string, number>;
  const totalVoters = ((data && data.total_voters) ?? 0) as number;

  let yourVotes: string[] = [];
  if (voterId) {
    const { data: mine } = await db
      .from("votes")
      .select("parcel_id")
      .eq("map_id", mapId)
      .eq("voter_id", voterId);
    yourVotes = (mine ?? []).map((r: { parcel_id: string }) => r.parcel_id);
  }
  return { counts, totalVoters, yourVotes };
}
