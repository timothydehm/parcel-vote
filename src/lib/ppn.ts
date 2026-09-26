// Parcel numbers: Cuyahoga PPNs are 8 digits shown as 3-2-3 (123-45-678), sometimes
// with a letter suffix for condos/air rights (e.g. 10114834C). pinKey() normalizes
// without dropping that suffix, so two different parcels never collide.
export function pinKey(v: unknown): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) return s.padStart(8, "0").slice(-8);
  return s;
}

// Back-compat alias.
export const norm = pinKey;

export function dash(p: string): string {
  const m = /^(\d{3})(\d{2})(\d{3})([A-Z]*)$/.exec(p);
  return m ? `${m[1]}-${m[2]}-${m[3]}${m[4]}` : p;
}
