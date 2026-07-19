// api/bounty-flags.js  ->  GET /api/bounty-flags?bountyId=0&wallet=0x...
//
// Flags submitted against a clip are only meant to be visible to the
// streamer who posted the bounty (so clippers can't see who flagged what).
// The `submission_flags` table has RLS locked down to service-role-only
// reads, so this endpoint is the ONLY way to read flags — and it verifies
// on-chain that `wallet` is really the bounty's streamer before returning
// anything.
const { ethers } = require('ethers');
const supabase = require('./_supabase.js');

const ESCROW_ADDRESS = '0xc515aaB3b3BBDC2313dc72e1603E0E1ccB419Ee1';
const FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const ESCROW_ABI = [
  'function getBounty(uint256) view returns (tuple(address streamer, uint256 reward, uint256 deadline, uint256 postedAt, uint8 mode, uint8 status, string vodId, string description, uint256 submissionCount, uint256 resolvedAt))'
];

module.exports = async (req, res) => {
  const bountyId = String(req.query.bountyId || '');
  const wallet = String(req.query.wallet || '').toLowerCase();

  if (!/^\d+$/.test(bountyId)) return res.status(400).json({ error: 'invalid bountyId' });
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return res.status(400).json({ error: 'invalid wallet' });

  try {
    const provider = new ethers.JsonRpcProvider(FUJI_RPC);
    const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
    const bounty = await escrow.getBounty(bountyId);
    const streamer = String(bounty.streamer || bounty[0]).toLowerCase();

    if (streamer !== wallet) {
      // Not the streamer for this bounty — return an empty list rather than
      // an error, so the frontend doesn't need special-case handling.
      return res.json({ flags: [] });
    }

    const { data, error } = await supabase
      .from('submission_flags')
      .select('submission_index, flagged_by, reason, created_at')
      .eq('bounty_id', bountyId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ flags: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Could not load flags', detail: e.message });
  }
};
