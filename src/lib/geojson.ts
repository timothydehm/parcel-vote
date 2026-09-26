import type { ParcelCollection, ParcelFeature } from "./types";

// Property keys that commonly hold a real parcel identifier (e.g. a Permanent
// Parcel Number like 123-45-678), in priority order. Matched case-insensitively.
const ID_KEY_CANDIDATES = [
  "ppn",
  "parcelpin",
  "parcel_pin",
  "parcel_number",
  "parcelnumber",
  "parcel_no",
  "parcelno",
  "parcel_id",
  "parcelid",
  "parcel",
  "pin",
  "apn",
  "gpin",
  "sbl",
];

// Values that look like a parcel number: digits and dashes, e.g. 123-45-678.
const PARCEL_VALUE_RE = /^\d[\d-]{4,}\d$/;

type LooseFeature = {
  geometry: unknown;
  id?: string | number;
  properties?: Record<string, unknown>;
};

type KeyStat = {
  actual: string;
  nonEmpty: number;
  values: string[];
};

function val(props: Record<string, unknown>, key: string): string {
  const v = props[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function isUsableFeature(f: unknown): f is LooseFeature {
  if (!f || typeof f !== "object") return false;
  const maybe = f as { geometry?: unknown };
  return "geometry" in f && !!maybe.geometry;
}

// Decide which property holds the parcel id. Prefer a known key name; otherwise
// fall back to any column whose values look like parcel numbers and are mostly
// unique. Returns null when nothing suitable is found (then we use p0, p1, ...).
function pickIdKey(features: LooseFeature[]): string | null {
  const total = features.length;
  const keys: Record<string, KeyStat> = {};

  for (const f of features) {
    const props = f.properties ?? {};
    for (const k of Object.keys(props)) {
      const lk = k.toLowerCase();
      if (!keys[lk]) keys[lk] = { actual: k, nonEmpty: 0, values: [] };
      const v = val(props, k);
      if (v) {
        keys[lk].nonEmpty++;
        keys[lk].values.push(v);
      }
    }
  }

  const threshold = Math.ceil(total * 0.95);

  // 1) A known parcel-id key, present on (almost) every feature.
  for (const cand of ID_KEY_CANDIDATES) {
    const hit = keys[cand];
    if (hit && hit.nonEmpty >= threshold) return hit.actual;
  }

  // 2) Any key whose values look like parcel numbers and are mostly unique.
  let best: { actual: string; score: number } | null = null;
  for (const lk of Object.keys(keys)) {
    const hit = keys[lk];
    if (hit.nonEmpty < threshold || hit.values.length === 0) continue;
    const n = hit.values.length;
    const looks = hit.values.filter((v) => PARCEL_VALUE_RE.test(v)).length;
    const uniques = new Set(hit.values).size;
    const lookRate = looks / n;
    const uniqueRate = uniques / n;
    if (lookRate >= 0.8 && uniqueRate >= 0.8) {
      const score = lookRate + uniqueRate;
      if (!best || score > best.score) best = { actual: hit.actual, score };
    }
  }

  return best ? best.actual : null;
}

export function normalizeParcels(raw: unknown): ParcelCollection {
  const fc = raw as { type?: string; features?: unknown[] } | null;
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("Invalid GeoJSON: expected a FeatureCollection.");
  }

  const usable = fc.features.filter(isUsableFeature);
  if (usable.length === 0) {
    throw new Error("GeoJSON has no usable polygon features.");
  }

  const idKey = pickIdKey(usable);

  const features: ParcelFeature[] = usable.map((f, i) => {
    const props = f.properties ?? {};
    // Prefer an id the source already assigned (e.g. the live parcel picker sets
    // __pid to the PPN). Otherwise use a detected parcel-number column, falling
    // back to a stable index id. Features that share an id (a multi-polygon
    // parcel) intentionally count as a single parcel.
    const pid = val(props, "__pid") || (idKey ? val(props, idKey) : "") || "p" + i;
    return {
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry,
      properties: { ...props, __pid: pid },
    };
  });

  return { type: "FeatureCollection", features };
}
