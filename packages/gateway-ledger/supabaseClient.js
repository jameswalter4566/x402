import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://bqncfjnigubyictxbliq.supabase.co";
const DEFAULT_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbmNmam5pZ3VieWljdHhibGlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjE2MTg3NSwiZXhwIjoyMDYxNzM3ODc1fQ.IwPpWtQYDpofPYGzK7iSnWMCRnePe5PbT1PQG26xeZw";

let client = null;

function getConfig() {
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

function ensureClient() {
  const config = getConfig();
  if (!config) {
    return null;
  }

  if (!client) {
    client = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
      },
    });
  }

  return client;
}

export function getSupabaseClient() {
  return ensureClient();
}

export function isLedgerEnabled() {
  return Boolean(ensureClient());
}
