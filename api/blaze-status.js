// api/blaze-status.js  ->  GET /api/blaze-status?wallet=0x...
const supabase = require('./_supabase.js');

module.exports = async (req, res) => {
  const wallet = String(req.query.wallet || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'invalid wallet' });

  const { data } = await supabase.from('profiles')
    .select('blaze_user_id, blaze_handle, blaze_avatar')
    .eq('wallet', wallet)
    .maybeSingle();

  res.json({
    connected: !!data?.blaze_user_id,
    handle: data?.blaze_handle || null,
    avatar: data?.blaze_avatar || null
  });
};
