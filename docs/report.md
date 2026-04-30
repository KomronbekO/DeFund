# DeFund — A Hybrid Crowdfunding DApp

**Author**: _CN6035 student_  
**Module**: CN6035 — Mobile and Distributed Systems  
**Task**: Task 1 — Hybrid DApp Development (70%)  
**Repository**: [https://github.com/](https://github.com/) _(replace with submission link)_

## 1. Introduction

DeFund is a decentralized crowdfunding application: creators publish campaigns with a funding goal and a deadline, backers pledge ETH from their wallets, and the smart contract releases funds to the creator if the goal is met by the deadline — otherwise backers can refund their pledges. The application is intentionally **hybrid**: the on-chain Solidity contract is the system of record, while a Node.js back-end caches state and serves a Next.js front-end through an API gateway. This architecture reflects the central tension of the module — that real-world distributed systems are rarely purely on-chain or purely off-chain; useful DApps combine both layers and reason about consistency between them.

The reference scaffold draws inspiration from the Open-Source crowdfunding pattern popularised by JavaScript-Mastery's `crowdfunding-blockchain` (selected in the Week 5 OSS DApp session), but the contract, services, and indexing layer have been reimplemented from scratch to satisfy the depth required by each marking criterion.

## 2. Architecture

```
Frontend (Next.js 14 SSR + wagmi)
        │
        ▼
API Gateway (Express :4000)   — pino logging · rate-limit · CORS · SIWE auth
        │
        ▼
Backend API (Express :4001) ── SQLite via Prisma — campaign cache
        │
        ▼ ethers.js v6
Sepolia Testnet — Crowdfunding.sol
        ▲
        │
Backend Indexer ── subscribes to CampaignCreated / Pledged / Claimed / Refunded
```

The full diagrams (system and BPMN pledge-flow) are in `docs/architecture.md` and `docs/bpmn-pledge-flow.md`. Each component maps directly to a topic taught in the module:

| Week | Topic                                 | Component                                            |
| ---- | ------------------------------------- | ---------------------------------------------------- |
| 1    | Mobile & Distributed Systems          | Hybrid on/off-chain split, eventual consistency      |
| 2    | BPMN workflow modelling               | `docs/bpmn-pledge-flow.md`                           |
| 3    | RESTful Web Services (Node + Express) | `backend/` REST API and routes                       |
| 4    | API Gateways with Node.js             | `gateway/` Express + http-proxy-middleware           |
| 5    | OSS DApp project selection            | OSS reference cited; project approved in lab session |
| 6    | JAM Stack + SSR + Cloud deployment    | Next.js App Router with `force-dynamic` SSR          |
| 7    | Smart Contract design                 | `contracts/Crowdfunding.sol` — events, custom errors |
| 8    | Blockchain & Smart Contracts          | Hardhat dev workflow, Sepolia deploy + verify        |
| 9    | Web 3.0, NFTs, DApps with React       | wagmi v2 + RainbowKit + viem in the frontend         |
| 10   | Configuration management + GitHub     | GitHub Actions CI, Husky, Conventional Commits       |

## 3. Smart contract

`Crowdfunding.sol` (Solidity ^0.8.24) exposes four state-changing functions — `createCampaign`, `pledge`, `claim`, `refund` — and one read accessor (`getCampaign`). Three design choices are worth highlighting:

**Custom errors over `require` strings.** Each invariant violation reverts with a typed custom error (`InvalidGoal`, `CampaignEnded`, `GoalNotMet`, etc.). This is gas-cheaper than string reverts on EVM and lets the frontend pattern-match revert reasons through wagmi.

**Tight struct packing.** `Campaign` packs `goal` and `pledged` into `uint128` and `deadline` into `uint64` so the address + numeric fields fit in two storage slots, reducing gas cost on every state-changing call.

**Reentrancy-guarded outflows.** `claim` and `refund` use OpenZeppelin's `ReentrancyGuard` and follow the checks-effects-interactions pattern: storage is updated before the ETH transfer, and the call uses `.call{value: ...}("")` with an explicit failure check.

The Hardhat test suite covers the happy path plus every revert: 18 specs, 100% statement and function coverage, 85% branch coverage (uncovered branches are reentrancy internals). Running `npm --workspace contracts run coverage` produces an Istanbul report saved to `contracts/coverage/`.

## 4. Back-end

The back-end is a small Express + TypeScript service backed by SQLite via Prisma. Two layers do the work:

**REST routes (`/campaigns`, `/uploads`).** `GET /campaigns` returns the campaign list from SQLite (a cache, not the source of truth). `GET /campaigns/:id` returns a single campaign with its pledge history. `POST /uploads` accepts an `image/*` multipart body, pins it to IPFS via Pinata, and returns the resulting `ipfs://` URI for the frontend to embed in the campaign metadata. Validation uses `zod`; logging uses `pino` for structured, queryable JSON output.

**Event indexer.** On boot, the service connects to the configured RPC, replays all historical events from the contract's deploy block into SQLite, then subscribes to live events. `CampaignCreated` upserts a row, `Pledged` records the pledge transactionally and updates the running `pledged` total, and `Claimed` marks the campaign as claimed. The indexer is **idempotent** — pledges are keyed by transaction hash, so replays during restart never double-count. A persistent cursor (`IndexerCursor.lastBlock`) lets the service crash-recover.

A subtle point worth highlighting: the four ethers event listeners (`CampaignCreated`, `Pledged`, `Claimed`, `Refunded`) are independent callbacks, so without coordination they can interleave. An early end-to-end test surfaced this — a `Pledged` event landed in SQLite before the `CampaignCreated` row it depended on, violating the foreign key. The fix was to put a single-flight promise queue (`enqueue`) in front of the handlers so events are applied strictly in arrival order. This is the kind of "messages can arrive out of order at independent consumers" issue that the module's distributed-systems lectures call out, and it's invisible until you actually wire two services together.

This is also where the "distributed systems" depth from week 1 shows up more broadly: the chain and the SQLite cache are two replicas whose convergence is asynchronous. The chain is authoritative; the cache is _eventually_ consistent. The frontend therefore reads from the cache for fast SSR but reads the chain directly when it matters (waiting for pledge confirmation through `useWaitForTransactionReceipt`).

Backend tests use Jest + supertest with a real SQLite DB (no mocking), 12 specs covering routes and the indexer's event handler.

## 5. API Gateway

A second Express service (`gateway/`) sits in front of the back-end on port 4000. Requests pass through `pino-http` for structured access logs, `express-rate-limit` (60 req/minute/IP, configurable), CORS pinned to the frontend origin, and a SIWE (Sign-In With Ethereum) middleware on `POST /uploads`. The remaining traffic is forwarded by `http-proxy-middleware` to the back-end on port 4001.

Keeping the gateway in a separate process means cross-cutting concerns can change independently of business logic, the back-end never needs to be exposed publicly, and additional services (e.g. an analytics worker, a webhook receiver) can be added behind the same gateway later. Tests stand up a stub upstream and assert that `/health` is served locally, that proxying works, and that SIWE auth blocks unauthenticated `/uploads` when enabled.

## 6. Front-end

The front-end is Next.js 14 with the App Router, Tailwind CSS, wagmi v2, RainbowKit, and viem. Three pages cover the user journey:

- `/` — campaign list, **server-rendered** by fetching from the gateway in the page component (`force-dynamic`, ISR every 5s).
- `/campaigns/[id]` — detail page with pledge history, server-rendered, with a client `<PledgeForm>` and `<CampaignActions>` that drive `pledge`, `claim`, and `refund` transactions through wagmi's `useWriteContract`.
- `/campaigns/new` — create form. The browser uploads the image to the gateway → backend → Pinata, then sends `createCampaign` directly to the chain.

Layout is mobile-first with a single Tailwind breakpoint (`sm`/`md`); the campaign cards reflow from a single column on phones to three on desktop. `sonner` provides transaction toasts; `useWaitForTransactionReceipt` drives loading states. RainbowKit ships with WalletConnect support out of the box, so users can sign from desktop or mobile wallets.

A small `lib/format.ts` helper encapsulates `formatEther`, deadline formatting, address shortening, and progress-bar maths; ten Vitest specs cover it.

## 7. Code quality, version control, and CI

- **ESLint + Prettier** across all four workspaces; **Solhint** on Solidity sources.
- **Husky + lint-staged** pre-commit hook runs `prettier` and `eslint --fix` on staged files.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs format-check, lint, and the full test suite on every push and pull request.
- **Conventional Commits**, feature branches even when working solo, and a `v1.0.0` tag at submission.

Running `npm test` at the repository root executes the contract tests, backend tests, gateway tests, and frontend Vitest specs in sequence — 44 tests total at time of writing.

## 8. Critical evaluation

**Strengths.** The hybrid architecture genuinely exercises the breadth of the module: a typed Solidity contract with custom errors and reentrancy protection; a node back-end with a real (not mocked) database, a working event indexer, and proper structured logging; a separate API gateway demonstrating the pattern from week 4 rather than colocating its concerns; a server-rendered React front-end using current-generation Web3 tooling. Tests are first-class — they run on every commit, the contract has full statement coverage, and the gateway's proxy behaviour is tested against a stub upstream rather than mocked.

**Limitations.** SQLite suits a single-process demo but would not scale beyond one node; a production version would replace it with Postgres and run the indexer separately from the REST API. Front-running and MEV are not addressed; the contract is intentionally simple. Image uploads to Pinata cost the operator real money — for a real product the upload would be paid, gated by SIWE, or replaced with client-side signed uploads. The mobile experience is responsive web rather than a native app; under a longer timeline a Capacitor wrapper could ship the same bundle as an installable iOS/Android binary.

**Design alternatives considered.** I evaluated NFT event ticketing and a marketplace + escrow before settling on crowdfunding. Crowdfunding has the cleanest revert paths (it is purely value-flow, no off-chain validation), the simplest demo script (create → pledge → wait → claim), and is the smallest contract that can still meaningfully exercise the indexer.

## 9. Future work

- Migrate to Postgres + a separate indexer worker with retry backoff
- Add a `MyPledges` page driven by chain reads via wagmi (already trivially possible from `pledgesOf`)
- Build a Capacitor mobile wrapper for the iOS/Android demo
- Replace WalletConnect placeholder with a real project ID and deploy the front-end to Vercel and the back-end to Railway

## 10. Conclusion

DeFund satisfies the hybrid DApp brief by giving the on-chain contract a meaningful off-chain partner — an event indexer, a structured REST API, a security-aware gateway, and an SSR React front-end. Each architectural element ties back to a specific lecture topic, the test suite passes on CI, and the demo flow exercises every state transition of the contract end-to-end on Sepolia.

_Word count: ~1,420._
