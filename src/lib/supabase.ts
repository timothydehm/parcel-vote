import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Routes will fail loudly if these are missing — see .env.local.example.
  console.warn("Supabase env vars are not set. See .env.local.example.");
}

// Server-only client. Uses the service role key, so never import this in a
// client component.
export const db = createClient(url ?? "", serviceKey ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
