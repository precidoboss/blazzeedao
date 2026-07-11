// api/blaze/channel.js  ->  GET /api/blaze/channel?wallet=0x...
// Uses exact same Blaze API pattern as hotemin.js:
//   GET /v1/users/profile  — get user id, username, avatarUrl, displayName
//   Then uses channelId (= user id) for channel-specific endpoints

const supabase = require('../_supabase.js');

const BLAZE_API = 'https://api.blaze.stream/v1';

function blazeHeaders(token) {
  return {
    'client-id':     process.env.BLAZE_CLIENT_ID,
    'authorization': `Bearer ${token}`,
    'content-type':  'application/json',
    'accept':        'application/json'
  };
}

async function blazeGet(path, token) {
  const r = await fetch(`${BLAZE_API}${path}`, { headers: blazeHeaders(token) });
  if (!r.ok) throw new Error(`Blaze ${path} → ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const wallet = String(req.query.wallet || '').toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'valid wallet required' });
  }

  // Get stored token for this wallet
  const { data: tokenRow } = await supabase
    .from('blaze_oauth_tokens')
    .select('*')
    .eq('wallet', wallet)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    return res.json({ connected: false });
  }

  const token = tokenRow.access_token;

  try {
    // Step 1: Get real profile — same pattern as hotemin line 1357
    // Response shape: data.data || data  (same as hotemin uses)
    const profileRaw = await blazeGet('/users/profile', token);
    const u = profileRaw.data || profileRaw;

    const channelId = u.id || u.userId || tokenRow.blaze_user_id;
    const username  = u.username  || tokenRow.blaze_username || null;
    const avatar    = u.avatarUrl || null;
    const display   = u.displayName || username;

    // Update stored username/avatar if they were missing
    if (username && !tokenRow.blaze_username) {
      await supabase.from('blaze_oauth_tokens')
        .update({ blaze_username: username })
        .eq('wallet', wallet);
    }
    if (avatar || username) {
      await supabase.from('profiles').update({
        blaze_handle: username,
        blaze_avatar: avatar
      }).eq('wallet', wallet);
    }

    // Step 2: Fetch channel data in parallel using channelId
    // (not username — hotemin uses channelId for channel endpoints)
    const [statsResult, liveResult, vodsResult, clipsResult] = await Promise.allSettled([
      blazeGet(`/channels/${channelId}/stats`, token),
      blazeGet(`/channels/${channelId}/live-stats`, token),
      blazeGet(`/channels/${channelId}/vods?orderBy=most_recent&limit=5`, token),
      blazeGet(`/channels/clips?channelId=${channelId}&limit=5&orderBy=most_recent`, token)
    ]);

    const stats = statsResult.status === 'fulfilled' ? (statsResult.value.data || statsResult.value) : {};
    const live  = liveResult.status  === 'fulfilled' ? (liveResult.value.data  || liveResult.value)  : {};
    const vodsRaw = vodsResult.status === 'fulfilled' ? vodsResult.value : {};
    const clipsRaw = clipsResult.status === 'fulfilled' ? clipsResult.value : {};

    const vodList  = vodsRaw.data  || vodsRaw.rows  || vodsRaw.vods  || [];
    const clipList = clipsRaw.data || clipsRaw.rows  || clipsRaw.clips || [];

    console.log('[BLAZE CHANNEL] profile:', username, '| live:', !!live.isLive, '| followers:', stats.followersCount);

    res.json({
      connected:   true,
      channelId,
      username,
      displayName: display,
      avatarUrl:   avatar,
      stats: {
        followers:   stats.followersCount || stats.followers || 0,
        subscribers: stats.subscribersCount || stats.subscribers || 0,
        totalViews:  stats.totalViews || 0,
        totalClips:  stats.totalClips || 0
      },
      live: {
        isLive:    !!(live.isLive || live.is_live || live.live),
        viewers:   live.viewerCount || live.viewers || 0,
        title:     live.title || null,
        game:      live.game?.name || live.category?.name || null,
        startedAt: live.startedAt || live.started_at || null
      },
      vods: vodList.slice(0, 5).map(v => ({
        id:        v.id,
        title:     v.title,
        duration:  v.duration,
        thumbnail: v.thumbnailUrl || v.previewImgUrl || null,
        url:       v.url || v.vodUrl || `https://blaze.stream/${username}/videos/${v.id}`
      })),
      recentClips: clipList.slice(0, 5).map(c => ({
        id:        c.id || c.clipId,
        title:     c.title,
        views:     c.viewCount || c.views || 0,
        thumbnail: c.previewImgUrl || c.thumbnailUrl || null,
        url:       c.clipUrl || c.url
      }))
    });
  } catch (e) {
    console.error('[BLAZE CHANNEL] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
