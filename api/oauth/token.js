// api/oauth/token.js  ->  POST /api/oauth/token
// Exchanges the auth code for an access token and saves the Blaze identity to Supabase.

const supabase = require('../_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, codeVerifier, redirectUri, wallet } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!process.env.BLAZE_CLIENT_SECRET) return res.status(500).json({ error: 'BLAZE_CLIENT_SECRET not set in Vercel env vars' });

  try {
    const r = await fetch('https://blaze.stream/bapi/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId:     process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        code,
        codeVerifier,
        redirectUri,
        grantType: 'authorization_code'
      })
    });
    const data = await r.json();
    console.log('[OAUTH] token response:', r.status, JSON.stringify(data).slice(0, 120));

    // If we got a real token back and the frontend sent a wallet address,
    // save the Blaze identity to Supabase and link it to the wallet.
    if (data.accessToken && wallet) {
      const cleanWallet = wallet.toLowerCase();

      await supabase.from('blaze_oauth_tokens').upsert({
        blaze_user_id:  data.userId,
        blaze_username: data.username || data.displayName || null,
        access_token:   data.accessToken,
        refresh_token:  data.refreshToken || null,
        expires_at:     new Date(Date.now() + 3600 * 1000).toISOString(),
        wallet:         cleanWallet
      }, { onConflict: 'blaze_user_id' });

      await supabase.from('profiles').upsert({
        wallet:         cleanWallet,
        blaze_user_id:  data.userId,
        blaze_handle:   data.username || data.displayName || null,
        blaze_avatar:   data.avatarUrl || null
      }, { onConflict: 'wallet' });
    }

    res.json(data);
  } catch (e) {
    console.error('[OAUTH] token error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
