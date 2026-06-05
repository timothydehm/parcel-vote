import { db } from "./supabase";

// Per-parcel comment counts, computed in the database via the comment_tally()
// function. Returns {} if the call fails so the map keeps loading.
export async function commentCounts(mapId: string): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("comment_tally", { p_map_id: mapId });
  if (error || !data) return {};
  return data as Record<string, number>;
}
