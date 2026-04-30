import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import type { Crowdfunding } from '../typechain-types';

const ONE_ETH = ethers.parseEther('1');
const HALF_ETH = ethers.parseEther('0.5');

async function deploy(): Promise<{
  contract: Crowdfunding;
  creator: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  alice: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  bob: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  deadline: number;
}> {
  const [creator, alice, bob] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('Crowdfunding', creator);
  const contract = (await Factory.deploy()) as unknown as Crowdfunding;
  await contract.waitForDeployment();

  const now = await time.latest();
  const deadline = now + 60 * 60; // +1h
  return { contract, creator, alice, bob, deadline };
}

describe('Crowdfunding', () => {
  describe('createCampaign', () => {
    it('creates with valid params and emits CampaignCreated', async () => {
      const { contract, creator, deadline } = await deploy();
      await expect(contract.createCampaign(ONE_ETH, deadline, 'ipfs://QmFoo'))
        .to.emit(contract, 'CampaignCreated')
        .withArgs(0n, creator.address, ONE_ETH, deadline, 'ipfs://QmFoo');

      expect(await contract.campaignCount()).to.equal(1n);
      const c = await contract.getCampaign(0);
      expect(c.creator).to.equal(creator.address);
      expect(c.goal).to.equal(ONE_ETH);
      expect(c.pledged).to.equal(0n);
      expect(c.claimed).to.equal(false);
      expect(c.metadataURI).to.equal('ipfs://QmFoo');
    });

    it('reverts on zero goal', async () => {
      const { contract, deadline } = await deploy();
      await expect(contract.createCampaign(0n, deadline, 'x')).to.be.revertedWithCustomError(
        contract,
        'InvalidGoal',
      );
    });

    it('reverts on past deadline', async () => {
      const { contract } = await deploy();
      const past = (await time.latest()) - 1;
      await expect(contract.createCampaign(ONE_ETH, past, 'x')).to.be.revertedWithCustomError(
        contract,
        'InvalidDeadline',
      );
    });
  });

  describe('pledge', () => {
    it('accepts pledges and tracks pledgesOf', async () => {
      const { contract, alice, bob, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');

      await expect(contract.connect(alice).pledge(0, { value: HALF_ETH }))
        .to.emit(contract, 'Pledged')
        .withArgs(0n, alice.address, HALF_ETH, HALF_ETH);

      await contract.connect(bob).pledge(0, { value: HALF_ETH });

      expect(await contract.pledgesOf(0, alice.address)).to.equal(HALF_ETH);
      expect(await contract.pledgesOf(0, bob.address)).to.equal(HALF_ETH);
      const c = await contract.getCampaign(0);
      expect(c.pledged).to.equal(ONE_ETH);
    });

    it('reverts on zero value', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await expect(contract.connect(alice).pledge(0, { value: 0n })).to.be.revertedWithCustomError(
        contract,
        'ZeroPledge',
      );
    });

    it('reverts after deadline', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await time.increaseTo(deadline + 1);
      await expect(
        contract.connect(alice).pledge(0, { value: HALF_ETH }),
      ).to.be.revertedWithCustomError(contract, 'CampaignEnded');
    });

    it('reverts on unknown id', async () => {
      const { contract, alice } = await deploy();
      await expect(
        contract.connect(alice).pledge(99, { value: HALF_ETH }),
      ).to.be.revertedWithCustomError(contract, 'CampaignNotFound');
    });
  });

  describe('claim', () => {
    it('creator claims when goal met after deadline', async () => {
      const { contract, creator, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      const before = await ethers.provider.getBalance(creator.address);
      const tx = await contract.connect(creator).claim(0);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const after = await ethers.provider.getBalance(creator.address);

      expect(after - before + gas).to.equal(ONE_ETH);
      const c = await contract.getCampaign(0);
      expect(c.claimed).to.equal(true);
    });

    it('reverts if not creator', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: ONE_ETH });
      await time.increaseTo(deadline + 1);
      await expect(contract.connect(alice).claim(0)).to.be.revertedWithCustomError(
        contract,
        'NotCreator',
      );
    });

    it('reverts before deadline', async () => {
      const { contract, creator, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: ONE_ETH });
      await expect(contract.connect(creator).claim(0)).to.be.revertedWithCustomError(
        contract,
        'CampaignActive',
      );
    });

    it('reverts if goal not met', async () => {
      const { contract, creator, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await time.increaseTo(deadline + 1);
      await expect(contract.connect(creator).claim(0)).to.be.revertedWithCustomError(
        contract,
        'GoalNotMet',
      );
    });

    it('reverts on double claim', async () => {
      const { contract, creator, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: ONE_ETH });
      await time.increaseTo(deadline + 1);
      await contract.connect(creator).claim(0);
      await expect(contract.connect(creator).claim(0)).to.be.revertedWithCustomError(
        contract,
        'AlreadyClaimed',
      );
    });
  });

  describe('refund', () => {
    it('backer refunds when goal missed', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await time.increaseTo(deadline + 1);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await contract.connect(alice).refund(0);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gas).to.equal(HALF_ETH);
      expect(await contract.pledgesOf(0, alice.address)).to.equal(0n);
    });

    it('reverts if goal met', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: ONE_ETH });
      await time.increaseTo(deadline + 1);
      await expect(contract.connect(alice).refund(0)).to.be.revertedWithCustomError(
        contract,
        'GoalMet',
      );
    });

    it('reverts before deadline', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await expect(contract.connect(alice).refund(0)).to.be.revertedWithCustomError(
        contract,
        'CampaignActive',
      );
    });

    it('reverts if backer never pledged', async () => {
      const { contract, bob, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await time.increaseTo(deadline + 1);
      await expect(contract.connect(bob).refund(0)).to.be.revertedWithCustomError(
        contract,
        'NoPledge',
      );
    });

    it('cannot refund twice', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'x');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await time.increaseTo(deadline + 1);
      await contract.connect(alice).refund(0);
      await expect(contract.connect(alice).refund(0)).to.be.revertedWithCustomError(
        contract,
        'NoPledge',
      );
    });
  });

  describe('multi-campaign isolation', () => {
    it('keeps state separate across campaigns', async () => {
      const { contract, alice, deadline } = await deploy();
      await contract.createCampaign(ONE_ETH, deadline, 'a');
      await contract.createCampaign(ethers.parseEther('2'), deadline, 'b');
      await contract.connect(alice).pledge(0, { value: HALF_ETH });
      await contract.connect(alice).pledge(1, { value: HALF_ETH });

      expect(await contract.pledgesOf(0, alice.address)).to.equal(HALF_ETH);
      expect(await contract.pledgesOf(1, alice.address)).to.equal(HALF_ETH);
      expect((await contract.getCampaign(0)).pledged).to.equal(HALF_ETH);
      expect((await contract.getCampaign(1)).pledged).to.equal(HALF_ETH);
    });
  });
});
