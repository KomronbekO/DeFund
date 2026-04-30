import { network, run } from 'hardhat';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const file = path.resolve(__dirname, '..', 'deployments', `${network.name}.json`);
  const { address } = JSON.parse(await fs.readFile(file, 'utf8')) as { address: string };

  console.log(`Verifying ${address} on ${network.name}...`);
  await run('verify:verify', { address, constructorArguments: [] });
  console.log('Verified.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
