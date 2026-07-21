// api/disconnect-blaze.js -> POST { wallet, signature, timestamp }
//
// SECURITY: previously anyone could POST any wallet address here and rip
// off that user's Blaze link with no proof they own the wallet — pure
// griefing/DoS against any streamer or clipper whose address you knew.
// Now requires a signed message proving control of `wallet`.
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { wallet, signature, timestamp } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Disconnect Blaze account');
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();
  await supabase.from('blaze_oauth_tokens').update({ wallet: null }).eq('wallet', w);
  await supabase.from('profiles').update({ blaze_user_id: null, blaze_handle: null, blaze_avatar: null }).eq('wallet', w);
  console.log('[disconnect-blaze]', w);
  res.json({ ok: true });
};
