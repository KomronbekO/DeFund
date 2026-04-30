# Architecture

## System overview

```mermaid
flowchart LR
    User((User<br/>Browser + MetaMask)) -->|HTTPS| FE[Next.js 14<br/>App Router · SSR<br/>wagmi + RainbowKit]
    FE -->|REST| GW[Gateway :4000<br/>Express · pino · rate-limit · SIWE]
    GW -->|Internal HTTP| BE[Backend :4001<br/>Express · TypeScript]
    BE -->|Prisma| DB[(SQLite<br/>campaign cache)]
    BE -->|ethers v6 events| Chain[(Sepolia<br/>Crowdfunding.sol)]
    FE -.->|wallet RPC| Chain
    BE -->|HTTP API| IPFS[(Pinata · IPFS)]
    Chain -.->|emits events| BE

    classDef chain fill:#fff7ed,stroke:#ea580c,color:#9a3412
    classDef web fill:#eff6ff,stroke:#2563eb,color:#1e3a8a
    class Chain chain
    class FE,GW,BE,IPFS,DB web
```

The contract is the source of truth. The backend mirrors on-chain state into SQLite via an event indexer so the frontend can render lists and detail pages from a fast cache (server-side, with `revalidate: 5`). Writes always go through the user's wallet directly to the contract — the backend never holds a private key.

## Why a separate API gateway?

A separate gateway service lets us keep the backend focused on business logic and the database, while cross-cutting concerns — request logging, rate limiting, CORS, and SIWE-based authentication for the upload endpoint — live in one place. This mirrors the API Gateway pattern taught in week 4.

## Why SSR?

Campaign list and detail pages are rendered server-side via Next.js App Router (`force-dynamic`, fetched through the gateway). This satisfies the JAM stack + SSR topic from week 6 and gives the frontend a fast first paint without exposing the backend directly to the public internet.

## Eventual consistency

The indexer is an instance of the read-side projection pattern: events emitted on chain are streamed into a local SQLite cache, eventually consistent with the chain. If the backend is restarted, it resumes from a stored cursor (`IndexerCursor.lastBlock`) and replays missed events.
