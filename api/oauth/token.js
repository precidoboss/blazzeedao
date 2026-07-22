// api/oauth/token.js -> POST { provider: 'blaze'|'x', code, codeVerifier, redirectUri, wallet }
//
// Merged from the former api/oauth/token.js (Blaze) + api/oauth/x/token.js
// (X) — see api/disconnect.js for why. Behavior per provider is unchanged.
const supabase = require('../_supabase.js');
const BLAZE_API = 'https://api.blaze.stream/v1';

// 1. Exchange code for token
// 2. Call /v1/users/profile to get username + avatar (token response has no username)
// 3. Save everything to Supabase — always, even when wallet is null
// 4. If wallet provided, also link in profiles table immediately
async function blazeToken({ code, codeVerifier, redirectUri, wallet }) {
  if (!process.env.BLAZE_CLIENT_SECRET) throw Object.assign(new Error('BLAZE_CLIENT_SECRET not set'), { status: 500 });

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
  console.log('[token] blaze exchange status:', tokenRes.status, 'userId:', data.userId);

  if (!data.accessToken) {
    console.error('[token] blaze: no accessToken in response:', JSON.stringify(data));
    return data; // pass error back to frontend as-is
  }

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
    console.log('[token] blaze profile fetched:', username, '| avatar:', avatarUrl ? 'yes' : 'no');
  } catch(e) {
    console.error('[token] blaze profile fetch error:', e.message);
  }

  const cleanWallet = wallet ? wallet.toLowerCase() : null;

  // Only include `wallet` in the upsert when we actually have one — Supabase's
  // upsert only overwrites columns present in the object, so omitting it
  // entirely (instead of passing wallet: null) preserves whatever link
  // already exists instead of silently wiping it on a re-auth where the
  // wallet wasn't passed through correctly.
  const tokenRow = {
    blaze_user_id:  data.userId,
    blaze_username: username,
    access_token:   data.accessToken,
    refresh_token:  data.refreshToken || null,
    expires_at:     new Date(Date.now() + 3600 * 1000).toISOString()
  };
  if (cleanWallet) tokenRow.wallet = cleanWallet;

  const { error: te } = await supabase.from('blaze_oauth_tokens').upsert(tokenRow, { onConflict: 'blaze_user_id' });
  if (te) console.error('[token] blaze token upsert error:', te.message);

  let profileErr = null;
  if (cleanWallet) {
    const { error: pe } = await supabase.from('profiles').upsert({
      wallet:        cleanWallet,
      blaze_user_id: data.userId,
      blaze_handle:  username,
      blaze_avatar:  avatarUrl
    }, { onConflict: 'wallet' });
    if (pe) { profileErr = pe.message; console.error('[token] blaze profile upsert error:', pe.message); }
  }

  // DIAGNOSTIC: only present when something failed, so a normal response
  // stays clean — visible directly in the Network tab response, no need
  // for Vercel log access to see why a link didn't take.
  const _debug = (te || profileErr || !cleanWallet)
    ? { tokenUpsertError: te?.message || null, profileUpsertError: profileErr, walletReceived: cleanWallet }
    : undefined;

  return { ...data, username, displayName, avatarUrl, _debug };
}

// 1. Exchange the authorization code for an access token (confidential
//    client — Basic auth with X_CLIENT_ID:X_CLIENT_SECRET).
// 2. Call /2/users/me with that token — this is what actually PROVES the
//    person owns the X account, not just typed a handle into a text box.
// 3. Save the verified account to Supabase.
async function xToken({ code, codeVerifier, redirectUri, wallet }) {
  if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET) {
    throw Object.assign(new Error('X_CLIENT_ID / X_CLIENT_SECRET not set in Vercel env vars'), { status: 500 });
  }
  const basicAuth = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'authorization': `Basic ${basicAuth}`
    },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
      client_id: process.env.X_CLIENT_ID
    })
  });
  const data = await tokenRes.json();

  if (!data.access_token) {
    console.error('[token] x exchange failed:', tokenRes.status, JSON.stringify(data));
    throw Object.assign(new Error('X token exchange failed'), { status: 400, detail: data });
  }

  const meRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { authorization: `Bearer ${data.access_token}` }
  });
  const me = await meRes.json();
  const xUserId = me.data?.id;
  const xUsername = me.data?.username;

  if (!xUserId || !xUsername) {
    console.error('[token] x users/me failed:', meRes.status, JSON.stringify(me));
    throw Object.assign(new Error('Could not verify X account'), { status: 400, detail: me });
  }

  const cleanWallet = wallet ? wallet.toLowerCase() : null;

  const tokenRow = {
    x_user_id: xUserId,
    x_username: xUsername,
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString()
  };
  if (cleanWallet) tokenRow.wallet = cleanWallet;

  const { error: te } = await supabase.from('x_oauth_tokens').upsert(tokenRow, { onConflict: 'x_user_id' });
  if (te) console.error('[token] x token upsert error:', te.message);

  let profileErr = null;
  if (cleanWallet) {
    const { error: pe } = await supabase.from('profiles').upsert({
      wallet: cleanWallet,
      x_user_id: xUserId,
      x_handle: xUsername,
      x_verified: true
    }, { onConflict: 'wallet' });
    if (pe) { profileErr = pe.message; console.error('[token] x profile upsert error:', pe.message); }
  }

  console.log('[token] x verified @' + xUsername, '->', cleanWallet);
  const _debug = (te || profileErr || !cleanWallet)
    ? { tokenUpsertError: te?.message || null, profileUpsertError: profileErr, walletReceived: cleanWallet }
    : undefined;
  return { verified: true, username: xUsername, userId: xUserId, _debug };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { provider, code, codeVerifier, redirectUri, wallet } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (provider !== 'blaze' && provider !== 'x') return res.status(400).json({ error: 'provider must be "blaze" or "x"' });
  if (provider === 'x' && !codeVerifier) return res.status(400).json({ error: 'codeVerifier required' });

  try {
    const result = provider === 'blaze'
      ? await blazeToken({ code, codeVerifier, redirectUri, wallet })
      : await xToken({ code, codeVerifier, redirectUri, wallet });
    res.json(result);
  } catch (e) {
    console.error(`[token] ${provider} fatal error:`, e.message);
    res.status(e.status || 500).json({ error: e.message, detail: e.detail });
  }
};
