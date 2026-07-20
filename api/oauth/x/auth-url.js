// api/oauth/x/auth-url.js  ->  POST /api/oauth/x/auth-url  { redirectUri }
//
// X (Twitter) has no "generate-auth-url" helper like Blaze does, so this
// builds the PKCE code_verifier/code_challenge and the authorize URL by
// hand, using Node's built-in crypto module. X_CLIENT_SECRET never touches
// the frontend — only the finished authorize URL, state, and codeVerifier
// are returned (the codeVerifier has to go back to the browser since it's
// needed again in the token exchange step after the redirect).

const crypto = require('crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { redirectUri } = req.body;
  if (!redirectUri) return res.status(400).json({ error: 'redirectUri required' });
  if (!process.env.X_CLIENT_ID) return res.status(500).json({ error: 'X_CLIENT_ID not set in Vercel env vars' });

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

  res.json({
    url: `https://twitter.com/i/oauth2/authorize?${params.toString()}`,
    state,
    codeVerifier
  });
};
