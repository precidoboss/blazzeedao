// api/disconnect-x.js -> POST { wallet }
const supabase = require('./_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });
  const w = wallet.toLowerCase();
  await supabase.from('x_oauth_tokens').update({ wallet: null }).eq('wallet', w);
  // Keep x_handle as free text so they don't lose it — just drop the
  // verified flag and the linked X user id.
  await supabase.from('profiles').update({ x_user_id: null, x_verified: false }).eq('wallet', w);
  console.log('[disconnect-x]', w);
  res.json({ ok: true });
};
