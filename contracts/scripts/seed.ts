import { ethers, network } from 'hardhat';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const file = path.resolve(__dirname, '..', 'deployments', `${network.name}.json`);
  const { address, abi } = JSON.parse(await fs.readFile(file, 'utf8'));
  const [creator, alice] = await ethers.getSigners();
  const c = new ethers.Contract(address, abi, creator);

  const goal = ethers.parseEther('1');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  // Use a data URI for the metadata so we don't depend on a real IPFS pin during local dev.
  const metadata = JSON.stringify({
    title: 'Save the Turtles',
    description: 'A demo campaign seeded by scripts/seed.ts.',
  });
  const metadataURI = `data:application/json,${encodeURIComponent(metadata)}`;
  const tx = await c.createCampaign(goal, deadline, metadataURI);
  const receipt = await tx.wait();
  console.log(`createCampaign tx ${receipt?.hash} in block ${receipt?.blockNumber}`);

  const pledgeTx = await c.connect(alice).pledge(0, { value: ethers.parseEther('0.25') });
  const pr = await pledgeTx.wait();
  console.log(`pledge tx ${pr?.hash} in block ${pr?.blockNumber}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
