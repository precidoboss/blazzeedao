// api/disconnect-x.js -> POST { wallet, signature, timestamp }
//
// SECURITY: same issue as disconnect-blaze.js — previously anyone could
// strip ANY wallet's verified X status with no proof of ownership, e.g.
// to block a competitor from submitting a clip right before a deadline.
// Now requires a signed message proving control of `wallet`.
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { wallet, signature, timestamp } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Disconnect X account');
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();
  await supabase.from('x_oauth_tokens').update({ wallet: null }).eq('wallet', w);
  // Keep x_handle as free text so they don't lose it — just drop the
  // verified flag and the linked X user id.
  await supabase.from('profiles').update({ x_user_id: null, x_verified: false }).eq('wallet', w);
  console.log('[disconnect-x]', w);
  res.json({ ok: true });
};
