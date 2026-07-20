// api/oauth/token.js
// 1. Exchange code for token
// 2. Call /v1/users/profile to get username + avatar (token response has no username)
// 3. Save everything to Supabase — always, even when wallet is null
// 4. If wallet provided, also link in profiles table immediately

const supabase = require('../_supabase.js');
const BLAZE_API = 'https://api.blaze.stream/v1';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, codeVerifier, redirectUri, wallet } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!process.env.BLAZE_CLIENT_SECRET) return res.status(500).json({ error: 'BLAZE_CLIENT_SECRET not set' });

  try {
    // Step 1: exchange code for token
    const tokenRes = await fetch('https://blaze.stream/bapi/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId:     process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        code, codeVerifier, redirectUri,
        grantType: 'authorization_code'
      })
    });
    const data = await tokenRes.json();
    console.log('[token] exchange status:', tokenRes.status, 'userId:', data.userId);

    if (!data.accessToken) {
      console.error('[token] no accessToken in response:', JSON.stringify(data));
      return res.json(data); // pass error back to frontend as-is
    }

    // Step 2: fetch real profile — token response has no username or avatarUrl
    let username = null, avatarUrl = null, displayName = null;
    try {
      const profileRes = await fetch(`${BLAZE_API}/users/profile`, {
        headers: {
          'client-id':     process.env.BLAZE_CLIENT_ID,
          'authorization': `Bearer ${data.accessToken}`,
          'content-type':  'application/json',
          'accept':        'application/json'
        }
      });
      const profileRaw = await profileRes.json();
      const p = profileRaw.data || profileRaw;
      username    = p.username    || null;
      avatarUrl   = p.avatarUrl   || null;
      displayName = p.displayName || username;
      console.log('[token] profile fetched:', username, '| avatar:', avatarUrl ? 'yes' : 'no');
    } catch(e) {
      console.error('[token] profile fetch error:', e.message);
    }

    const cleanWallet = wallet ? wallet.toLowerCase() : null;

    // Step 3: always save token row (wallet may be null — linked later)
    const { error: te } = await supabase.from('blaze_oauth_tokens').upsert({
      blaze_user_id:  data.userId,
      blaze_username: username,
      access_token:   data.accessToken,
      refresh_token:  data.refreshToken || null,
      expires_at:     new Date(Date.now() + 3600 * 1000).toISOString(),
      wallet:         cleanWallet
    }, { onConflict: 'blaze_user_id' });
    if (te) console.error('[token] token upsert error:', te.message);

    // Step 4: if wallet provided, upsert profile immediately
    if (cleanWallet) {
      const { error: pe } = await supabase.from('profiles').upsert({
        wallet:        cleanWallet,
        blaze_user_id: data.userId,
        blaze_handle:  username,
        blaze_avatar:  avatarUrl
      }, { onConflict: 'wallet' });
      if (pe) console.error('[token] profile upsert error:', pe.message);
    }

    // Return augmented data so frontend has username/avatar immediately
    res.json({ ...data, username, displayName, avatarUrl });

  } catch (e) {
    console.error('[token] fatal error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
