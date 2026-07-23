// api/admin.js
//
// Backend for the admin console (see the standalone admin HTML page).
// Everything lives in this one file, dispatched by `action`, so there's
// exactly one extra backend file for the whole admin feature.
//
// AUTH MODEL:
// 1. POST action=auth with a wallet signature (same scheme as every other
//    identity-sensitive endpoint — see _verify-signature.js). The signing
//    wallet must match process.env.ADMIN_WALLET — set that in Vercel's
//    project settings, never in code. Whoever controls that wallet's
//    private key is the admin; there's no separate password to leak.
// 2. On success, returns a short-lived (12h) signed session token: a plain
//    HMAC over `${wallet}.${expiry}`, keyed with SUPABASE_SERVICE_KEY. It's
//    stateless (no session table needed) and can't be forged without that
//    key. The admin page stores it in sessionStorage and sends it back as
//    `Authorization: Bearer <token>` on every other action.
//
// action=log is the one exception — it's public, unauthenticated, and only
// inserts into error_logs. It's what index.html's global error handler
// calls to report client-side errors from any visitor.

const crypto = require('crypto');
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hmac(payload) {
  return crypto.createHmac('sha256', process.env.SUPABASE_SERVICE_KEY || '').update(payload).digest('hex');
}

function issueToken(wallet) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${wallet.toLowerCase()}.${expiry}`;
  return `${payload}.${hmac(payload)}`;
}

function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'not signed in' };
  const [wallet, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!wallet || !expiry || !sig) return { ok: false, error: 'not signed in' };
  if (Date.now() > expiry) return { ok: false, error: 'session expired — sign in again' };
  const expected = hmac(`${wallet}.${expiry}`);
  if (sig !== expected) return { ok: false, error: 'invalid session' };
  if (!process.env.ADMIN_WALLET || wallet !== process.env.ADMIN_WALLET.toLowerCase()) {
    return { ok: false, error: 'not authorized' };
  }
  return { ok: true, wallet };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const action = req.query.action || req.body?.action;

  try {
    // ---------- PUBLIC: error reporting from any visitor ----------
    if (action === 'log') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { message, stack, url, wallet, userAgent } = req.body || {};
      if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
      await supabase.from('error_logs').insert({
        message: String(message).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        url: url ? String(url).slice(0, 500) : null,
        wallet: wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : null,
        user_agent: userAgent ? String(userAgent).slice(0, 300) : null
      });
      return res.json({ ok: true });
    }

    // ---------- LOGIN ----------
    if (action === 'auth') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      if (!process.env.ADMIN_WALLET) return res.status(500).json({ error: 'ADMIN_WALLET is not configured on the server' });
      const { wallet, signature, timestamp } = req.body || {};
      const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Admin login');
      if (!check.ok) return res.status(401).json({ error: check.error });
      if (wallet.toLowerCase() !== process.env.ADMIN_WALLET.toLowerCase()) {
        return res.status(403).json({ error: 'This wallet is not an admin' });
      }
      return res.json({ token: issueToken(wallet), expiresInMs: SESSION_TTL_MS });
    }

    // ---------- everything else requires a valid admin session ----------
    const auth = requireAdmin(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (action === 'overview') {
      const [flags, tickets, logs, announcement] = await Promise.all([
        supabase.from('submission_flags').select('id', { count: 'exact', head: true }).eq('resolved', false),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('error_logs').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString()),
        supabase.from('site_announcement').select('*').eq('id', 1).maybeSingle()
      ]);
      return res.json({
        openFlags: flags.count || 0,
        openTickets: tickets.count || 0,
        errorsLast24h: logs.count || 0,
        announcement: announcement.data || null
      });
    }

    if (action === 'flags') {
      const { data, error } = await supabase.from('submission_flags')
        .select('id, bounty_id, submission_index, flagged_by, reason, resolved, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return res.json({ flags: data || [] });
    }

    if (action === 'resolve-flag') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { id, resolved } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supabase.from('submission_flags').update({ resolved: !!resolved }).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    if (action === 'tickets') {
      const { data, error } = await supabase.from('support_tickets')
        .select('id, wallet, subject, category, message, status, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return res.json({ tickets: data || [] });
    }

    if (action === 'resolve-ticket') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { id, status } = req.body || {};
      if (!id || !['open','resolved'].includes(status)) return res.status(400).json({ error: 'id and valid status required' });
      const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    if (action === 'logs') {
      const { data, error } = await supabase.from('error_logs')
        .select('id, message, stack, url, wallet, user_agent, created_at')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return res.json({ logs: data || [] });
    }

    if (action === 'announcement') {
      if (req.method !== 'POST') {
        const { data, error } = await supabase.from('site_announcement').select('*').eq('id', 1).maybeSingle();
        if (error) throw error;
        return res.json({ announcement: data || null });
      }
      const { is_open, message } = req.body || {};
      const { error } = await supabase.from('site_announcement')
        .update({ is_open: !!is_open, message: String(message || '').slice(0, 500), updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error('[admin]', action, e.message);
    return res.status(500).json({ error: 'Admin request failed', detail: e.message });
  }
};
