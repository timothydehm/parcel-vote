// Pure helpers for talking to a county ArcGIS parcel service from the browser.
export type ArcgisField = { name: string };

export const DEFAULT_SOURCE =
  "https://gis.cuyahogacounty.gov/server/rest/services/MyPlace/Full_Map_Parcel_Fabric/MapServer";

export const SOURCE_OPTIONS: { label: string; url: string }[] = [
  { label: "Cuyahoga County — Full Map Parcel Fabric", url: "https://gis.cuyahogacounty.gov/server/rest/services/MyPlace/Full_Map_Parcel_Fabric/MapServer" },
  { label: "Cuyahoga County — Current Year Appraisal Parcels", url: "https://gis.cuyahogacounty.gov/server/rest/services/CCFO/Current_Year_Appraisal_Parcels/MapServer" },
  { label: "Cuyahoga County — Parcels (WGS84)", url: "https://maps.cuyahogacounty.us/arcgis/rest/services/MyPLACE/Parcels_WGS84/MapServer" },
];

const PIN_PATTERNS = [/^parcel_?pin$/i, /^ppn$/i, /^parcel_?id$/i, /^parcel_?number$/i, /^pin$/i, /pin/i];
const OWNER_PATTERNS = [/^deeded_?owner$/i, /^parcel_?owner$/i, /^owner_?name$/i, /^own_?name$/i, /^owner$/i, /^taxpayer_?name$/i, /owner/i];

export function findPinField(fields: ArcgisField[] | undefined): string | null {
  const names = (fields || []).map((f) => f.name);
  for (const re of PIN_PATTERNS) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return null;
}

export function findOwnerField(fields: ArcgisField[] | undefined): string | null {
  const names = (fields || []).map((f) => f.name).filter((n) => !/addr|city|state|zip|mail|date|occ/i.test(n));
  for (const re of OWNER_PATTERNS) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return null;
}

export function esriToGeo(fs: {
  features?: { attributes?: Record<string, unknown>; geometry?: { rings?: unknown } }[];
}): { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Polygon"; coordinates: unknown } | null }[] {
  return (fs.features || []).map((f) => ({
    type: "Feature" as const,
    properties: f.attributes || {},
    geometry: f.geometry && f.geometry.rings ? { type: "Polygon" as const, coordinates: f.geometry.rings } : null,
  }));
}
