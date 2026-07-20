// api/disconnect-blaze.js -> POST { wallet }
const supabase = require('./_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });
  const w = wallet.toLowerCase();
  await supabase.from('blaze_oauth_tokens').update({ wallet: null }).eq('wallet', w);
  await supabase.from('profiles').update({ blaze_user_id: null, blaze_handle: null, blaze_avatar: null }).eq('wallet', w);
  console.log('[disconnect-blaze]', w);
  res.json({ ok: true });
};
