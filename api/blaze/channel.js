// api/blaze/channel.js  ->  GET /api/blaze/channel?wallet=0x...
// Mirrors hotemin's blazeHeaders pattern. Refreshes expired tokens. Never 500s on partial data.

const supabase = require('../_supabase.js');
const BLAZE_API = 'https://api.blaze.stream/v1';

function blazeHeaders(token) {
  return { 'client-id': process.env.BLAZE_CLIENT_ID, 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'accept': 'application/json' };
}

async function blazeGet(path, token) {
  const r = await fetch(`${BLAZE_API}${path}`, { headers: blazeHeaders(token) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0,120)}`);
  return JSON.parse(text);
}

async function tryRefresh(tokenRow) {
  if (!tokenRow.refresh_token) return null;
  try {
    const r = await fetch('https://blaze.stream/bapi/oauth2/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: process.env.BLAZE_CLIENT_ID, clientSecret: process.env.BLAZE_CLIENT_SECRET, refreshToken: tokenRow.refresh_token })
    });
    const data = await r.json();
    if (!data.accessToken) return null;
    await supabase.from('blaze_oauth_tokens').update({ access_token: data.accessToken, refresh_token: data.refreshToken || tokenRow.refresh_token, expires_at: new Date(Date.now() + 3600000).toISOString() }).eq('wallet', tokenRow.wallet).catch(()=>{});
    return data.accessToken;
  } catch(e) { console.error('[channel] refresh err:', e.message); return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const wallet = String(req.query.wallet || '').toLowerCase();
  if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'valid wallet required' });

  const { data: row } = await supabase.from('blaze_oauth_tokens').select('*').eq('wallet', wallet).maybeSingle();
  if (!row) return res.json({ connected: false });

  // Refresh token if expired
  let token = row.access_token;
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 60000;
  if (expired) { const fresh = await tryRefresh(row); if (fresh) token = fresh; }

  // Profile — fall back to stored values if API fails
  let profile = {};
  try {
    const raw = await blazeGet('/users/profile', token);
    profile = raw.data || raw;
    console.log('[channel] user:', profile.username, 'id:', profile.id);
  } catch(e) {
    console.error('[channel] profile err:', e.message);
    profile = { id: row.blaze_user_id, username: row.blaze_username, displayName: row.blaze_username, avatarUrl: null };
  }

  const channelId = profile.id || profile.userId || row.blaze_user_id;
  const username  = profile.username  || row.blaze_username || null;
  const avatar    = profile.avatarUrl || null;
  const display   = profile.displayName || username;

  // Back-fill Supabase silently
  if (username || avatar) {
    supabase.from('profiles').update({ blaze_handle: username, blaze_avatar: avatar }).eq('wallet', wallet).catch(()=>{});
    if (username && !row.blaze_username) supabase.from('blaze_oauth_tokens').update({ blaze_username: username }).eq('wallet', wallet).catch(()=>{});
  }

  // Channel data — all optional, use allSettled so one failure doesn't kill the rest
  let stats = {}, live = {}, vods = [], clips = [];
  if (channelId) {
    const [sR, lR, vR, cR] = await Promise.allSettled([
      blazeGet(`/channels/${channelId}/stats`, token),
      blazeGet(`/channels/${channelId}/live-stats`, token),
      blazeGet(`/channels/${channelId}/vods?orderBy=most_recent&limit=5`, token),
      blazeGet(`/channels/clips?channelId=${channelId}&limit=5&orderBy=most_recent`, token)
    ]);
    if (sR.status==='fulfilled') { const d=sR.value.data||sR.value; stats={followers:d.followersCount||d.followers||0,subscribers:d.subscribersCount||d.subscribers||0,totalViews:d.totalViews||0}; }
    if (lR.status==='fulfilled') { const d=lR.value.data||lR.value; live={isLive:!!(d.isLive||d.is_live||d.live),viewers:d.viewerCount||d.viewers||0,title:d.title||null,game:d.game?.name||d.category?.name||null}; }
    if (vR.status==='fulfilled') { const rows=vR.value.data||vR.value.rows||vR.value.vods||vR.value||[]; vods=(Array.isArray(rows)?rows:[]).slice(0,5).map(v=>({id:v.id,title:v.title,duration:v.duration,thumbnail:v.thumbnailUrl||v.previewImgUrl||null,url:v.url||v.vodUrl||(username?`https://blaze.stream/${username}/videos/${v.id}`:null)})); }
    if (cR.status==='fulfilled') { const rows=cR.value.data||cR.value.rows||cR.value.clips||cR.value||[]; clips=(Array.isArray(rows)?rows:[]).slice(0,5).map(c=>({id:c.id||c.clipId,title:c.title,views:c.viewCount||c.views||0,thumbnail:c.previewImgUrl||c.thumbnailUrl||null,url:c.clipUrl||c.url||null})); }
    [sR,lR,vR,cR].forEach((r,i)=>{ if(r.status==='rejected') console.log('[channel] endpoint',i,'skipped:',r.reason?.message?.slice(0,80)); });
  }

  res.json({ connected: true, channelId, username, displayName: display, avatarUrl: avatar, stats, live, vods, recentClips: clips });
};
