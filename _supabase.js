// api/auth/blaze/callback.js  ->  GET /api/auth/blaze/callback?code=...&state=...
const supabase = require('../../_supabase.js');

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? match.split('=')[1] : null;
}

module.exports = async (req, res) => {
  try {
    const { code, state } = req.query;
    const sessionId = getCookie(req, 'clipdao_auth_session');
    if (!sessionId) return res.status(400).send('Missing session cookie — please try connecting again.');

    const { data: pending } = await supabase.from('oauth_pending').select('*').eq('session_id', sessionId).maybeSingle();
    if (!pending || pending.state !== state) {
      return res.status(400).send('Login session expired or invalid — please try connecting again.');
    }
    await supabase.from('oauth_pending').delete().eq('session_id', sessionId);

    const redirectUri = `${process.env.PUBLIC_BACKEND_URL}/api/auth/blaze/callback`;

    const tokenResp = await fetch('https://blaze.stream/bapi/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        code,
        codeVerifier: pending.code_verifier,
        redirectUri,
        grantType: 'authorization_code'
      })
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.accessToken) return res.status(400).send('Blaze token exchange failed.');

    const { userId, accessToken, refreshToken, expiresIn } = tokenData;

    const profileResp = await fetch('https://api.blaze.stream/v1/users/profile', {
      headers: {
        secret: process.env.BLAZE_CLIENT_SECRET,
        'client-id': process.env.BLAZE_CLIENT_ID,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      }
    });
    const profile = await profileResp.json();

    await supabase.from('blaze_oauth_tokens').upsert({
      blaze_user_id: userId,
      blaze_username: profile.username || null,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      wallet: pending.wallet
    }, { onConflict: 'blaze_user_id' });

    await supabase.from('profiles').upsert({
      wallet: pending.wallet,
      blaze_user_id: userId,
      blaze_handle: profile.username || null,
      blaze_avatar: profile.avatarUrl || null
    }, { onConflict: 'wallet' });

    const frontendUrl = process.env.FRONTEND_URL;
    res.writeHead(302, {
      Location: `${frontendUrl}/index.html?blazeConnected=1&blazeHandle=${encodeURIComponent(profile.username || '')}`
    });
    res.end();
  } catch (e) {
    res.status(500).send('Blaze callback failed: ' + e.message);
  }
};
