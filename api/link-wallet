// api/link-wallet.js -> POST { blazeUserId, wallet }
const supabase = require('./_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { blazeUserId, wallet } = req.body;
  if (!blazeUserId || !wallet) return res.status(400).json({ error: 'blazeUserId and wallet required' });
  const w = wallet.toLowerCase();

  const { data: tok } = await supabase.from('blaze_oauth_tokens').select('blaze_username').eq('blaze_user_id', blazeUserId).maybeSingle();
  await supabase.from('blaze_oauth_tokens').update({ wallet: w }).eq('blaze_user_id', blazeUserId);
  await supabase.from('profiles').upsert({ wallet: w, blaze_user_id: blazeUserId, blaze_handle: tok?.blaze_username || null }, { onConflict: 'wallet' });

  console.log('[link-wallet]', blazeUserId, '->', w);
  res.json({ ok: true });
};
