// api/_supabase.js — shared client, imported by the other api/ functions.
// Uses the SERVICE ROLE key (server-side only) — never expose this key
// with a VITE_/NEXT_PUBLIC_ prefix or in any frontend file.
const { createClient } = require('@supabase/supabase-js');

module.exports = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
