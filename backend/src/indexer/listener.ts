import { ethers } from 'ethers';
import { prisma } from '../db/prisma';
import { logger } from '../logger';
import { config, loadDeployment } from '../config';

interface CampaignCreatedArgs {
  id: bigint;
  creator: string;
  goal: bigint;
  deadline: bigint;
  metadataURI: string;
}

interface PledgedArgs {
  id: bigint;
  backer: string;
  amount: bigint;
  newTotal: bigint;
}

const POLL_INTERVAL_MS = 1_000;

export class Indexer {
  private provider: ethers.JsonRpcProvider;
  private contract!: ethers.Contract;
  private fromBlock = 0;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  // Single-flight queue so events are processed strictly in arrival order.
  // Without this, listeners for CampaignCreated and Pledged race and the
  // pledge FK can be inserted before its parent campaign row.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Boot the indexer: loads deployment, replays history, then starts polling. */
  async start(): Promise<void> {
    const deployment = await loadDeployment();
    const address = config.contractAddress || deployment?.address;
    const abi = deployment?.abi;
    if (!address || !abi) {
      throw new Error(
        'No contract deployment found. Run `npm --workspace contracts run deploy:local` first.',
      );
    }
    this.contract = new ethers.Contract(address, abi as ethers.InterfaceAbi, this.provider);

    const cursor = await prisma.indexerCursor.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, lastBlock: deployment?.deployBlock ?? config.deployBlock ?? 0 },
    });
    this.fromBlock = cursor.lastBlock;

    logger.info({ address, fromBlock: this.fromBlock }, 'indexer starting');

    await this.tick(); // catch up history immediately
    this.pollTimer = setInterval(() => {
      this.tick().catch((err) => logger.error({ err }, 'indexer tick failed'));
    }, POLL_INTERVAL_MS);
    this.running = true;
    logger.info({ pollIntervalMs: POLL_INTERVAL_MS }, 'indexer polling');
  }

  /** Stop the poll loop. Used by tests and graceful shutdown. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
  }

  /**
   * One poll iteration: fetch any new events past our cursor and apply them.
   * Idempotent — pledges are keyed on tx hash and writes upsert.
   */
  private async tick(): Promise<void> {
    const head = await this.provider.getBlockNumber();
    if (head <= this.fromBlock) return;

    const events = await this.contract.queryFilter('*', this.fromBlock + 1, head);
    if (events.length > 0) {
      logger.info(
        { count: events.length, fromBlock: this.fromBlock + 1, toBlock: head },
        'indexing new events',
      );
    }
    for (const ev of events) {
      if ('args' in ev) {
        await this.enqueue(() => this.handleEvent(ev as ethers.EventLog));
      }
    }
    await this.advanceCursor(head);
  }

  private async advanceCursor(block: number): Promise<void> {
    if (block <= this.fromBlock) return;
    this.fromBlock = block;
    await prisma.indexerCursor.update({ where: { id: 1 }, data: { lastBlock: block } });
  }

  /** Public for tests — apply a single event log to the database. */
  async handleEvent(ev: ethers.EventLog): Promise<void> {
    const name = ev.fragment?.name ?? (ev as unknown as { eventName?: string }).eventName;
    try {
      switch (name) {
        case 'CampaignCreated':
          await this.onCampaignCreated(ev);
          break;
        case 'Pledged':
          await this.onPledged(ev);
          break;
        case 'Claimed':
          await this.onClaimed(ev);
          break;
        case 'Refunded':
          await this.onRefunded(ev);
          break;
      }
    } catch (err) {
      logger.error({ err, name, tx: ev.transactionHash }, 'failed to index event');
    }
  }

  private async onCampaignCreated(ev: ethers.EventLog): Promise<void> {
    const a = ev.args as unknown as CampaignCreatedArgs;
    await prisma.campaign.upsert({
      where: { id: Number(a.id) },
      update: {
        creator: a.creator,
        goal: a.goal.toString(),
        deadline: Number(a.deadline),
        metadataURI: a.metadataURI,
      },
      create: {
        id: Number(a.id),
        creator: a.creator,
        goal: a.goal.toString(),
        pledged: '0',
        deadline: Number(a.deadline),
        metadataURI: a.metadataURI,
      },
    });
  }

  private async onPledged(ev: ethers.EventLog): Promise<void> {
    const a = ev.args as unknown as PledgedArgs;
    const id = Number(a.id);
    await prisma.$transaction([
      prisma.pledge.upsert({
        where: { txHash: ev.transactionHash },
        update: {},
        create: {
          campaignId: id,
          backer: a.backer,
          amount: a.amount.toString(),
          txHash: ev.transactionHash,
          blockNumber: ev.blockNumber,
        },
      }),
      prisma.campaign.update({
        where: { id },
        data: { pledged: a.newTotal.toString() },
      }),
    ]);
  }

  private async onClaimed(ev: ethers.EventLog): Promise<void> {
    const args = ev.args as unknown as { id: bigint };
    await prisma.campaign.update({
      where: { id: Number(args.id) },
      data: { claimed: true },
    });
  }

  private async onRefunded(ev: ethers.EventLog): Promise<void> {
    // Refunds don't change campaign-level totals (totals reflect pre-deadline pledges),
    // but for a real product we'd track them separately. Keep a minimal log for now.
    logger.info(
      { id: (ev.args as unknown as { id: bigint }).id.toString(), tx: ev.transactionHash },
      'refund indexed',
    );
  }

  isRunning(): boolean {
    return this.running;
  }
}
