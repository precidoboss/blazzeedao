// api/blaze/channel.js -> GET /api/blaze/channel?wallet=0x...
// Talks to the real Blaze API (https://dev.blaze.stream/docs/apis/channels) using
// the streamer's own User Access Token, so no channelId query param is needed
// for /stats or /live-stats (they default to the token owner's channel).
// /vods and /clips DO require channelId per the docs, even with a user token.
const supabase = require('../_supabase.js');
const BLAZE_API = 'https://api.blaze.stream/v1';

function blazeHeaders(token) {
  return { 'client-id': process.env.BLAZE_CLIENT_ID, 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json' };
}

async function blazeGet(path, token) {
  const r = await fetch(`${BLAZE_API}${path}`, { headers: blazeHeaders(token) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Blaze ${path} → ${r.status}: ${text.slice(0,80)}`);
  return JSON.parse(text);
}

async function tryRefresh(row) {
  if (!row.refresh_token) return null;
  try {
    const r = await fetch('https://blaze.stream/bapi/oauth2/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: process.env.BLAZE_CLIENT_ID, clientSecret: process.env.BLAZE_CLIENT_SECRET, refreshToken: row.refresh_token })
    });
    const data = await r.json();
    if (!data.accessToken) return null;
    await supabase.from('blaze_oauth_tokens').update({
      access_token: data.accessToken,
      refresh_token: data.refreshToken || row.refresh_token,
      expires_at: new Date(Date.now() + 3600000).toISOString()
    }).eq('blaze_user_id', row.blaze_user_id).catch(() => {});
    return data.accessToken;
  } catch(e) { console.error('[channel] refresh err:', e.message); return null; }
}

module.exports = async (req, res) => {
  // Never 500 — always return something useful.
  // SECURITY: this used to send `Access-Control-Allow-Origin: *`, which let
  // ANY website make browser requests to this endpoint on a visitor's
  // behalf. It doesn't leak a secret, but there's no reason to hand it out
  // cross-origin either — removed, so only same-origin requests (the app
  // itself) can call it, matching every other endpoint in this project.
  const wallet = String(req.query.wallet || '').toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'valid wallet required' });

  try {
    // Query by wallet — also try blaze_user_id from profiles if not found directly
    let row = null;
    const { data: r1 } = await supabase.from('blaze_oauth_tokens').select('*').eq('wallet', wallet).maybeSingle();
    if (r1) {
      row = r1;
    } else {
      // Token may exist but wallet not yet linked — look up via profiles
      const { data: prof } = await supabase.from('profiles').select('blaze_user_id').eq('wallet', wallet).maybeSingle();
      if (prof?.blaze_user_id) {
        const { data: r2 } = await supabase.from('blaze_oauth_tokens').select('*').eq('blaze_user_id', prof.blaze_user_id).maybeSingle();
        if (r2) {
          row = r2;
          // Fix the missing wallet link
          await supabase.from('blaze_oauth_tokens').update({ wallet }).eq('blaze_user_id', prof.blaze_user_id).catch(() => {});
        }
      }
    }

    if (!row) return res.json({ connected: false });

    // Refresh token if expired
    let token = row.access_token;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 60000) {
      const fresh = await tryRefresh(row);
      if (fresh) token = fresh;
    }

    // Get profile — fall back to stored values if API fails
    let username = row.blaze_username || null;
    let avatarUrl = null;
    let channelId = row.blaze_user_id;

    try {
      const raw = await blazeGet('/users/profile', token);
      const p = raw.data || raw;
      username  = p.username  || row.blaze_username || null;
      avatarUrl = p.avatarUrl || null;
      channelId = p.id || p.userId || row.blaze_user_id;
      console.log('[channel] profile:', username, 'channelId:', channelId);
      // Back-fill
      if (username || avatarUrl) {
        supabase.from('profiles').update({ blaze_handle: username, blaze_avatar: avatarUrl }).eq('wallet', wallet).catch(() => {});
        if (username && !row.blaze_username) supabase.from('blaze_oauth_tokens').update({ blaze_username: username }).eq('blaze_user_id', channelId).catch(() => {});
      }
    } catch(e) {
      console.error('[channel] profile err:', e.message);
      // Continue with stored values — don't abort
    }

    // Fetch channel data — all optional, never crash.
    // /stats and /live-stats use a User Access Token, so they implicitly
    // target the token owner's own channel — no channelId needed there.
    // /vods and /clips require channelId explicitly, per the Blaze docs.
    // /users/achievement-stats is creator-level (not per-channel) — tier,
    // total stream hours, and unique chatters are useful trust signals to
    // show a clipper deciding whether a bounty's streamer is legit.
    let stats = {}, live = {}, vods = [], clips = [], lastStream = null, achievements = {};
    if (channelId) {
      const [sR, lR, vR, cR, aR] = await Promise.allSettled([
        blazeGet(`/channels/stats`, token),
        blazeGet(`/channels/live-stats`, token),
        blazeGet(`/channels/vods?channelId=${channelId}&orderBy=most_recent&limit=5`, token),
        blazeGet(`/channels/clips?channelId=${channelId}&limit=5&orderBy=most_recent`, token),
        blazeGet(`/users/achievement-stats`, token)
      ]);
      if (sR.status==='fulfilled') {
        const d = sR.value.data || sR.value;
        stats = { followers: d.followerCount || d.followersCount || d.followers || 0,
                   subscribers: d.subscriberCount || d.subscribersCount || d.subscribers || 0,
                   viewers: d.viewerCount || 0 };
      }
      if (lR.status==='fulfilled') {
        const d = lR.value.data || lR.value;
        live = { isLive: !!(d.isLive || d.is_live || d.live),
                 viewers: d.viewerCount || d.viewers || 0,
                 startedAt: d.startedAt || null,
                 newFollowers: d.newFollowerCount || 0,
                 newSubscribers: d.newSubscriberCount || 0 };
      }
      if (vR.status==='fulfilled') {
        const rows = vR.value.data?.rows || vR.value.data || vR.value.rows || vR.value.vods || vR.value || [];
        vods = (Array.isArray(rows) ? rows : []).slice(0,5).map(v => ({
          id: v.id, title: v.title, duration: v.duration, views: v.viewCount || v.views || 0,
          thumbnail: v.previewImgUrl || v.thumbnailUrl || null,
          url: v.url || v.vodUrl || (username ? `https://blaze.stream/${username}/videos/${v.id}` : null),
          // Not every VOD payload includes a timestamp — read defensively and
          // fall back to null rather than guessing a date.
          recordedAt: v.createdAt || v.recordedAt || v.publishedAt || v.startedAt || null
        }));
        // "Last stream" = most recent VOD, since /stream-info (which had startedAt) is deprecated.
        if (vods.length) {
          lastStream = { title: vods[0].title, recordedAt: vods[0].recordedAt, duration: vods[0].duration, views: vods[0].views, thumbnail: vods[0].thumbnail };
        }
      }
      if (cR.status==='fulfilled') {
        const rows = cR.value.data?.rows || cR.value.data || cR.value.rows || cR.value.clips || cR.value || [];
        clips = (Array.isArray(rows) ? rows : []).slice(0,5).map(c => {
          const clipId = c.clipId || c.id;
          return {
            id: clipId, title: c.title, views: c.viewCount || c.views || 0,
            duration: c.duration || null,
            thumbnail: c.previewImgUrl || c.thumbnailUrl || null,
            // clipUrl from the API is the raw CDN asset — link out to the
            // public player page instead, which is what blaze.stream/clips/<id>
            // actually renders (title, player, creator credit, etc.).
            url: clipId ? `https://blaze.stream/clips/${clipId}` : (c.clipUrl || c.url || null),
            creator: c.creator?.username || null
          };
        });
      }
      if (aR.status==='fulfilled') {
        const d = aR.value.data || aR.value;
        achievements = { tier: d.tier ?? null, streamHours: d.streamHours ?? null, uniqueChatters: d.uniqueChatters ?? null };
      }
      [sR,lR,vR,cR,aR].forEach((r,i)=>{ if(r.status==='rejected') console.log('[channel] endpoint',i,'skipped:',r.reason?.message?.slice(0,80)); });
    }

    res.json({ connected: true, channelId, username, displayName: username, avatarUrl, stats, live, vods, recentClips: clips, lastStream, achievements });
  } catch(e) {
    // Catch-all — never 500, return connected:false with error logged
    console.error('[channel] fatal:', e.message);
    res.json({ connected: false, error: e.message });
  }
};
