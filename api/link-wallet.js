// api/link-wallet.js -> POST { blazeUserId, wallet, signature, timestamp }
//
// SECURITY: linking a Blaze account to a wallet is an identity-binding
// action. The previous version trusted `wallet` directly from the request
// body with no proof of ownership — anyone who knew (or brute-forced) a
// blazeUserId could link ANY wallet address, including someone else's, to
// that Blaze identity. This now:
//   1. Requires a signed message proving the caller controls `wallet`.
//   2. Refuses to relink a blazeUserId that's already linked to a
//      DIFFERENT wallet — first link wins, so a signed request can't
//      hijack an account that's already claimed.
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { blazeUserId, wallet, signature, timestamp } = req.body;
  if (!blazeUserId || !wallet) return res.status(400).json({ error: 'blazeUserId and wallet required' });

  const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Link Blaze account');
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();

  const { data: tok } = await supabase.from('blaze_oauth_tokens').select('blaze_username, wallet').eq('blaze_user_id', blazeUserId).maybeSingle();
  if (tok?.wallet && tok.wallet !== w) {
    return res.status(409).json({ error: 'This Blaze account is already linked to a different wallet' });
  }

  await supabase.from('blaze_oauth_tokens').update({ wallet: w }).eq('blaze_user_id', blazeUserId);
  await supabase.from('profiles').upsert({ wallet: w, blaze_user_id: blazeUserId, blaze_handle: tok?.blaze_username || null }, { onConflict: 'wallet' });

  console.log('[link-wallet]', blazeUserId, '->', w);
  res.json({ ok: true });
};
