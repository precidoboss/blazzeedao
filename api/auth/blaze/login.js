// api/auth/blaze/login.js  ->  GET /api/auth/blaze/login?wallet=0x...
const crypto = require('crypto');
const supabase = require('../../_supabase.js');

module.exports = async (req, res) => {
  try {
    const wallet = String(req.query.wallet || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return res.status(400).send('Missing or invalid wallet address.');
    }

    const redirectUri = `${process.env.PUBLIC_BACKEND_URL}/api/auth/blaze/callback`;

    const resp = await fetch('https://blaze.stream/bapi/oauth2/generate-auth-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        redirectUri,
        scopes: ['users.read', 'offline.access']
      })
    });
    const { url, state, codeVerifier } = await resp.json();
    if (!url) return res.status(502).send('Blaze did not return an auth URL.');

    const sessionId = crypto.randomUUID();
    await supabase.from('oauth_pending').insert({
      session_id: sessionId, state, code_verifier: codeVerifier, wallet
    });

    res.setHeader('Set-Cookie', `clipdao_auth_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.writeHead(302, { Location: url });
    res.end();
  } catch (e) {
    res.status(500).send('Could not start Blaze login: ' + e.message);
  }
};
