// api/bounty-meta.js -> POST { bountyId, wallet, signature, timestamp, meta }
//
// SECURITY: bounty_meta holds the off-chain data shown alongside every
// on-chain bounty — title, requirements, schedule, and (importantly) the
// X handle a bounty tags. Previously the browser wrote directly to this
// table with the public anon key and no ownership check at all — anyone
// could upsert a row for ANY bounty_id and rewrite a streamer's
// requirements or, worse, swap in a different X handle to tag, hijacking
// attribution for a bounty they don't own.
//
// This endpoint is now the only allowed write path (see
// supabase_rls.sql) and it:
//   1. Verifies the caller controls `wallet` (signed message).
//   2. Reads the bounty from the escrow contract on-chain and confirms
//      `wallet` really is that bounty's streamer before writing anything.
const { ethers } = require('ethers');
const supabase = require('./_supabase.js');
const { verifyWalletSignature } = require('./_verify-signature.js');

const ESCROW_ADDRESS = '0xc515aaB3b3BBDC2313dc72e1603E0E1ccB419Ee1';
const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const ESCROW_ABI = [
  'function getBounty(uint256) view returns (tuple(address streamer, uint256 reward, uint256 deadline, uint256 postedAt, uint8 mode, uint8 status, string vodId, string description, uint256 submissionCount, uint256 resolvedAt))'
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { bountyId, wallet, signature, timestamp, meta } = req.body;

  if (!/^\d+$/.test(String(bountyId))) return res.status(400).json({ error: 'invalid bountyId' });
  const check = verifyWalletSignature({ wallet, signature, timestamp }, `Save bounty #${bountyId} details`);
  if (!check.ok) return res.status(401).json({ error: check.error });

  const w = wallet.toLowerCase();

  try {
    const provider = new ethers.JsonRpcProvider(FUJI_RPC);
    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
    const bounty = await escrow.getBounty(bountyId);
    const streamer = String(bounty.streamer || bounty[0]).toLowerCase();
    if (streamer !== w) return res.status(403).json({ error: 'Only the bounty streamer can edit this' });
  } catch (e) {
    return res.status(500).json({ error: 'Could not verify bounty on-chain', detail: e.message });
  }

  const m = meta || {};
  const row = {
    bounty_id: Number(bountyId),
    streamer_wallet: w,
    stream_title: String(m.streamTitle || '').slice(0, 120) || null,
    x_handle: String(m.xHandle || '').replace(/^@/, '').slice(0, 30) || null,
    requirements_type: m.reqType === 'list' ? 'list' : 'freeform',
    requirements_text: m.reqType === 'freeform' ? (String(m.reqText || '').slice(0, 2000) || null) : null,
    requirements_list: m.reqType === 'list' ? (Array.isArray(m.reqList) ? m.reqList.slice(0, 20).map(s => String(s).slice(0, 200)) : []) : [],
    schedule_day: m.scheduleDay || null,
    schedule_time: m.scheduleTime || null,
    schedule_timezone: String(m.scheduleTz || '').slice(0, 40) || null,
    num_winners: Math.max(1, Math.min(50, parseInt(m.numWinners) || 1))
  };

  const { error } = await supabase.from('bounty_meta').upsert(row, { onConflict: 'bounty_id' });
  if (error) return res.status(500).json({ error: 'Could not save bounty details', detail: error.message });

  res.json({ ok: true });
};
