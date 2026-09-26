// Cuyahoga PPNs are 8 digits shown as 3-2-3 (e.g. 123-45-678). norm() keeps only
// digits and pads/truncates to 8; dash() formats for display.
export function norm(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d ? d.padStart(8, "0").slice(-8) : null;
}

export function dash(p: string): string {
  if (/^\d{8}$/.test(p)) return `${p.slice(0, 3)}-${p.slice(3, 5)}-${p.slice(5)}`;
  return p;
}
