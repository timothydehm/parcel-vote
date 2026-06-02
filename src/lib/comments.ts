import { db } from "./supabase";

// Number of comments per parcel for a map (parcel __pid -> count).
// Returns {} if the comments table can't be read (e.g. it hasn't been created
// yet), so the map keeps loading instead of erroring.
export async function commentCounts(mapId: string): Promise<Record<string, number>> {
  const { data, error } = await db
    .from("comments")
    .select("parcel_id")
    .eq("map_id", mapId);
  if (error) return {};

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.parcel_id] = (counts[row.parcel_id] ?? 0) + 1;
  }
  return counts;
}
