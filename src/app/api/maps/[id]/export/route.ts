import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { tallyMap } from "@/lib/votes";
import type { ParcelFeature } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/maps/:id/export?token=ADMIN&format=geojson|csv
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const format = (url.searchParams.get("format") ?? "geojson").toLowerCase();

  const { data: map } = await db
    .from("maps")
    .select("id, question, parcels, admin_token")
    .eq("id", params.id)
    .single();
  if (!map) {
    return NextResponse.json({ error: "Map not found." }, { status: 404 });
  }
  if (!token || token !== map.admin_token) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { counts, totalVoters } = await tallyMap(map.id, null);
  const features = (map.parcels as { features: ParcelFeature[] }).features;

  if (format === "csv") {
    const rows = [["parcel_id", "votes", "share", "total_voters"]];
    for (const f of features) {
      const pid = f.properties.__pid;
      const v = counts[pid] ?? 0;
      rows.push([pid, String(v), totalVoters ? (v / totalVoters).toFixed(4) : "0", String(totalVoters)]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="parcel-pulse-${map.id}.csv"`,
      },
    });
  }

  const out = {
    type: "FeatureCollection",
    features: features.map((f) => {
      const pid = f.properties.__pid;
      const v = counts[pid] ?? 0;
      return {
        ...f,
        properties: { ...f.properties, votes: v, share: totalVoters ? v / totalVoters : 0 },
      };
    }),
  };
  return new NextResponse(JSON.stringify(out), {
    headers: {
      "content-type": "application/geo+json",
      "content-disposition": `attachment; filename="parcel-pulse-${map.id}.geojson"`,
    },
  });
}
