# BPMN — Pledge flow

The diagram below captures the end-to-end "Pledge ETH on a campaign" workflow across the three actors of the system: the **Backer** (wallet user), the **Frontend + Gateway + Backend** (off-chain hybrid services), and the **Crowdfunding contract** on Sepolia. It is rendered as a Mermaid flowchart as a textual approximation of BPMN; for the final coursework report, it is also redrawn as a proper BPMN 2.0 collaboration diagram in Visual Paradigm and exported to `docs/bpmn-pledge-flow.png`.

```mermaid
flowchart TD
    subgraph Backer["Backer (Browser + MetaMask)"]
        B1([Open campaign page]) --> B2[Enter pledge amount]
        B2 --> B3{{Click 'Pledge'}}
        B3 --> B4[Sign transaction in MetaMask]
        B11[See updated total] --> B12([End])
    end

    subgraph OffChain["Off-chain services"]
        F1[Frontend: useWriteContract<br/>builds tx via viem]
        F2[Gateway forwards SSR fetches<br/>and IPFS uploads]
        I1[Backend indexer<br/>subscribed to events]
        I2[Upsert pledge row +<br/>update campaign.pledged]
        S1[SSR re-fetches /campaigns/:id<br/>via gateway after revalidation]
    end

    subgraph Chain["Crowdfunding.sol on Sepolia"]
        C1{{Receive pledge tx}}
        C2{Validate:<br/>id valid AND<br/>before deadline AND<br/>msg.value > 0}
        C3[Update pledged + pledgesOf]
        C4[Emit Pledged event]
        C5([Tx mined in block N])
        C6([Revert with custom error])
    end

    B3 --> F1
    F1 --> B4
    B4 --> C1
    C1 --> C2
    C2 -- yes --> C3 --> C4 --> C5
    C2 -- no --> C6
    C5 --> I1
    I1 --> I2
    B11 -.-> S1
    S1 -.-> F2
    F2 -.-> I2

    classDef on fill:#fff7ed,stroke:#ea580c,color:#9a3412
    classDef off fill:#eff6ff,stroke:#2563eb,color:#1e3a8a
    classDef act fill:#f0fdf4,stroke:#16a34a,color:#14532d
    class C1,C2,C3,C4,C5,C6 on
    class F1,F2,I1,I2,S1 off
    class B1,B2,B3,B4,B11,B12 act
```

## Notes

- The wallet (MetaMask) signs and broadcasts the transaction directly to the chain — neither the gateway nor the backend ever sees the user's private key.
- The contract enforces invariants synchronously: invalid pledges revert with a custom error and never advance state.
- The backend indexer is **out-of-band** with the user's transaction. The user sees the on-chain confirmation immediately via wagmi's `useWaitForTransactionReceipt`; the SSR cache catches up within seconds via the indexer + Next.js `revalidate: 5`.
- Refund and Claim flows are structurally similar — only the contract guard conditions differ (deadline reached + goal met for Claim; deadline reached + goal not met for Refund).
