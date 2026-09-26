export type ParcelFeature = {
  type: "Feature";
  id?: string | number;
  geometry: unknown;
  properties: Record<string, unknown> & { __pid: string };
};

export type ParcelCollection = {
  type: "FeatureCollection";
  features: ParcelFeature[];
};

export type MapData = {
  id: string;
  question: string;
  parcels: ParcelCollection;
  is_open: boolean;
  vote_limit: number | null;
  counts: Record<string, number>;
  commentCounts: Record<string, number>;
  totalVoters: number;
  yourVotes: string[];
  me: string | null;
};

export type Comment = {
  id: string;
  body: string;
  created_at: string;
  author_name?: string | null;
};

// A parcel the admin picked from the live county map, ready to save.
export type SelectedParcel = {
  pid: string;
  owner: string | null;
  geometry: unknown;
  props?: Record<string, unknown>; // extra display fields (address, type, neighborhood, ward)
};
