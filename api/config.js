// api/config.js  ->  GET /api/config
// Serves public, non-secret runtime config to the frontend: the Supabase
// project URL + anon key (so index.html can call
// window.supabase.createClient(...) itself), and the WalletConnect
// Project ID (needed to open the WalletConnect modal for mobile/non-
// injected wallets — also meant to be public, same category as the
// Supabase anon key: it identifies your app to WalletConnect's relay,
// it doesn't authorize anything sensitive by itself).
//
// IMPORTANT: this must only ever expose the anon key, never
// SUPABASE_SERVICE_KEY (that one stays server-side in api/_supabase.js and
// is protected by RLS bypass — leaking it would let anyone read/write every
// table directly).
//
// Set these env vars in the Vercel project settings:
//   SUPABASE_URL              (same value already used by api/_supabase.js)
//   SUPABASE_ANON_KEY         (Project Settings -> API -> "anon" "public" key)
//   WALLETCONNECT_PROJECT_ID  (from https://cloud.walletconnect.com — free)

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'Server misconfigured: SUPABASE_URL / SUPABASE_ANON_KEY not set' });
    return;
  }

  // Safe to cache briefly at the edge — these values don't change per-request.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supabaseUrl,
    supabaseKey,
    walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null
  });
};
