"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window`, so the map must render client-side only.
const MapVote = dynamic(() => import("@/components/MapVote"), {
  ssr: false,
  loading: () => <div className="p-6 text-slate-500">Loading map…</div>,
});

export default function MapPage({ params }: { params: { id: string } }) {
  return <MapVote id={params.id} />;
}
