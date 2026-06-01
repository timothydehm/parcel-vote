import type { ParcelCollection, ParcelFeature } from "./types";

// Validate an uploaded GeoJSON FeatureCollection and stamp every feature with a
// stable internal id (__pid). Votes reference __pid, so it must be unique and
// must not change after the map is created. Index-based ids guarantee both,
// because the collection is stored once and never reordered.
export function normalizeParcels(raw: unknown): ParcelCollection {
  const fc = raw as { type?: string; features?: unknown[] } | null;
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("Invalid GeoJSON: expected a FeatureCollection.");
  }

  const features: ParcelFeature[] = fc.features
    .filter(
      (f): f is { geometry: unknown; id?: string | number; properties?: Record<string, unknown> } =>
        !!f && typeof f === "object" && "geometry" in f && !!(f as { geometry?: unknown }).geometry,
    )
    .map((f, i) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry,
      properties: { ...(f.properties ?? {}), __pid: "p" + i },
    }));

  if (features.length === 0) {
    throw new Error("GeoJSON has no usable polygon features.");
  }
  return { type: "FeatureCollection", features };
}
