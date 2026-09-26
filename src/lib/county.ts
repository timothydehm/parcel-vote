// Cleveland public-land sources and pure geometry helpers for the parcel picker.

// City of Cleveland Land Bank Owned Parcels (updated weekly from County records).
export const LANDBANK_LAYER =
  "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/City_Landbank/FeatureServer/0";
// Official neighborhood (SPA) and 2026 council ward boundaries.
export const NEIGHBORHOOD_LAYER = "https://www.clevelandgis.org/arcgis/rest/services/ReferenceLayers/SPA/FeatureServer/0";
export const WARD_LAYER =
  "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Cleveland_Wards_1_2_25_Topocleaned_pop20/FeatureServer/0";

export const LANDBANK_OWNER = "City of Cleveland Land Bank";

// Most parcels we'll draw/save at once (keeps the map fast and the save under Vercel's body limit).
export const LOAD_CAP = 4000;

export const NEIGHBORHOODS = [
  "Bellaire-Puritas", "Broadway-Slavic Village", "Brooklyn Centre", "Buckeye-Shaker Square", "Buckeye-Woodhill",
  "Central", "Clark-Fulton", "Collinwood-Nottingham", "Cudell", "Cuyahoga Valley", "Detroit Shoreway", "Downtown",
  "Edgewater", "Euclid-Green", "Fairfax", "Glenville", "Goodrich-Kirtland Pk", "Hopkins", "Hough", "Jefferson",
  "Kamm's", "Kinsman", "Lee-Harvard", "Lee-Seville", "Mount Pleasant", "North Shore Collinwood", "Ohio City",
  "Old Brooklyn", "St.Clair-Superior", "Stockyards", "Tremont", "Union-Miles", "University", "West Boulevard",
];

export const WARDS = Array.from({ length: 15 }, (_, i) => String(i + 1));

// Where-clauses for the boundary layers. Values are validated against the fixed
// lists above, so nothing user-typed ever reaches the query.
export function neighborhoodWhere(name: string): string | null {
  if (!NEIGHBORHOODS.includes(name)) return null;
  return `SPANM = '${name.replace(/'/g, "''")}'`;
}
export function wardWhere(ward: string): string | null {
  if (!WARDS.includes(ward)) return null;
  return `Ward = ${Number(ward)}`;
}

type Ring = number[][];
type Geom = { type: string; coordinates: any };

// Center of a geometry's bounding box: a good "where is this parcel" point for small lots.
export function bboxCenter(g: Geom): [number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    } else for (const x of c) walk(x);
  };
  if (!g || !g.coordinates) return null;
  walk(g.coordinates);
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}

function inRing(pt: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Point-in-(Multi)Polygon, respecting holes.
export function pointInGeometry(pt: [number, number], g: Geom): boolean {
  const polys: Ring[][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((rings) => rings.length > 0 && inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
}

// Convert a GeoJSON (Multi)Polygon to an ArcGIS JSON polygon for use as a query filter.
export function toEsriPolygon(g: Geom) {
  const rings: Ring[] = g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
  return { rings, spatialReference: { wkid: 4326 } };
}
