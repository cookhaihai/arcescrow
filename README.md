# ArcEscrow

**Conditional USDC settlement on Arc.** Lock USDC into a smart contract that releases to the
payee the moment delivery is confirmed — or returns to the payer once the deadline passes.

Built for the **Build on Arc** hackathon · DeFi track.

## Why Arc

- **USDC is the native gas token**, so escrowed value and transaction fees are the same
  dollar-denominated asset. Locking funds needs no ERC-20 `approve` — the contract holds
  native value directly, which removes an entire class of allowance bugs.
- **Sub-second finality** makes release feel like a payment, not a settlement batch.
- **Onchain memos** on every escrow give invoices a reconciliation key that lives with the money.

## What it does

| Action | Who | Effect |
| --- | --- | --- |
| `createEscrow(payee, deadline, memo)` | Payer | Locks `msg.value` USDC in the contract |
| `release(id)` | Payer | Sends the full amount to the payee |
| `refund(id)` | Payer, after deadline | Returns the full amount to the payer |

State machine: `Locked → Released` or `Locked → Refunded`. Terminal either way — funds can
never be double-spent, and neither party can move them outside these paths.

## Deployment

| | |
| --- | --- |
| Network | Arc Testnet (chain `5042002`) |
| Contract | [`0x8Eb90015789e4c321aF664eA51B21b0Dc81447bf`](https://testnet.arcscan.app/address/0x8Eb90015789e4c321aF664eA51B21b0Dc81447bf) |
| Source | Verified onchain via Sourcify |

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL. You'll need:

1. **MetaMask** with Arc Testnet added (the app will offer to add it for you).
2. **Testnet USDC** from the [Circle faucet](https://faucet.circle.com/) — select Arc Testnet.

## Stack

- **Contract** — Solidity 0.8.20, no external dependencies. Checks-effects-interactions
  ordering on both payout paths.
- **Frontend** — React + Vite + ethers v6. Reads state directly from the chain; no backend,
  no indexer, no database.

## Layout

```
contracts/ArcEscrow.sol   the escrow contract
src/contract.js           address, ABI, network config
src/App.jsx               wallet, form, ledger
src/styles.css            design tokens and layout
```
