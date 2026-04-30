import { ethers, network } from 'hardhat';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying Crowdfunding to ${network.name} from ${deployer.address}`);

  const Factory = await ethers.getContractFactory('Crowdfunding');
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const deployBlock = receipt?.blockNumber;

  console.log(`Crowdfunding deployed at ${address}`);
  if (deployBlock !== undefined) console.log(`Deploy block: ${deployBlock}`);

  const artifactPath = path.resolve(
    __dirname,
    '..',
    'artifacts',
    'contracts',
    'Crowdfunding.sol',
    'Crowdfunding.json',
  );
  const { abi } = JSON.parse(await fs.readFile(artifactPath, 'utf8')) as { abi: unknown };

  const outDir = path.resolve(__dirname, '..', 'deployments');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  await fs.writeFile(
    outFile,
    JSON.stringify({ network: network.name, address, deployBlock, abi }, null, 2),
  );
  console.log(`Deployment metadata written to ${outFile}`);

  console.log('\nAdd to backend/.env and frontend/.env.local:');
  console.log(`CONTRACT_ADDRESS=${address}`);
  if (deployBlock !== undefined) console.log(`DEPLOY_BLOCK=${deployBlock}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
