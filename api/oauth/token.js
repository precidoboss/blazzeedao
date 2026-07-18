// api/oauth/token.js
const supabase = require('../_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { code, codeVerifier, redirectUri, wallet } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!process.env.BLAZE_CLIENT_SECRET) return res.status(500).json({ error: 'BLAZE_CLIENT_SECRET not set' });

  try {
    const r = await fetch('https://blaze.stream/bapi/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId:     process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        code, codeVerifier, redirectUri,
        grantType: 'authorization_code'
      })
    });
    const data = await r.json();
    console.log('[token] status:', r.status, 'userId:', data.userId, 'username:', data.username, 'wallet:', wallet || 'null');

    if (data.accessToken) {
      const cleanWallet = wallet ? wallet.toLowerCase() : null;

      // ALWAYS save the token, even without a wallet — use blaze_user_id as primary key
      const tokenUpsert = await supabase.from('blaze_oauth_tokens').upsert({
        blaze_user_id:  data.userId,
        blaze_username: data.username || data.displayName || null,
        access_token:   data.accessToken,
        refresh_token:  data.refreshToken || null,
        expires_at:     new Date(Date.now() + 3600 * 1000).toISOString(),
        wallet:         cleanWallet  // may be null — gets linked later via /api/link-wallet
      }, { onConflict: 'blaze_user_id' });

      if (tokenUpsert.error) console.error('[token] blaze_oauth_tokens upsert error:', tokenUpsert.error.message);

      // Only upsert profiles if we have a wallet
      if (cleanWallet) {
        const profileUpsert = await supabase.from('profiles').upsert({
          wallet:        cleanWallet,
          blaze_user_id: data.userId,
          blaze_handle:  data.username || data.displayName || null,
          blaze_avatar:  data.avatarUrl || null
        }, { onConflict: 'wallet' });

        if (profileUpsert.error) console.error('[token] profiles upsert error:', profileUpsert.error.message);
      }
    }

    // Return everything the frontend needs
    res.json(data);
  } catch (e) {
    console.error('[token] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
