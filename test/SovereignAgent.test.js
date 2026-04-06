const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("SovereignAgent", function () {
  let contract, agent, contributor, other;
  const BUFFER = ethers.parseEther("1"); // 1 XTZ

  beforeEach(async function () {
    [agent, contributor, other] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("SovereignAgent");
    contract = await Factory.deploy(agent.address, BUFFER);
    await contract.waitForDeployment();

    // Seed treasury with 10 XTZ
    await agent.sendTransaction({
      to: await contract.getAddress(),
      value: ethers.parseEther("10"),
    });
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  it("sets agent and lifeSupportBuffer on deploy", async function () {
    expect(await contract.agent()).to.equal(agent.address);
    expect(await contract.lifeSupportBuffer()).to.equal(BUFFER);
  });

  it("accepts XTZ via receive()", async function () {
    const bal = await ethers.provider.getBalance(await contract.getAddress());
    expect(bal).to.equal(ethers.parseEther("10"));
  });

  // ── Life support ───────────────────────────────────────────────────────────

  it("calculates spendable = balance - buffer - escrowed", async function () {
    // 10 XTZ - 1 XTZ buffer = 9 XTZ spendable
    expect(await contract.spendableBalance()).to.equal(ethers.parseEther("9"));
  });

  it("setLifeSupportBuffer updates buffer", async function () {
    await contract.setLifeSupportBuffer(ethers.parseEther("3"));
    expect(await contract.lifeSupportBuffer()).to.equal(ethers.parseEther("3"));
    expect(await contract.spendableBalance()).to.equal(ethers.parseEther("7"));
  });

  it("rejects setLifeSupportBuffer from non-agent", async function () {
    await expect(
      contract.connect(other).setLifeSupportBuffer(0)
    ).to.be.revertedWith("SovereignAgent: caller is not the agent");
  });

  // ── Bounty posting ─────────────────────────────────────────────────────────

  it("posts a bounty and escrows the amount", async function () {
    await expect(contract.postBounty("repo#1", ethers.parseEther("2")))
      .to.emit(contract, "BountyPosted")
      .withArgs("repo#1", ethers.parseEther("2"));

    expect(await contract.bounties("repo#1")).to.equal(ethers.parseEther("2"));
    expect(await contract.totalEscrowed()).to.equal(ethers.parseEther("2"));
    // Spendable: 10 - 1 (buffer) - 2 (escrowed) = 7
    expect(await contract.spendableBalance()).to.equal(ethers.parseEther("7"));
  });

  it("rejects duplicate bounty", async function () {
    await contract.postBounty("repo#1", ethers.parseEther("1"));
    await expect(
      contract.postBounty("repo#1", ethers.parseEther("1"))
    ).to.be.revertedWith("SovereignAgent: bounty already posted");
  });

  it("rejects bounty exceeding spendable balance", async function () {
    // 9 XTZ spendable
    await expect(
      contract.postBounty("repo#1", ethers.parseEther("10"))
    ).to.be.revertedWith("SovereignAgent: insufficient spendable balance");
  });

  it("rejects bounty from non-agent", async function () {
    await expect(
      contract.connect(other).postBounty("repo#1", ethers.parseEther("1"))
    ).to.be.revertedWith("SovereignAgent: caller is not the agent");
  });

  // ── Bounty release ─────────────────────────────────────────────────────────

  it("releases bounty and pays contributor", async function () {
    await contract.postBounty("repo#1", ethers.parseEther("2"));

    const balBefore = await ethers.provider.getBalance(contributor.address);

    await expect(contract.releaseBounty("repo#1", contributor.address))
      .to.emit(contract, "BountyReleased")
      .withArgs("repo#1", contributor.address, ethers.parseEther("2"));

    const balAfter = await ethers.provider.getBalance(contributor.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("2"));

    // State cleanup
    expect(await contract.bountyPaid("repo#1")).to.be.true;
    expect(await contract.bounties("repo#1")).to.equal(0);
    expect(await contract.totalEscrowed()).to.equal(0);
    expect(await contract.bountyClaimant("repo#1")).to.equal(contributor.address);
  });

  it("rejects double release", async function () {
    await contract.postBounty("repo#1", ethers.parseEther("1"));
    await contract.releaseBounty("repo#1", contributor.address);

    await expect(
      contract.releaseBounty("repo#1", contributor.address)
    ).to.be.revertedWith("SovereignAgent: bounty already paid");
  });

  it("rejects release of non-existent bounty", async function () {
    await expect(
      contract.releaseBounty("repo#999", contributor.address)
    ).to.be.revertedWith("SovereignAgent: no bounty posted");
  });

  // ── investSurplus ──────────────────────────────────────────────────────────

  it("invests surplus to target", async function () {
    const target = other;
    const balBefore = await ethers.provider.getBalance(target.address);

    // Spendable = 9 XTZ (no bounties escrowed)
    await expect(contract.investSurplus(target.address))
      .to.emit(contract, "SurplusInvested");

    const balAfter = await ethers.provider.getBalance(target.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("9"));

    // After investing, only buffer remains
    expect(await contract.treasuryBalance()).to.equal(BUFFER);
    expect(await contract.spendableBalance()).to.equal(0);
  });

  it("investSurplus respects escrowed bounties", async function () {
    await contract.postBounty("repo#1", ethers.parseEther("5"));
    // Spendable = 10 - 1 (buffer) - 5 (escrowed) = 4
    const target = other;
    const balBefore = await ethers.provider.getBalance(target.address);

    await contract.investSurplus(target.address);

    const balAfter = await ethers.provider.getBalance(target.address);
    expect(balAfter - balBefore).to.equal(ethers.parseEther("4"));

    // Contract retains buffer + escrowed = 6 XTZ
    expect(await contract.treasuryBalance()).to.equal(ethers.parseEther("6"));
    // Bounty is still releasable
    await contract.releaseBounty("repo#1", contributor.address);
  });

  it("rejects investSurplus when no surplus", async function () {
    // Escrow almost everything
    await contract.postBounty("repo#1", ethers.parseEther("9"));
    // Spendable = 10 - 1 - 9 = 0
    await expect(
      contract.investSurplus(other.address)
    ).to.be.revertedWith("SovereignAgent: no surplus to invest");
  });

  // ── Agent rotation ─────────────────────────────────────────────────────────

  it("setAgent transfers agent role", async function () {
    await contract.setAgent(other.address);
    expect(await contract.agent()).to.equal(other.address);
    // Old agent can no longer operate
    await expect(
      contract.postBounty("repo#1", ethers.parseEther("1"))
    ).to.be.revertedWith("SovereignAgent: caller is not the agent");
  });
});
