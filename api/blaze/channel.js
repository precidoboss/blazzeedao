// api/blaze/channel.js  ->  GET /api/blaze/channel?wallet=0x...
// Returns channel stats, live status, and recent VODs for a wallet's linked Blaze account.
// Used by the bounty board to show streamer stats, live badge, and VOD picker.

const supabase = require('../_supabase.js');

async function blazeFetch(path, accessToken, clientId, clientSecret) {
  const r = await fetch(`https://api.blaze.stream${path}`, {
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'client-id': clientId,
      'secret': clientSecret,
      'content-type': 'application/json'
    }
  });
  if (!r.ok) throw new Error(`Blaze API ${path} returned ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  // Allow GET with wallet param OR blazeUserId param
  const wallet = String(req.query.wallet || '').toLowerCase();
  const blazeUserId = String(req.query.blazeUserId || '');

  if (!wallet && !blazeUserId) return res.status(400).json({ error: 'wallet or blazeUserId required' });

  try {
    // Get the stored token for this wallet
    let tokenQuery = supabase.from('blaze_oauth_tokens').select('*');
    if (wallet) tokenQuery = tokenQuery.eq('wallet', wallet);
    else tokenQuery = tokenQuery.eq('blaze_user_id', blazeUserId);

    const { data: tokenRow } = await tokenQuery.maybeSingle();
    if (!tokenRow) return res.json({ connected: false });

    const { access_token, blaze_user_id, blaze_username } = tokenRow;
    const cid = process.env.BLAZE_CLIENT_ID;
    const sec = process.env.BLAZE_CLIENT_SECRET;

    // Fetch all three in parallel — channel stats, live status, recent VODs
    const [statsRes, liveRes, vodsRes] = await Promise.allSettled([
      blazeFetch(`/v1/channels/${blaze_username}/stats`, access_token, cid, sec),
      blazeFetch(`/v1/channels/${blaze_username}/live-stats`, access_token, cid, sec),
      blazeFetch(`/v1/channels/${blaze_username}/vods?orderBy=most_recent&limit=5`, access_token, cid, sec)
    ]);

    const stats = statsRes.status === 'fulfilled' ? statsRes.value : {};
    const live  = liveRes.status  === 'fulfilled' ? liveRes.value  : {};
    const vods  = vodsRes.status  === 'fulfilled' ? vodsRes.value  : {};

    res.json({
      connected: true,
      blazeUserId: blaze_user_id,
      username: blaze_username,
      stats: {
        followers:   stats.followersCount || stats.followers || 0,
        subscribers: stats.subscribersCount || stats.subscribers || 0,
        totalViews:  stats.totalViews || 0
      },
      live: {
        isLive:   !!(live.isLive || live.is_live || live.live),
        viewers:  live.viewerCount || live.viewers || 0,
        title:    live.title || null,
        game:     live.game?.name || live.category?.name || null,
        startedAt: live.startedAt || live.started_at || null
      },
      vods: Array.isArray(vods.rows || vods.data || vods)
        ? (vods.rows || vods.data || vods).slice(0, 5).map(v => ({
            id:        v.id || v.vodId,
            title:     v.title,
            duration:  v.duration,
            thumbnail: v.thumbnailUrl || v.previewImgUrl || null,
            url:       v.url || v.vodUrl || null,
            createdAt: v.createdAt || null
          }))
        : []
    });
  } catch (e) {
    console.error('[BLAZE CHANNEL]', e.message);
    res.status(500).json({ error: e.message });
  }
};
