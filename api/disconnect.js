// api/disconnect.js -> POST { provider: 'blaze'|'x', wallet, signature, timestamp }
//
// Merged from the former api/disconnect-blaze.js + api/disconnect-x.js.
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and
// this project was right at that limit — combining these two nearly
// identical endpoints into one, routed by `provider`, saves a function
// slot without changing any behavior.
//
// SECURITY: requires a signed message proving control of `wallet` before
// disconnecting anything — see api/_verify-signature.js.
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { provider, wallet, signature, timestamp } = req.body;
  if (provider !== 'blaze' && provider !== 'x') return res.status(400).json({ error: 'provider must be "blaze" or "x"' });
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const check = verifyWalletSignature({ wallet, signature, timestamp }, `Disconnect ${provider === 'blaze' ? 'Blaze' : 'X'} account`);
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();

  if (provider === 'blaze') {
    await supabase.from('blaze_oauth_tokens').update({ wallet: null }).eq('wallet', w);
    await supabase.from('profiles').update({ blaze_user_id: null, blaze_handle: null, blaze_avatar: null }).eq('wallet', w);
    console.log('[disconnect] blaze', w);
  } else {
    await supabase.from('x_oauth_tokens').update({ wallet: null }).eq('wallet', w);
    // Keep x_handle as free text so they don't lose it — just drop the
    // verified flag and the linked X user id.
    await supabase.from('profiles').update({ x_user_id: null, x_verified: false }).eq('wallet', w);
    console.log('[disconnect] x', w);
  }

  res.json({ ok: true });
};
