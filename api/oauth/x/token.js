// api/oauth/x/token.js  ->  POST /api/oauth/x/token  { code, codeVerifier, redirectUri, wallet }
//
// 1. Exchange the authorization code for an access token (confidential
//    client — Basic auth with X_CLIENT_ID:X_CLIENT_SECRET, per X's OAuth 2.0
//    docs for server-side apps).
// 2. Call /2/users/me with that token — this is what actually PROVES the
//    person owns the X account, not just typed a handle into a text box.
// 3. Save the verified account to Supabase: token row in x_oauth_tokens,
//    and x_handle/x_verified/x_user_id on the profiles row for that wallet.

const supabase = require('../../_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, codeVerifier, redirectUri, wallet } = req.body;
  if (!code || !codeVerifier || !redirectUri) return res.status(400).json({ error: 'code, codeVerifier, and redirectUri are required' });
  if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET) {
    return res.status(500).json({ error: 'X_CLIENT_ID / X_CLIENT_SECRET not set in Vercel env vars' });
  }

  try {
    // Step 1: exchange code for token
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
      console.error('[x-token] exchange failed:', tokenRes.status, JSON.stringify(data));
      return res.status(400).json({ error: 'X token exchange failed', detail: data });
    }

    // Step 2: verify — fetch the actual account the token belongs to
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { authorization: `Bearer ${data.access_token}` }
    });
    const me = await meRes.json();
    const xUserId = me.data?.id;
    const xUsername = me.data?.username;

    if (!xUserId || !xUsername) {
      console.error('[x-token] users/me failed:', meRes.status, JSON.stringify(me));
      return res.status(400).json({ error: 'Could not verify X account', detail: me });
    }

    const cleanWallet = wallet ? wallet.toLowerCase() : null;

    // Step 3: save token row (service-role only, RLS blocks anon reads)
    const { error: te } = await supabase.from('x_oauth_tokens').upsert({
      x_user_id: xUserId,
      x_username: xUsername,
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_at: new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString(),
      wallet: cleanWallet
    }, { onConflict: 'x_user_id' });
    if (te) console.error('[x-token] token upsert error:', te.message);

    // Step 4: mark the wallet's profile as verified
    if (cleanWallet) {
      const { error: pe } = await supabase.from('profiles').upsert({
        wallet: cleanWallet,
        x_user_id: xUserId,
        x_handle: xUsername,
        x_verified: true
      }, { onConflict: 'wallet' });
      if (pe) console.error('[x-token] profile upsert error:', pe.message);
    }

    console.log('[x-token] verified @' + xUsername, '->', cleanWallet);
    res.json({ verified: true, username: xUsername, userId: xUserId });
  } catch (e) {
    console.error('[x-token] fatal error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
