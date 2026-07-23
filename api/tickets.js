// api/tickets.js
//
// Support ticket conversation threads. Uses the same signed-session-token
// pattern as api/admin.js (see that file's comment for the full rationale)
// but action=auth here is open to ANY wallet, not just ADMIN_WALLET — it
// just proves the caller controls that wallet, scoping them to their own
// tickets. A token issued by api/admin.js's login (i.e. belonging to
// ADMIN_WALLET) also works here and gets access to every ticket, since it's
// the same signing secret and token format.

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
function requireSession(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'not signed in' };
  const [wallet, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!wallet || !expiry || !sig) return { ok: false, error: 'not signed in' };
  if (Date.now() > expiry) return { ok: false, error: 'session expired — sign in again' };
  if (sig !== hmac(`${wallet}.${expiry}`)) return { ok: false, error: 'invalid session' };
  const isAdmin = !!process.env.ADMIN_WALLET && wallet === process.env.ADMIN_WALLET.toLowerCase();
  return { ok: true, wallet, isAdmin };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const action = req.query.action || req.body?.action;

  try {
    if (action === 'auth') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { wallet, signature, timestamp } = req.body || {};
      const check = verifyWalletSignature({ wallet, signature, timestamp }, 'Support ticket login');
      if (!check.ok) return res.status(401).json({ error: check.error });
      return res.json({ token: issueToken(wallet), expiresInMs: SESSION_TTL_MS });
    }

    const session = requireSession(req);
    if (!session.ok) return res.status(401).json({ error: session.error });

    // Fetch a ticket and enforce that the caller owns it (or is admin).
    async function loadOwnedTicket(ticketId) {
      const { data: ticket, error } = await supabase.from('support_tickets').select('*').eq('id', ticketId).maybeSingle();
      if (error || !ticket) return { error: 'Ticket not found' };
      if (!session.isAdmin && (!ticket.wallet || ticket.wallet.toLowerCase() !== session.wallet)) {
        return { error: 'Not your ticket' };
      }
      return { ticket };
    }

    if (action === 'list') {
      const { data, error } = await supabase.from('support_tickets')
        .select('*').eq('wallet', session.wallet).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ tickets: data || [] });
    }

    if (action === 'messages') {
      const { ticketId } = req.query;
      const { ticket, error } = await loadOwnedTicket(ticketId);
      if (error) return res.status(403).json({ error });
      const { data, error: msgErr } = await supabase.from('ticket_messages')
        .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      return res.json({ ticket, messages: data || [] });
    }

    if (action === 'reply') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      const { ticketId, message } = req.body || {};
      if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });
      const { ticket, error } = await loadOwnedTicket(ticketId);
      if (error) return res.status(403).json({ error });
      if (ticket.status === 'closed') return res.status(403).json({ error: 'This ticket is closed' });
      // One-time tickets are meant to be a single question + a single reply,
      // not an ongoing thread — only the admin can reply on those.
      if (ticket.type === 'one_time' && !session.isAdmin) {
        return res.status(403).json({ error: 'This is a one-time ticket — open a live chat ticket if you need to go back and forth' });
      }
      const { error: insErr } = await supabase.from('ticket_messages').insert({
        ticket_id: ticketId,
        sender: session.isAdmin ? 'admin' : 'user',
        message: String(message).slice(0, 3000)
      });
      if (insErr) throw insErr;
      // First admin reply on an open ticket signals it's being handled.
      if (session.isAdmin && ticket.status === 'open' && ticket.type === 'one_time') {
        await supabase.from('support_tickets').update({ status: 'replied' }).eq('id', ticketId);
      }
      return res.json({ ok: true });
    }

    if (action === 'close') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
      if (!session.isAdmin) return res.status(403).json({ error: 'Only admin can close a ticket' });
      const { ticketId } = req.body || {};
      const { error } = await supabase.from('support_tickets')
        .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', ticketId);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    console.error('[tickets]', action, e.message);
    return res.status(500).json({ error: 'Ticket request failed', detail: e.message });
  }
};
