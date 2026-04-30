# DeFund — Architecture

This document is the technical design reference. For setup and operations, see [`README.md`](./README.md). For the academic write-up, see [`docs/report.md`](./docs/report.md).

---

## Table of contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [System overview](#2-system-overview)
3. [Trust and the source of truth](#3-trust-and-the-source-of-truth)
4. [Smart contract](#4-smart-contract)
5. [Backend API](#5-backend-api)
6. [Event indexer](#6-event-indexer)
7. [API gateway](#7-api-gateway)
8. [Frontend](#8-frontend)
9. [Data flow walkthroughs](#9-data-flow-walkthroughs)
10. [Cross-cutting concerns](#10-cross-cutting-concerns)
11. [Testing strategy](#11-testing-strategy)
12. [Operational concerns](#12-operational-concerns)
13. [Tradeoffs and alternatives considered](#13-tradeoffs-and-alternatives-considered)
14. [Future work](#14-future-work)

---

## 1. Goals and non-goals

### Goals

- **Be a real hybrid DApp.** Front-end + back-end + smart contract, all interacting, all serving a purpose. Not a thin contract wrapper; not a backend pretending to be a chain.
- **Be testable end-to-end on a laptop.** No mandatory cloud services. One command per workspace. Local Hardhat node behaves like a tiny TestNet.
- **Map cleanly onto the CN6035 syllabus.** Each weekly topic shows up as a concrete component the marker can point at.
- **Treat the contract as authoritative.** Off-chain caches and indexes exist for performance; the chain is the only place state changes commit.

### Non-goals

- A production-ready crowdfunding platform. There is no dispute resolution, no KYC, no operator fees.
- A full multi-tenant indexer service. Single-process, SQLite-backed; would need Postgres + a worker for scale.
- A native mobile app. The frontend is mobile-responsive web (PWA-ready); a Capacitor wrapper is left as future work.
- An ERC-20 token, governance, or NFT layer. Native ETH only.

---

## 2. System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              User's browser                               │
│                                                                          │
│   Next.js 14 (SSR + client components)        ┌──────────────────────┐   │
│   ─ wagmi (useWriteContract, useBlock,        │  MetaMask extension  │   │
│     useReadContract, useWaitForTxReceipt)     │  ─ private key       │   │
│   ─ RainbowKit (injected connector)           │  ─ signs txs         │   │
│   ─ viem under the hood                       └──────────┬───────────┘   │
└────────────────┬─────────────────────────────────────────┼───────────────┘
                 │ HTTP(S) reads                          │ JSON-RPC (signed txs)
                 ▼                                         │
┌──────────────────────────────────────┐                  │
│ Gateway :4000  (Express)             │                  │
│  ─ pino-http (structured access log) │                  │
│  ─ express-rate-limit (60 req/min/IP)│                  │
│  ─ cors (frontend origin)            │                  │
│  ─ siweAuth on POST /uploads         │                  │
│  ─ http-proxy-middleware → backend   │                  │
└────────────────┬─────────────────────┘                  │
                 │ internal HTTP                           │
                 ▼                                         │
┌──────────────────────────────────────┐                  │
│ Backend :4001  (Express + indexer)   │                  │
│  ─ /campaigns, /campaigns/:id        │                  │
│  ─ /uploads (Pinata or local disk)   │                  │
│  ─ /files/<id> (static, local mode)  │                  │
│  ─ Indexer poll loop (1 s tick)      │                  │
└──────┬─────────────────────┬─────────┘                  │
       │ Prisma              │ ethers v6 read             │
       ▼                     ▼                             ▼
┌──────────────┐   ┌─────────────────────────────────────────┐
│  SQLite      │   │ Local Hardhat node (chain id 31337)     │
│  cache       │   │   OR Sepolia (chain id 11155111)        │
│ ─ Campaign   │   │ Crowdfunding.sol                        │
│ ─ Pledge     │   │  ─ events: CampaignCreated, Pledged,    │
│ ─ Indexer    │   │             Claimed, Refunded           │
│   Cursor     │   └─────────────────────────────────────────┘
└──────────────┘
```

Three data planes:

- **Read plane (left side):** browser → gateway → backend → SQLite cache. Optimised for cheap, low-latency reads. Used to render lists and detail pages.
- **Write plane (right side):** browser → MetaMask → JSON-RPC → contract. The contract is the only writable thing. Backend never holds keys; gateway never proxies signed transactions.
- **Reconciliation plane (bottom):** indexer reads contract events from the chain via `eth_getLogs`, mirrors into SQLite. Eventually consistent, idempotent, crash-recoverable.

This decoupling is deliberate. It mirrors the CQRS/event-sourcing pattern: writes hit one place (the chain) and produce events; reads come from a denormalised projection (SQLite). The two are kept consistent by the indexer, which runs at its own pace.

---

## 3. Trust and the source of truth

The contract is the source of truth for everything financially relevant:

- Who created which campaign
- The goal and deadline of each campaign
- Total pledged per campaign
- Per-backer pledged amount (the refundable balance)
- Whether a campaign has been claimed

Anything in SQLite is a **cache**, derived from contract events. If the SQLite cache is wiped, the indexer rebuilds it by replaying events from the contract's deploy block. If the cache disagrees with the chain, the chain wins — period.

What this means in practice:

| Concern                                   | Authority                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Has this user already refunded?"         | `pledgesOf[id][user]` on chain. SQLite has the _historical_ event log but not the live remaining balance.                                                                        |
| "Is this campaign past its deadline?"     | The chain's view of `block.timestamp` + the campaign's `deadline`. Frontend uses `max(realNow, chainNow)` to be safe across both real-time and Hardhat-fast-forwarded scenarios. |
| "Is the goal met?"                        | Chain `c.pledged >= c.goal`.                                                                                                                                                     |
| "What are the recent pledges to display?" | SQLite (denormalised event history).                                                                                                                                             |

The frontend is paranoid: anything load-bearing for a transaction (Refund button, Claim button, Pledge availability) is read live from the chain via `useReadContract` or `useBlock`. SSR data is good enough for cosmetic display, never for gating actions.

---

## 4. Smart contract

`contracts/contracts/Crowdfunding.sol`

### State

```solidity
struct Campaign {
    address creator;        // 20 bytes
    uint128 goal;           // 16 bytes  ─ packed with creator into 1 slot
    uint128 pledged;        // 16 bytes
    uint64  deadline;       // 8  bytes  ─ packed with claimed into 1 slot
    bool    claimed;        // 1  byte
    string  metadataURI;    // dynamic
}

uint256                                              public campaignCount;
mapping(uint256 => Campaign)                         private _campaigns;
mapping(uint256 => mapping(address => uint256))      public  pledgesOf;
```

Two storage layout decisions worth highlighting:

1. **Packed struct.** `address` (20) + `uint128` (16) overflows a 32-byte slot, so `creator` and `goal` actually live in two slots. But `pledged` (16) packs with `goal` (16) into one slot. `deadline` (8) packs with `claimed` (1) into one slot. Net: 4 slots per campaign instead of 6. Saves ~20k gas on every state-changing call that touches the struct.
2. **`pledgesOf` is a public mapping.** Solidity auto-generates a getter, which the frontend uses via `useReadContract({ functionName: 'pledgesOf', args: [id, address] })` to know if the connected user has anything to refund. No off-chain index needed for that question.

### Functions

| Function                                                            | Visibility    | Modifiers      | Effect                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createCampaign(uint128 goal, uint64 deadline, string metadataURI)` | external      | —              | Adds a campaign, emits `CampaignCreated`. Reverts on `goal == 0` (`InvalidGoal`) or past deadline (`InvalidDeadline`).                                                                                             |
| `pledge(uint256 id) payable`                                        | external      | —              | Increments `c.pledged` and `pledgesOf[id][msg.sender]`. Reverts on past deadline (`CampaignEnded`), zero value (`ZeroPledge`), unknown id (`CampaignNotFound`).                                                    |
| `claim(uint256 id)`                                                 | external      | `nonReentrant` | Creator-only. After deadline if goal met. Sends full pledged total to creator. Reverts on `NotCreator` / `CampaignActive` / `GoalNotMet` / `AlreadyClaimed` / `TransferFailed`.                                    |
| `refund(uint256 id)`                                                | external      | `nonReentrant` | Backer-only. After deadline if goal not met. Sends `pledgesOf[id][msg.sender]` back. Zeroes the slot first (checks-effects-interactions). Reverts on `CampaignActive` / `GoalMet` / `NoPledge` / `TransferFailed`. |
| `getCampaign(uint256 id)`                                           | external view | —              | Returns the campaign struct. Used by tests and the frontend ABI surface.                                                                                                                                           |

### Security choices

- **Custom errors over `require` strings.** Each invariant has a typed error (`InvalidGoal`, `CampaignEnded`, `GoalMet`, `NoPledge`, etc.). Cheaper deployed bytecode and cheaper revert path; the frontend can match on selector if needed.
- **`ReentrancyGuard` on `claim` and `refund`.** Both functions transfer ETH out via `.call{value:...}("")`, which gives control to the recipient. Without the guard, a malicious recipient could call back into `claim`/`refund` before the state update commits. With the guard _and_ checks-effects-interactions ordering, double-spending is impossible even if the guard somehow failed.
- **No upgrade path.** The contract is not behind a proxy. Once deployed, it cannot be modified — which is the right tradeoff for a small, audited piece of logic. Real campaigns hold real ETH; upgrade machinery is itself an attack surface.

### Events

```solidity
event CampaignCreated(
  uint256 indexed id,
  address indexed creator,
  uint128 goal,
  uint64 deadline,
  string metadataURI
);
event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint128 newTotal);
event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
event Refunded(uint256 indexed id, address indexed backer, uint256 amount);
```

Every state change emits an event. Indexer subscribes to these. `id` and the relevant party are `indexed` so the frontend (and analytics) can filter cheaply.

`Pledged.newTotal` is included redundantly — the indexer could compute it by summing pledges, but emitting the post-state lets the indexer be stateless about totals (just upsert).

---

## 5. Backend API

`backend/`

### Stack

- Express + TypeScript
- Prisma ORM over SQLite
- ethers v6 for chain reads
- pino for logging, pino-http for request logs
- multer for upload parsing
- zod for input validation
- Jest + supertest for tests

### REST surface

| Method | Path             | Handler               | Purpose                                                                  |
| ------ | ---------------- | --------------------- | ------------------------------------------------------------------------ |
| GET    | `/health`        | `app.ts`              | Liveness probe; returns `{status, service, uptime}`                      |
| GET    | `/campaigns`     | `routes/campaigns.ts` | List from SQLite cache, ordered by id desc                               |
| GET    | `/campaigns/:id` | `routes/campaigns.ts` | Single campaign + pledge history. 404 if missing, 400 if id invalid      |
| POST   | `/uploads`       | `routes/uploads.ts`   | Accept image (5 MB cap, `image/*` only), pin or save to disk, return URL |
| GET    | `/files/<id>`    | `app.ts` static       | Serve files saved by `/uploads` (local-disk mode only)                   |

All routes pass through `pino-http` for structured access logs (each request gets a JSON line with method/path/status/timeMs).

### Object storage strategy

`src/lib/storage.ts` is a thin abstraction over two backends:

```typescript
async function storeImage(filename, mimeType, data): Promise<string> {
  if (config.pinataJwt) return pinFile(...);   // → ipfs://Qm...
  // Local fallback
  await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
  const id = crypto.randomUUID() + ext;
  await fs.writeFile(path.join(LOCAL_UPLOADS_DIR, id), data);
  return `${config.publicBaseUrl}/files/${id}`;
}
```

The contract just stores a string. From its perspective there's zero difference between an IPFS URI, a Pinata gateway URL, and a local-disk URL. This lets the dev environment work with no external services, while production can flip a single env var (`PINATA_JWT`) to use real IPFS pinning.

### Database schema

`backend/prisma/schema.prisma`:

```prisma
model Campaign {
  id          Int      @id        // matches on-chain id (uint256, fits in int for our scale)
  creator     String
  goal        String              // wei as decimal string (no precision loss)
  pledged     String   @default("0")
  deadline    Int
  claimed     Boolean  @default(false)
  metadataURI String
  pledges     Pledge[]
}

model Pledge {
  id          Int      @id @default(autoincrement())
  campaign    Campaign @relation(fields: [campaignId], references: [id])
  campaignId  Int
  backer      String
  amount      String
  txHash      String   @unique     // for upsert idempotency
  blockNumber Int
}

model IndexerCursor {
  id        Int @id @default(1)
  lastBlock Int @default(0)
}
```

Three notes:

- **wei as String.** `bigint` exceeds JavaScript's safe integer range; SQLite has no native bigint type. Storing as a decimal string is precision-safe and JSON-serialisable.
- **`Pledge.txHash @unique`.** Lets the indexer use `prisma.pledge.upsert({ where: { txHash } })`, making event re-application idempotent across restarts.
- **`IndexerCursor` is a singleton table.** Always row id 1. Stores how far the indexer has caught up so a restart resumes from the right block.

---

## 6. Event indexer

`backend/src/indexer/listener.ts`

The indexer is a co-located component in the backend process. It boots after the HTTP server starts and runs a poll loop until shutdown.

### Algorithm

```
on start:
  load contract address + ABI from contracts/deployments/<network>.json
  read IndexerCursor.lastBlock from SQLite (default = DEPLOY_BLOCK)
  this.fromBlock = cursor

  schedule tick() every POLL_INTERVAL_MS (1000 ms)

tick():
  head = await provider.getBlockNumber()
  if head <= this.fromBlock: return                          # nothing new

  events = await contract.queryFilter('*', this.fromBlock + 1, head)
  for ev in events:
    enqueue(() => handleEvent(ev))                            # serialised
  advanceCursor(head)
```

`enqueue` is a single-flight promise queue:

```typescript
private queue: Promise<unknown> = Promise.resolve();

private enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = this.queue.then(work);
  this.queue = next.catch(() => undefined);   // don't propagate failures
  return next;
}
```

Why a queue? Each event handler does its own DB writes. Without serialisation, `Pledged` could be applied before its parent `CampaignCreated` (they may arrive in the same tick), violating the foreign key. The queue forces strict in-order application and matches on-chain ordering.

### Why polling, not `contract.on()`

Earlier prototype used ethers v6's `contract.on('eventName', cb)` for live subscriptions. This silently broke on Hardhat with `TypeError: results is not iterable` from `FilterIdEventSubscriber._emitResults` — a known quirk where ethers's `eth_getFilterChanges` poller doesn't decode Hardhat's response. Events stopped flowing without errors.

Polling via `queryFilter` is what production indexers (The Graph, Ponder, Subsquid) use anyway: deterministic, debuggable, easy to reason about block ranges, easy to recover from gaps.

### Idempotency and recovery

- **Replay safety:** every write is an upsert (Campaign on `id`, Pledge on `txHash`). Re-applying the same event is a no-op.
- **Crash recovery:** the cursor is only advanced _after_ the events for a block range have been applied. A crash mid-block causes a re-application on next start — safe because of upserts.
- **Reorg handling:** intentionally absent. Hardhat doesn't reorg; Sepolia has finality in seconds. For a real product on a chain with longer reorg windows, you'd add a "confirmation depth" — e.g. only index blocks ≥ head − 5.

### Event handlers

| Event                                                       | Action                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CampaignCreated(id, creator, goal, deadline, metadataURI)` | `prisma.campaign.upsert({ where: { id }, create: {...}, update: {...} })`                                                         |
| `Pledged(id, backer, amount, newTotal)`                     | Transaction: `prisma.pledge.upsert({ where: { txHash } })` + `prisma.campaign.update({ data: { pledged: newTotal.toString() } })` |
| `Claimed(id, creator, amount)`                              | `prisma.campaign.update({ where: { id }, data: { claimed: true } })`                                                              |
| `Refunded(id, backer, amount)`                              | Logged but not persisted at row level — the live remaining balance is read directly from `pledgesOf` on chain.                    |

The `Refunded` choice is deliberate: storing remaining-balance per backer in SQLite would mean keeping two sources of truth in sync. Reading it from chain on the rare occasions we need it (Refund button visibility) keeps the system honest.

---

## 7. API gateway

`gateway/`

### Why a separate process

The gateway exists for separation of concerns. The backend wants to be focused on business logic (queries, indexing, IPFS pinning). Cross-cutting concerns — auth, rate limiting, CORS, structured access logging — live one layer up. Adding a second backend service later (analytics worker, webhook receiver) just means putting it behind the same gateway.

This is the API Gateway pattern from Week 4 of the syllabus: a single entry point with shared middleware in front of any number of internal services.

### Middleware stack (top to bottom)

```typescript
app.use(pinoHttp({ logger }))           // structured access logs
app.use(cors({ origin: FRONTEND_ORIGIN }))
app.use(rateLimit({ windowMs: 60_000, max: 60 }))   // per-IP

app.get('/health', ...)                 // local liveness (not proxied)

app.use('/uploads', siweAuth)           // SIWE only on the mutating endpoint

app.use('/', createProxyMiddleware({    // catchall — forward everything to backend
  target: BACKEND_URL,
  changeOrigin: true,
}))
```

### SIWE auth

`gateway/src/middleware/siweAuth.ts` implements the [Sign-In With Ethereum](https://eips.ethereum.org/EIPS/eip-4361) bearer pattern:

```
Authorization: SIWE <base64(message)>::<signature>
```

The middleware decodes the message, verifies the signature recovers to the message's `address`, attaches `req.siweAddress` to the request. No session — every request is independently verified.

Disabled by default (`REQUIRE_AUTH_ON_UPLOADS=false`) so local dev "just works". Flip the env var to require SIWE on `POST /uploads` in production.

### Rate limiting

Default: 60 req/min/IP across all paths. The wallet's RPC traffic doesn't go through the gateway (it goes directly to the chain RPC), so 60 req/min is plenty for the read-side.

For mainnet, you'd add per-route limits, distinguish by API key (if any), and emit metrics — but that's out of scope here.

### What the gateway does NOT do

- **It doesn't proxy signed transactions.** The frontend talks to MetaMask which talks to the chain RPC directly. The gateway never sees a signed tx, never holds keys, never makes value transfers.
- **It doesn't transform request bodies.** It's a transparent reverse proxy — bodies and headers pass through unchanged. Auth middleware appends `req.siweAddress` but that's a sidecar, not a transformation.

---

## 8. Frontend

`frontend/`

### Stack

- Next.js 14 App Router
- TypeScript strict mode
- Tailwind CSS (mobile-first)
- wagmi v2 + viem (typed contract reads/writes)
- RainbowKit (wallet UX)
- TanStack Query (under wagmi, used for cache/dedup)
- sonner (toast notifications)
- Vitest + jsdom (component-free unit tests)

### Routing

| Route             | File                          | Rendering             | Notes                                            |
| ----------------- | ----------------------------- | --------------------- | ------------------------------------------------ |
| `/`               | `app/page.tsx`                | SSR (`force-dynamic`) | Lists all campaigns from gateway                 |
| `/campaigns/[id]` | `app/campaigns/[id]/page.tsx` | SSR                   | Detail + history. Sidebar is a client component. |
| `/campaigns/new`  | `app/campaigns/new/page.tsx`  | Client                | Create form (needs wallet, file upload, tx)      |

`force-dynamic` on the SSR pages disables Next's Full Route Cache, so every navigation re-fetches the gateway. The fetches themselves use `cache: 'no-store'` (`lib/api.ts`) to also bypass Next's Data Cache. The gateway is local, so this isn't expensive — and it removes a class of "I just pledged but the page didn't update" bugs.

### Component structure

```
app/layout.tsx                        ← shared shell (header, providers)
  app/providers.tsx (client)          ← WagmiProvider + QueryClient + RainbowKitProvider + Toaster
    app/page.tsx (server)
      components/CampaignCard.tsx (server)
        components/CampaignImage.tsx (client)   ← onError → gradient fallback
    app/campaigns/[id]/page.tsx (server)
      components/CampaignImage.tsx (client)
      components/CampaignSidebar.tsx (client)   ← chain-time gate
        components/PledgeForm.tsx (client)      ← useWriteContract + auto-refresh
        components/CampaignActions.tsx (client) ← useReadContract(pledgesOf) + Claim/Refund
    app/campaigns/new/page.tsx (client)         ← form + uploadImage + writeContract
```

### Server vs client split

The app keeps as much as possible on the server:

- Layout, navigation, headers — server.
- Lists, detail pages, static text — server. SSR'd HTML loads fast and is SEO-indexable.

Anything wallet-aware lives in client components:

- Connect button (RainbowKit's `<ConnectButton>`)
- Sidebar (needs `useBlock` for chain time)
- Pledge form (needs `useWriteContract` + `useWaitForTransactionReceipt`)
- Campaign actions (needs `useReadContract` for `pledgesOf` + `useWriteContract`)
- Create form (needs `useAccount`, file upload, `useWriteContract`)

This split is enforced by Next.js: server components can't use React state or browser APIs; client components can't be `async` directly. The result is a clean line: anything reactive to user state crosses into `'use client'` files, anything else is server-rendered.

### wagmi hooks used

| Hook                           | Used in                                            | Why                                                                        |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `useAccount`                   | `PledgeForm`, `CampaignActions`, `NewCampaignPage` | "Is a wallet connected? Which one?"                                        |
| `useWriteContract`             | All write paths                                    | Sends a tx via the connected wallet                                        |
| `useWaitForTransactionReceipt` | All write paths                                    | Polls for confirmation, exposes `isLoading` / `isSuccess`                  |
| `useBlock({ watch: true })`    | `CampaignSidebar`                                  | Subscribes to new blocks, so chain time updates live                       |
| `useReadContract`              | `CampaignActions`                                  | Calls `pledgesOf(id, address)` via `eth_call`, refetches on each new block |

These hooks bring TanStack Query semantics: caching, deduplication, automatic refetching, request cancellation. We rarely think about them — wagmi handles it.

### Connector configuration

`frontend/lib/wagmi.ts` wires up `injectedWallet` only:

```typescript
const connectors = connectorsForWallets(
  [{ groupName: 'Browser wallet', wallets: [injectedWallet] }],
  { appName: 'DeFund', projectId: env.walletConnectProjectId || 'unused' },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http('http://127.0.0.1:8545'),
    [sepolia.id]: http(),
  },
  ssr: true,
});
```

Why injected-only? RainbowKit's default config includes WalletConnect, which requires a Cloud project ID and maintains a WebSocket relay. With a placeholder ID it errors loudly; with no ID it silently falls back. Stripping it down to `injectedWallet` (the `window.ethereum` provider) covers desktop MetaMask, Brave, Rabby, Coinbase Wallet — basically everyone running a browser extension.

If mobile-wallet QR-code flow is needed, get a free project ID from Reown and re-add `walletConnectWallet` / `metaMaskWallet`.

### Metadata envelope

Campaigns have title, description, and (optionally) an image. Rather than smearing those across multiple chain fields, we store one `metadataURI` string per campaign and convention an envelope:

```json
{
  "title": "Save the Turtles",
  "description": "Help us protect endangered sea turtles.",
  "image": "http://localhost:4000/files/abc123.png"
}
```

`buildMetadataURI()` and `parseMetadata()` in `lib/metadata.ts` handle the envelope. Three URI shapes are supported:

1. `data:application/json,<urlEncodedJson>` — small, no external dependency, default for local dev
2. `ipfs://Qm...` (a metadata JSON file) — what you'd use in production with Pinata
3. Plain image URL (legacy) — treated as an image-only campaign with no title/description

The frontend gracefully falls back: missing title → `Campaign #N`, missing image → deterministic neutral gradient placeholder (`<CampaignImage>`).

### Time handling and the hydration trap

Anything time-related is full of traps:

- `Date.prototype.toLocaleString()` with no arguments uses the runtime default locale, which differs between Node (server) and browser (client) → React hydration mismatch.
- `Date.now()` returns wall-clock time, but Hardhat's chain clock can be ahead (after `evm_increaseTime`) or behind (idle, frozen at last mined block).

`lib/format.ts:formatDeadline` pins to `'en-GB'` + UTC + explicit options for deterministic output:

```typescript
const DEADLINE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});
```

`CampaignSidebar` uses `max(realNow, chainNow)` for "is this campaign expired?" — so EITHER clock can drive expiration:

```typescript
const realNow = Math.floor(Date.now() / 1000);
const chainNow = latestBlock ? Number(latestBlock.timestamp) : realNow;
const effectiveNow = Math.max(realNow, chainNow);
const expired = effectiveNow >= campaign.deadline;
```

This handles all combinations: production where chain time is reliable; Hardhat fast-forwarded ahead of real time; Hardhat sitting idle behind real time.

### Auto-refresh after a write

`PledgeForm` and `CampaignActions` both wire up:

```typescript
useEffect(() => {
  if (!isSuccess) return;
  const id = setTimeout(() => router.refresh(), 1500);
  return () => clearTimeout(id);
}, [isSuccess, router]);
```

When a tx confirms, after a 1.5 s grace period (so the indexer's 1-second poll can have caught up), `router.refresh()` re-runs the SSR pages while preserving client state. The user sees the new totals without lifting a finger.

---

## 9. Data flow walkthroughs

### 9.1 Create campaign with image

```
1. User in /campaigns/new fills form, picks image.
2. Submit handler:
   a. POST /uploads (image)  ──gateway──▶  backend storeImage()
                                              ├─ if PINATA_JWT: pinFile()  →  "ipfs://Qm..."
                                              └─ else: write to backend/uploads/<id>.png
                                                         return "http://localhost:4000/files/<id>"
   b. buildMetadataURI({ title, description, image })
      → "data:application/json,%7B%22title%22%3A%22…%22%7D"
   c. wagmi.useWriteContract({ functionName: 'createCampaign', args: [goal, deadline, uri] })
3. MetaMask popup → user signs → tx broadcast
4. Tx mined; Hardhat emits CampaignCreated(id, creator, goal, deadline, uri)
5. Backend indexer's next tick (within 1 s):
   - queryFilter('*', cursor+1, head) returns the event
   - enqueue(handleEvent) → onCampaignCreated → prisma.campaign.upsert
   - cursor advances to head
6. useWaitForTransactionReceipt resolves on the frontend → router.push('/')
7. Home page SSR fetches gateway → backend → SQLite → new campaign in list
```

### 9.2 Pledge

```
1. User opens /campaigns/0, types "0.1", clicks Pledge.
2. wagmi.useWriteContract({ functionName: 'pledge', args: [0n], value: parseEther('0.1') })
3. MetaMask → user signs → tx broadcast
4. Contract validates (id valid, before deadline, value > 0):
   - c.pledged += 0.1 ETH
   - pledgesOf[0][user] += 0.1 ETH
   - emit Pledged(0, user, 0.1 ETH, newTotal)
   (or reverts with custom error)
5. useWaitForTransactionReceipt resolves
6. PledgeForm useEffect triggers router.refresh() after 1.5s
7. Indexer (in parallel) picks up Pledged:
   - prisma.$transaction([
       prisma.pledge.upsert({ where: { txHash }, create: {...} }),
       prisma.campaign.update({ where: { id }, data: { pledged: newTotal } }),
     ])
8. router.refresh re-runs SSR; getCampaign(0) sees the new pledged total.
```

### 9.3 Claim (creator path)

```
Preconditions checked client-side by CampaignSidebar (chain time past deadline,
goal met, user is creator, !claimed) — but the contract enforces them anyway.

1. User (creator) clicks Claim funds.
2. wagmi.useWriteContract({ functionName: 'claim', args: [0n] })
3. Contract:
   - guard checks (NotCreator / CampaignActive / GoalNotMet / AlreadyClaimed)
   - c.claimed = true                              ← effect before interaction
   - amount = c.pledged
   - payable(creator).call{value: amount}('')      ← the actual transfer
   - emit Claimed(0, creator, amount)
4. Tx confirmed; indexer marks claimed=true on next tick.
5. router.refresh(); UI shows "Ended Claimed".
```

The contract holds zero ETH for this campaign after claim. Other campaigns' funds are unaffected — the contract only zeroed `c.pledged` would-be exposure for #0.

### 9.4 Refund

```
Preconditions: chain time past deadline, goal NOT met, user has pledgesOf[id][user] > 0.
The Refund button is gated on the live `pledgesOf` read (useReadContract with watch:true).

1. User clicks Refund.
2. wagmi.useWriteContract({ functionName: 'refund', args: [0n] })
3. Contract:
   - guard checks (CampaignActive / GoalMet / NoPledge)
   - amount = pledgesOf[0][user]
   - pledgesOf[0][user] = 0                        ← effect before interaction
   - payable(user).call{value: amount}('')
   - emit Refunded(0, user, amount)
4. Tx confirmed.
5. CampaignActions refetches `pledgesOf` (returns 0) → Refund button hides.
6. router.refresh() — page now shows "No pledge to refund on this campaign."
```

The historical pledge entries remain in the SQLite cache — they happened, they're permanent record. Only the live "what is currently owed back to me" derives from chain.

---

## 10. Cross-cutting concerns

### 10.1 Eventual consistency

The chain and SQLite are two replicas. The indexer reconciles them at 1-second tick. Worst-case staleness: tx confirmation time (~1 block) + 1 s indexer tick + 0 s SSR fetch = ~2 s.

The frontend handles staleness in three ways:

- **Auto-refresh after writes.** `router.refresh()` 1.5 s after `isSuccess`. Long enough for the indexer to have caught up.
- **Live chain reads for action gating.** Refund button uses `useReadContract` with `watch: true` — refetches on every new block.
- **No SSR fetch cache.** `cache: 'no-store'` means each render hits the gateway. Cheap (local), eliminates a confusing class of bugs.

### 10.2 Error handling

- **Contract reverts** → typed custom errors (`InvalidGoal`, `CampaignEnded`, etc.). The frontend currently surfaces them via toast. With `useSimulateContract` (planned) the buttons could be disabled before they're clicked, with the human-readable revert reason shown.
- **Indexer failures** → caught per-event, logged via pino, cursor not advanced. Next tick retries.
- **Backend exceptions** → Express error handler returns 500 with safe message. Logged with full stack.
- **Gateway 5xx** → frontend shows "could not load campaigns from API gateway: …" inline.

### 10.3 Logging

Every layer emits pino-formatted JSON in production, pretty-printed in dev (via `pino-pretty`). Each request gets a unique id. Indexer events log `{ count, fromBlock, toBlock }` per tick — making it easy to grep "did event X get indexed?".

### 10.4 Configuration

All config via env vars, loaded in one place per workspace (`backend/src/config.ts`, `gateway/src/config.ts`, `frontend/lib/env.ts`). No env reads scattered across files. All values typed.

`.env.example` files are committed; `.env` / `.env.local` files are git-ignored.

---

## 11. Testing strategy

44 tests across 4 workspaces.

| Layer    | Framework              | Specs | What they cover                                                                                                                                                                                                                                  |
| -------- | ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract | Hardhat + Mocha + Chai | 18    | Every state transition + every revert: happy path, missed-goal refund, double-claim revert, reentrancy guard, multi-campaign isolation. 100% statement / function / line coverage; 85% branch (the uncovered branches are reentrancy internals). |
| Backend  | Jest + supertest       | 12    | REST endpoints (list, detail 200/404/400, upload 200/400), indexer event handlers (CampaignCreated upsert, Pledged with FK, Claimed flag, idempotency on duplicate Pledged). Uses a real SQLite file (no mocks).                                 |
| Gateway  | Jest + supertest       | 4     | Health endpoint not proxied, GET proxies pass through, parameterised routes, SIWE auth blocks unauthenticated /uploads. Uses a stub upstream (Express on a random port).                                                                         |
| Frontend | Vitest + jsdom         | 18    | `formatWei`, `formatDeadline` (deterministic), `progressPercent`, `shortAddr`, `isExpired`, `parseMetadata` (data URI / image-only / malformed), `buildMetadataURI` round-trip.                                                                  |

CI runs all four suites + lint + format check on every push/PR (`.github/workflows/ci.yml`).

Pre-commit: Husky + lint-staged auto-format staged files.

What's _not_ tested:

- E2E browser flow with a real wallet — would need Playwright + a wallet test harness. Out of scope for the coursework.
- Indexer against a real (running) Hardhat node — covered manually in the demo script. Adding a Hardhat-spawning integration test is feasible but slow.
- Long Sepolia replays — manual smoke test on deploy.

---

## 12. Operational concerns

### Deployment shapes

For the coursework: local Hardhat + local services. Demo flow is `npm test` + show the home page.

For a hypothetical staging environment:

- **Contract:** Sepolia, verified via Etherscan.
- **Backend + indexer:** containerised Node 20 image, Postgres replacement for SQLite (single-line Prisma datasource swap), one replica is enough; horizontal scaling would split indexer into a separate worker.
- **Gateway:** containerised Node 20 image; can run multiple replicas behind any load balancer.
- **Frontend:** Vercel (static export not possible due to SSR; Edge Functions or Node serverless work).
- **Object storage:** Pinata for IPFS pinning (set `PINATA_JWT`, drop the `/files` static route).

### Failure modes and recovery

| Failure           | Detection                       | Recovery                                                                                 |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| RPC endpoint down | Indexer tick errors             | Backend keeps retrying (1 s loop). REST stays up; users see stale-but-live data.         |
| Backend crash     | Health check fails              | Restart. Indexer resumes from `IndexerCursor.lastBlock`.                                 |
| Gateway crash     | Same                            | Restart. No state held.                                                                  |
| SQLite corruption | Prisma errors                   | `rm dev.db`; `prisma db push`; backend restart triggers full replay from `DEPLOY_BLOCK`. |
| Frontend wedged   | Browser-side                    | User refreshes. SSR re-runs.                                                             |
| Chain reorg       | Indexer would re-process blocks | Upserts make this safe. For deeper reorgs you'd add confirmation depth.                  |

### Observability

Pino structured logs are the primary signal. For real production:

- Ship logs to a central store (Loki / Elasticsearch / CloudWatch).
- Add metrics: `pledged_total{campaign_id}`, `indexer_lag_blocks`, `requests_total{route,status}`. Prometheus-compatible exporter is a small addition.
- Add a Grafana dashboard with chain-head, indexer-cursor, lag, and request volumes.

---

## 13. Tradeoffs and alternatives considered

### Polling vs WebSocket subscription for the indexer

- **Chosen:** poll loop with `queryFilter`.
- **Alternative:** ethers' `contract.on()` (filter-based subscription).
- **Why polling won:** Hardhat compatibility (the filter-based path was silently broken — `TypeError: results is not iterable`). Polling is also explicit, debuggable, easier to reason about block ranges, and is what production indexers do anyway.
- **Cost:** ~1 RPC request/second of idle traffic. Negligible for Hardhat; for Sepolia/mainnet, would batch into longer ranges.

### SQLite vs Postgres

- **Chosen:** SQLite via Prisma.
- **Alternative:** Postgres via Prisma (one-line datasource change).
- **Why SQLite won:** Zero install for graders/reviewers. Single-file backups. Adequate for the scale of a coursework demo (and a real product up to ~10k campaigns).
- **When to switch:** any deployment with multiple backend replicas, or scale beyond ~100 writes/second.

### Local file storage vs IPFS

- **Chosen:** Local disk + `/files/<id>` route by default; Pinata IPFS if `PINATA_JWT` is set.
- **Alternative:** IPFS-only (require Pinata).
- **Why local won:** Demos should work offline. The contract just stores a URL — it doesn't care which kind. Switching to Pinata is a one-line env change.
- **Production reality:** For real persistence and decentralised access, IPFS is the right answer; local disk is for dev only.

### `useReadContract` vs SQLite for refundable balance

- **Chosen:** `useReadContract({ functionName: 'pledgesOf' })` — read live from chain.
- **Alternative:** Track a `Pledge.refunded` flag in SQLite; sum unrefunded amounts.
- **Why the chain won:** Single source of truth. SQLite would have to be perfectly in sync with the chain at all times, which is not a property the indexer guarantees (it's eventually consistent). Reading from chain costs one cheap `eth_call` per render; the safety is worth it.

### Polling interval at 1 s

- 100 ms would feel snappier but burn 10× the RPC volume.
- 5 s would feel sluggish (auto-refresh after a tx would visibly lag).
- 1 s is the sweet spot: well below human perception, matches typical Ethereum block time on Sepolia, low RPC cost.

### Cache: no-store on SSR fetches

- **Chosen:** every SSR render hits the gateway.
- **Alternative:** `revalidate: 5` (Next.js Data Cache) — original design.
- **Why no-store won:** the gateway is local (zero cost), and the cache caused "I just pledged, why don't I see it?" UX bugs.
- **Production reality:** for a remote gateway with real latency, you'd want something — either a 2-second revalidate or a real CDN. For now, no-store + no SSR cache is the right call.

### Single-process backend

- **Chosen:** REST + indexer + static file server in one Node process.
- **Alternative:** Three processes — REST API, indexer worker, file server.
- **Why one process won:** simpler deployment, simpler local dev, single source of logs, no inter-service contracts to maintain.
- **When to split:** if the indexer becomes CPU-heavy (large reorg replays) and starts impacting REST latency.

---

## 14. Future work

In rough priority order:

1. **`useSimulateContract` preflight.** Eliminate the "21000000 gas / 16777216 cap" UX wart by simulating writes client-side and disabling buttons that would revert, with the real revert reason in a tooltip.
2. **Postgres + separate indexer worker.** Even for a single deployment, separating concerns is cheap and a step toward horizontal scale.
3. **Multi-chain support.** Frontend can already switch chains; backend is single-chain-per-process. Extend `CHAIN_NETWORK` to a list and have the indexer subscribe to multiple deployments.
4. **`MyPledges` page.** Aggregates `pledgesOf[*][address]` across campaigns. Trivial with chain reads.
5. **NFT receipts.** Mint an ERC-721 to backers as they pledge (proof-of-backing). Extends the contract; minor.
6. **Gas refunds for refund.** Ethereum's gas refund for storage zeroing means refunds are cheaper than they look. Worth measuring and showing in the report.
7. **Capacitor mobile wrapper.** Same Next.js bundle, packaged as iOS/Android app. ~2 hours of work.
8. **Admin / analytics.** Per-campaign dashboard (CTR, time-to-funded, refund rate). Pure off-chain — just SQL queries on the cache.
9. **Reorg-safe confirmation depth.** Configure the indexer to lag head by N blocks (e.g. 5 on Sepolia, 12 on mainnet). Trades freshness for safety on long reorgs.
10. **Permit-style metadata signing.** Lets a creator update title/description without a new tx by signing an off-chain message verified at read time. Saves gas, reintroduces some on-chain state ambiguity — interesting tradeoff.

---

## Appendix: file map by responsibility

| Concern             | Files                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract definition | `contracts/contracts/Crowdfunding.sol`                                                                                                          |
| Contract tests      | `contracts/test/Crowdfunding.test.ts`                                                                                                           |
| Deployment          | `contracts/scripts/deploy.ts`, `verify.ts`, `seed.ts`, `hardhat.config.ts`                                                                      |
| Backend bootstrap   | `backend/src/index.ts`, `app.ts`, `config.ts`, `logger.ts`                                                                                      |
| REST routes         | `backend/src/routes/campaigns.ts`, `routes/uploads.ts`                                                                                          |
| Storage             | `backend/src/lib/storage.ts`, `lib/pinata.ts`                                                                                                   |
| Indexer             | `backend/src/indexer/listener.ts`                                                                                                               |
| Database            | `backend/prisma/schema.prisma`, `src/db/prisma.ts`                                                                                              |
| Backend tests       | `backend/tests/campaigns.test.ts`, `tests/indexer.test.ts`                                                                                      |
| Gateway             | `gateway/src/index.ts`, `app.ts`, `middleware/siweAuth.ts`                                                                                      |
| Gateway tests       | `gateway/tests/gateway.test.ts`                                                                                                                 |
| Frontend bootstrap  | `frontend/app/layout.tsx`, `app/providers.tsx`                                                                                                  |
| Pages               | `frontend/app/page.tsx`, `app/campaigns/[id]/page.tsx`, `app/campaigns/new/page.tsx`                                                            |
| Components          | `frontend/components/CampaignCard.tsx`, `CampaignImage.tsx`, `CampaignSidebar.tsx`, `PledgeForm.tsx`, `CampaignActions.tsx`, `WalletButton.tsx` |
| Frontend libs       | `frontend/lib/wagmi.ts`, `contract.ts`, `api.ts`, `metadata.ts`, `format.ts`, `env.ts`                                                          |
| Frontend tests      | `frontend/lib/format.test.ts`, `lib/metadata.test.ts`                                                                                           |
| CI / quality        | `.github/workflows/ci.yml`, `.husky/pre-commit`, `.eslintrc*`, `.prettierrc.json`, `.prettierignore`, `.solhint.json`                           |
