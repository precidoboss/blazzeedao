// api/oauth/auth-url.js  ->  POST /api/oauth/auth-url
// Proxies the generate-auth-url call so BLAZE_CLIENT_SECRET never touches the frontend.

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { redirectUri } = req.body;
  if (!redirectUri) return res.status(400).json({ error: 'redirectUri required' });
  if (!process.env.BLAZE_CLIENT_SECRET) return res.status(500).json({ error: 'BLAZE_CLIENT_SECRET not set in Vercel env vars' });

  try {
    const r = await fetch('https://blaze.stream/bapi/oauth2/generate-auth-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId:     process.env.BLAZE_CLIENT_ID,
        clientSecret: process.env.BLAZE_CLIENT_SECRET,
        redirectUri,
        scopes: ['users.read', 'offline.access']
      })
    });
    const data = await r.json();
    console.log('[OAUTH] auth-url response:', r.status, JSON.stringify(data).slice(0, 120));
    res.json(data);
  } catch (e) {
    console.error('[OAUTH] auth-url error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
