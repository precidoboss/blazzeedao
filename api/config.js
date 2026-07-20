// api/config.js  ->  GET /api/config
// Serves the PUBLIC Supabase project URL + anon key to the frontend so
// index.html can call window.supabase.createClient(...) itself.
//
// IMPORTANT: this must only ever expose the anon key, never
// SUPABASE_SERVICE_KEY (that one stays server-side in api/_supabase.js and
// is protected by RLS bypass — leaking it would let anyone read/write every
// table directly).
//
// Set these two env vars in the Vercel project settings:
//   SUPABASE_URL        (same value already used by api/_supabase.js)
//   SUPABASE_ANON_KEY    (Project Settings -> API -> "anon" "public" key)

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'Server misconfigured: SUPABASE_URL / SUPABASE_ANON_KEY not set' });
    return;
  }

  // Safe to cache briefly at the edge — these values don't change per-request.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ supabaseUrl, supabaseKey });
};
