// api/oauth/auth-url.js -> POST { provider: 'blaze'|'x', redirectUri }
//
// Merged from the former api/oauth/auth-url.js (Blaze) + api/oauth/x/auth-url.js
// (X) — see api/disconnect.js for why. Behavior per provider is unchanged,
// this just routes on `provider` instead of living in two separate files
// (which also frees up the api/oauth/x/ folder entirely).

const crypto = require('crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function blazeAuthUrl(redirectUri) {
  if (!process.env.BLAZE_CLIENT_SECRET) throw Object.assign(new Error('BLAZE_CLIENT_SECRET not set in Vercel env vars'), { status: 500 });
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
  console.log('[OAUTH] blaze auth-url response:', r.status, JSON.stringify(data).slice(0, 120));
  return data;
}

// X has no "generate-auth-url" helper like Blaze does, so this builds the
// PKCE code_verifier/code_challenge and the authorize URL by hand.
// X_CLIENT_SECRET never touches the frontend — only the finished authorize
// URL, state, and codeVerifier are returned (the codeVerifier has to go
// back to the browser since it's needed again in the token exchange step).
function xAuthUrl(redirectUri) {
  if (!process.env.X_CLIENT_ID) throw Object.assign(new Error('X_CLIENT_ID not set in Vercel env vars'), { status: 500 });
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'tweet.read users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return { url: `https://twitter.com/i/oauth2/authorize?${params.toString()}`, state, codeVerifier };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { provider, redirectUri } = req.body;
  if (!redirectUri) return res.status(400).json({ error: 'redirectUri required' });
  if (provider !== 'blaze' && provider !== 'x') return res.status(400).json({ error: 'provider must be "blaze" or "x"' });

  try {
    const data = provider === 'blaze' ? await blazeAuthUrl(redirectUri) : xAuthUrl(redirectUri);
    res.json(data);
  } catch (e) {
    console.error('[OAUTH] auth-url error:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
};
