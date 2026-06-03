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
