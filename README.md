# 🔥 BlazeDAO

**The first Blaze-native clipping economy.** Streamers post $BLAZE bounties for clips of their stream, clippers compete to make the best one, and a trustless smart contract escrow handles the payout — no middleman, no chargebacks, no "trust me bro."

Built for the Blaze Builder Challenge, live on Avalanche Fuji Testnet.

Created by **precidobos**.

---

## What it does

- **Streamers** lock $BLAZE into an on-chain escrow contract and post a bounty: a description, a reward, a deadline, and a mode (they pick the winner themselves, or the community votes).
- **Clippers** submit clip links against open bounties.
- **Winners get paid out directly from the smart contract** — reward funds never touch a centralized wallet.
- Everything around the bounty — comments, requirements, schedule, flags — lives alongside it so streamers and clippers can actually coordinate, not just transact.

---

## Features

### Core bounty flow
- Post a bounty (reward, VOD reference, description, deadline, mode) — funds are locked in the escrow contract via ERC-20 `approve` + `postBounty`
- Two resolution modes:
  - **Streamer Pick** — the streamer selects winner(s) and splits the reward
  - **Community Vote** — clippers vote on submissions; highest-voted clip(s) win automatically once the deadline passes
- Submit a clip link against any open bounty
- Claim rewards once a bounty resolves
- Cancel an unclaimed bounty (streamer only)

### Streamer profile (Blaze-linked)
- Connect wallet (MetaMask / injected provider, auto-switches to Fuji)
- Link a Blaze account via OAuth — pulls live channel status, follower/subscriber counts, and avatar
- Set an X (Twitter) handle, which bounties can auto-tag

### Extended bounty details (off-chain, Supabase-backed)
The on-chain contract only stores the essentials. Everything else a streamer needs to communicate lives in Supabase and renders alongside the on-chain data:
- **Stream title** — shown on the bounty banner
- **X account to tag** — pulled automatically from the streamer's saved profile
- **Special requirements / rules** — either a free-written note, or a structured checklist
- **Stream schedule** — day, time, and timezone
- **Number of winners** the streamer plans to pick

### Bounty page extras
- **Banner images** — each bounty card and detail page pulls the streamer's live Blaze profile picture as its banner
- **Comments** — an open thread under every bounty so streamers and clippers can talk through details
- **Share links** — a share button copies a direct link (`?bounty=<id>`) that opens straight to that bounty when visited
- **Flagging** — clippers (or streamers) can flag a submission with a reason. Flags are only ever visible to that bounty's streamer — enforced server-side, not just hidden in the UI (see [Security notes](#security-notes))

### Dashboard
- Overview tab with $BLAZE balance, Blaze stats, and quick links
- My Bounties (posted) and My Submissions (clips you've submitted, unclaimed rewards)
- Profile tab (Blaze link status, X handle, disconnect)

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Single-page `index.html` — vanilla JS, no build step, no framework |
| Chain interaction | [ethers.js](https://docs.ethers.org/) v6, via CDN |
| Smart contract | Solidity escrow contract, deployed on **Avalanche Fuji Testnet** |
| Off-chain data | [Supabase](https://supabase.com) (Postgres + PostgREST + RLS) |
| Auth / integrations | Blaze OAuth (streamer account linking) |
| Serverless backend | Vercel serverless functions (`/api`) |

---

## Project structure

```
.
├── index.html                     # entire frontend — pages, styles, and app logic
├── api/
│   ├── _supabase.js                # shared Supabase client (service-role key, server-only)
│   ├── blaze-status.js             # GET  — check if a wallet has a linked Blaze account
│   ├── disconnect-blaze.js         # POST — unlink a Blaze account from a wallet
│   ├── link-wallet.js              # POST — link a Blaze account to a wallet
│   ├── bounty-flags.js             # GET  — streamer-only read of submission flags (on-chain verified)
│   ├── blaze/
│   │   └── channel.js               # Blaze channel/live status lookup
│   └── oauth/
│       ├── auth-url.js              # builds the Blaze OAuth authorize URL
│       └── token.js                 # exchanges an OAuth code for tokens
├── supabase_oauth_pending.sql      # schema: OAuth PKCE session storage
├── supabase_bounty_features.sql    # schema: bounty_meta, bounty_comments, submission_flags
├── package.json
└── vercel.json
```

---

## Smart contract

| | |
|---|---|
| Network | Avalanche Fuji Testnet (chain id `43113`) |
| Escrow contract | `0xc515aaB3b3BBDC2313dc72e1603E0E1ccB419Ee1` |
| $BLAZE token | `0x57BAEAC484A0F3d5694d81420402FE54D4fBfec7` |

Core contract functions the frontend calls:
- `postBounty(reward, vodId, description, mode, deadline)`
- `submitClip(bountyId, clipLink)`
- `voteSubmission(bountyId, submissionIndex)` (community vote mode)
- `pickWinners(bountyId, indexes[], amounts[])` (streamer pick mode)
- `resolveCommunityVote(bountyId)`
- `claimReward(bountyId)`
- `cancelBounty(bountyId)`
- `getBounty(bountyId)`, `getSubmissions(bountyId)`, `getClaimable(wallet, bountyId)`, `bountyCount()`

## Roadmap
- [ ] Mainnet deployment

---

## License

No license file is currently included — all rights reserved by the author unless a license is added.

---

Built with 🔥 by **precidobos** for the Blaze Builder Challenge.
