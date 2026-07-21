// api/save-profile.js -> POST { wallet, username, xHandle, role, signature, timestamp }
//
// SECURITY: this becomes the ONLY allowed write path for self-service
// profile edits once anon INSERT/UPDATE on `profiles` is revoked at the
// database level (see supabase_rls.sql). Previously the browser wrote
// directly to the `profiles` table with the public anon key — anyone
// could open the browser console and upsert a profile row for ANY
// wallet, including setting x_verified/x_handle/blaze_* fields that are
// supposed to only ever be set after a real OAuth flow.
//
// This endpoint:
//   1. Verifies the caller actually controls `wallet` (signed message).
//   2. Only ever writes username / x_handle / role — NEVER x_verified,
//      x_user_id, blaze_user_id, blaze_handle, or blaze_avatar. Those
//      fields are exclusively set by api/oauth/token.js and
//      api/oauth/x/token.js, immediately after the provider itself
//      confirms the account. They must never become client-writable
//      again, or the entire "only a verified X account can submit a
//      clip" anti-spoofing guarantee described in the docs falls apart.
//   3. If the profile is already x_verified, silently ignores any
//      attempt to change x_handle here — the only way to change a
//      verified handle is to reconnect X.
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { wallet, username, xHandle, role, signature, timestamp } = req.body;

  const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Save profile');
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();
  const cleanUsername = String(username || '').trim().slice(0, 60);
  const cleanRole = ['clipper', 'streamer'].includes(role) ? role : 'clipper';
  if (!cleanUsername) return res.status(400).json({ error: 'username required' });

  const { data: existing } = await supabase.from('profiles').select('x_verified').eq('wallet', w).maybeSingle();

  const row = { wallet: w, username: cleanUsername, role: cleanRole, updated_at: new Date().toISOString() };
  if (!existing?.x_verified) {
    row.x_handle = String(xHandle || '').trim().replace(/^@/, '').slice(0, 30) || null;
  }

  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'wallet' });
  if (error) return res.status(500).json({ error: 'Could not save profile', detail: error.message });

  res.json({ ok: true });
};
