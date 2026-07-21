// api/_verify-signature.js
//
// SECURITY — shared helper used by every endpoint that changes something
// tied to a wallet's identity (linking/disconnecting Blaze or X, saving a
// profile, editing bounty metadata). Before this existed, those endpoints
// trusted a `wallet` field the client sent in the POST body with zero proof
// the caller actually controls that wallet — anyone could POST any address
// and act as that user. This closes that gap by requiring a signed message.
//
// This is a lightweight signed-message scheme, not full SIWE (EIP-4361).
// It's stateless on purpose, because Vercel serverless functions don't
// share memory/DB connections across invocations the way a long-running
// server would. The message embeds the action name and a timestamp; a
// signature is only accepted within a 5-minute window, so a captured
// signature is only replayable for that long, and only for that one exact
// action. That's a large improvement over no verification at all, but a
// server-issued single-use nonce (real SIWE) is stronger — see the note
// in AUDIT.md if you want to upgrade to that later.

const { ethers } = require('ethers');

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const CLOCK_SKEW_MS = 30 * 1000;  // allow the client's clock to be a bit ahead

// Builds the exact message the frontend must sign for a given action.
// Keep this byte-for-byte identical to signAction() in index.html —
// any drift and every signature will fail to verify.
function buildMessage(action, wallet, timestamp) {
  return `BlazeDAO wants you to confirm: ${action}\nWallet: ${wallet.toLowerCase()}\nTimestamp: ${timestamp}`;
}

// Verifies { wallet, signature, timestamp } proves control of `wallet` for
// the given action. Returns { ok:true } or { ok:false, error }.
function verifyWalletSignature({ wallet, signature, timestamp }, action) {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return { ok: false, error: 'invalid wallet' };
  if (!signature || typeof signature !== 'string') return { ok: false, error: 'signature required' };
  if (!timestamp || typeof timestamp !== 'number') return { ok: false, error: 'timestamp required' };

  const age = Date.now() - timestamp;
  if (age > MAX_AGE_MS || age < -CLOCK_SKEW_MS) return { ok: false, error: 'signature expired — please try again' };

  const message = buildMessage(action, wallet, timestamp);
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch (e) {
    return { ok: false, error: 'malformed signature' };
  }

  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    return { ok: false, error: 'signature does not match wallet' };
  }
  return { ok: true };
}

module.exports = { buildMessage, verifyWalletSignature, MAX_AGE_MS };
