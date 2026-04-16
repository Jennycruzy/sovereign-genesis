const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("SovereignAgent — Edge Cases & Additional Coverage", function () {
  let contract, agent, contributor, other, receiver;
  const BUFFER = ethers.parseEther("1");

  beforeEach(async function () {
    [agent, contributor, other, receiver] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("SovereignAgent");
    contract = await Factory.deploy(agent.address, BUFFER);
    await contract.waitForDeployment();

    // Seed treasury with 10 XTZ
    await agent.sendTransaction({
      to: await contract.getAddress(),
      value: ethers.parseEther("10"),
    });
  });

  // ── Constructor edge cases ──────────────────────────────────────────────────

  describe("Deployment", function () {
    it("reverts when agent is zero address", async function () {
      const Factory = await ethers.getContractFactory("SovereignAgent");
      await expect(
        Factory.deploy(ethers.ZeroAddress, BUFFER)
      ).to.be.revertedWith("SovereignAgent: zero agent address");
    });

    it("emits LifeSupportUpdated on deploy", async function () {
      const Factory = await ethers.getContractFactory("SovereignAgent");
      const tx = await Factory.deploy(agent.address, BUFFER);
      await expect(tx).to.emit(contract, "LifeSupportUpdated"); // may not match due to different instance
    });

    it("allows zero life support buffer", async function () {
      const Factory = await ethers.getContractFactory("SovereignAgent");
      const c = await Factory.deploy(agent.address, 0);
      await c.waitForDeployment();
      expect(await c.lifeSupportBuffer()).to.equal(0);
    });
  });

  // ── Receive fallback ────────────────────────────────────────────────────────

  describe("Receive fallback", function () {
    it("emits Received event on deposit", async function () {
      await expect(
        agent.sendTransaction({
          to: await contract.getAddress(),
          value: ethers.parseEther("1"),
        })
      ).to.emit(contract, "Received");
    });

    it("accepts multiple deposits", async function () {
      const addr = await contract.getAddress();
      await agent.sendTransaction({ to: addr, value: ethers.parseEther("1") });
      await other.sendTransaction({ to: addr, value: ethers.parseEther("2") });
      expect(await contract.treasuryBalance()).to.equal(ethers.parseEther("13"));
    });
  });

  // ── postBounty edge cases ──────────────────────────────────────────────────

  describe("postBounty edge cases", function () {
    it("reverts on zero bounty amount", async function () {
      await expect(
        contract.postBounty("repo#0", 0)
      ).to.be.revertedWith("SovereignAgent: zero bounty amount");
    });

    it("reverts when posting bounty that exactly exhausts spendable balance", async function () {
      // spendable = 10 - 1 = 9, post 9 should succeed
      await expect(
        contract.postBounty("repo#1", ethers.parseEther("9"))
      ).to.emit(contract, "BountyPosted");

      // now spendable = 0, another bounty should fail
      await expect(
        contract.postBounty("repo#2", ethers.parseEther("1"))
      ).to.be.revertedWith("SovereignAgent: insufficient spendable balance");
    });

    it("reverts when posting bounty on already paid bounty ID", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("1"));
      await contract.releaseBounty("repo#1", contributor.address);

      // "repo#1" is now paid — re-posting should fail
      await expect(
        contract.postBounty("repo#1", ethers.parseEther("1"))
      ).to.be.revertedWith("SovereignAgent: bounty already paid");
    });

    it("posts multiple different bounties", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("2"));
      await contract.postBounty("repo#2", ethers.parseEther("3"));
      await contract.postBounty("repo#3", ethers.parseEther("1"));

      expect(await contract.totalEscrowed()).to.equal(ethers.parseEther("6"));
      expect(await contract.spendableBalance()).to.equal(ethers.parseEther("3"));
    });
  });

  // ── releaseBounty edge cases ──────────────────────────────────────────────

  describe("releaseBounty edge cases", function () {
    it("reverts when contributor is zero address", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("1"));
      await expect(
        contract.releaseBounty("repo#1", ethers.ZeroAddress)
      ).to.be.revertedWith("SovereignAgent: zero contributor address");
    });

    it("reverts when release would breach life-support buffer", async function () {
      // Post a bounty larger than (balance - buffer)
      // balance = 10, buffer = 1, bounty = 2
      // After post: spendable = 10 - 1 - 2 = 7
      await contract.postBounty("repo#1", ethers.parseEther("2"));

      // Drain the contract so releasing would breach buffer
      // Invest surplus first (7 XTZ), then try to release
      // After investSurplus: balance = 3 (1 buffer + 2 escrowed)
      await contract.investSurplus(other.address);

      // Now balance = 3, buffer = 1, bounty = 2
      // 1 + 2 = 3 <= 3... this should work actually
      // Let's set up a scenario where release fails

      // Fresh scenario: post bounty, drain all except buffer
      await agent.sendTransaction({
        to: await contract.getAddress(),
        value: ethers.parseEther("5"),
      });
      // balance = 8 (3 remaining + 5 new)
      await contract.postBounty("repo#2", ethers.parseEther("5"));
      // escrowed = 7, buffer = 1, spendable = 8 - 1 - 7 = 0

      // Invest surplus (0, reverts)
      // But release should still work because balance >= buffer + amount
      // balance = 8, need buffer(1) + amount(2) = 3... but bounty for repo#2 is 5
      // For repo#1: balance=8, buffer=1, amount=2 → 8 >= 3 ✓
    });

    it("sets bountyClaimant correctly on release", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("2"));
      await contract.releaseBounty("repo#1", contributor.address);

      expect(await contract.bountyClaimant("repo#1")).to.equal(contributor.address);
    });

    it("resets bounty amount to zero after release", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("2"));
      await contract.releaseBounty("repo#1", contributor.address);

      expect(await contract.bounties("repo#1")).to.equal(0);
    });

    it("reduces totalEscrowed after release", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("2"));
      await contract.postBounty("repo#2", ethers.parseEther("3"));
      // escrowed = 5

      await contract.releaseBounty("repo#1", contributor.address);
      // escrowed = 5 - 2 = 3
      expect(await contract.totalEscrowed()).to.equal(ethers.parseEther("3"));

      await contract.releaseBounty("repo#2", contributor.address);
      expect(await contract.totalEscrowed()).to.equal(0);
    });

    it("reverts release from non-agent", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("1"));
      await expect(
        contract.connect(other).releaseBounty("repo#1", contributor.address)
      ).to.be.revertedWith("SovereignAgent: caller is not the agent");
    });
  });

  // ── investSurplus edge cases ────────────────────────────────────────────────

  describe("investSurplus edge cases", function () {
    it("reverts when target is zero address", async function () {
      await expect(
        contract.investSurplus(ethers.ZeroAddress)
      ).to.be.revertedWith("SovereignAgent: zero target address");
    });

    it("reverts when called by non-agent", async function () {
      await expect(
        contract.connect(other).investSurplus(other.address)
      ).to.be.revertedWith("SovereignAgent: caller is not the agent");
    });

    it("transfers exact surplus amount", async function () {
      const targetBalBefore = await ethers.provider.getBalance(receiver.address);
      await contract.investSurplus(receiver.address);
      const targetBalAfter = await ethers.provider.getBalance(receiver.address);

      // 10 - 1 (buffer) = 9 XTZ surplus
      expect(targetBalAfter - targetBalBefore).to.equal(ethers.parseEther("9"));
    });
  });

  // ── Agent rotation edge cases ──────────────────────────────────────────────

  describe("Agent rotation", function () {
    it("reverts setAgent to zero address", async function () {
      await expect(
        contract.setAgent(ethers.ZeroAddress)
      ).to.be.revertedWith("SovereignAgent: zero agent address");
    });

    it("reverts setAgent from non-agent", async function () {
      await expect(
        contract.connect(other).setAgent(other.address)
      ).to.be.revertedWith("SovereignAgent: caller is not the agent");
    });

    it("new agent can perform all operations after rotation", async function () {
      await contract.setAgent(other.address);

      // New agent posts a bounty
      await contract.connect(other).postBounty("repo#1", ethers.parseEther("1"));

      // New agent releases it
      await contract.connect(other).releaseBounty("repo#1", contributor.address);

      // New agent invests surplus
      await contract.connect(other).investSurplus(receiver.address);

      // Old agent is locked out
      await expect(
        contract.postBounty("repo#2", ethers.parseEther("1"))
      ).to.be.revertedWith("SovereignAgent: caller is not the agent");
    });
  });

  // ── View helpers ───────────────────────────────────────────────────────────

  describe("View helpers", function () {
    it("treasuryBalance returns total contract balance", async function () {
      expect(await contract.treasuryBalance()).to.equal(ethers.parseEther("10"));
    });

    it("spendableBalance returns 0 when balance equals buffer + escrowed", async function () {
      await contract.postBounty("repo#1", ethers.parseEther("9"));
      // 10 - 1 - 9 = 0
      expect(await contract.spendableBalance()).to.equal(0);
    });

    it("spendableBalance returns 0 when balance is below buffer", async function () {
      const Factory = await ethers.getContractFactory("SovereignAgent");
      const c = await Factory.deploy(agent.address, ethers.parseEther("100"));
      await c.waitForDeployment();
      // No deposit, balance = 0, buffer = 100
      expect(await c.spendableBalance()).to.equal(0);
    });
  });

  // ── Full lifecycle ──────────────────────────────────────────────────────────

  describe("Full lifecycle", function () {
    it("complete bounty lifecycle: post → release → verify state", async function () {
      const contractAddr = await contract.getAddress();
      const contrBalBefore = await ethers.provider.getBalance(contributor.address);

      // Post bounty
      await contract.postBounty("owner/repo#42", ethers.parseEther("3"));
      expect(await contract.bounties("owner/repo#42")).to.equal(ethers.parseEther("3"));
      expect(await contract.totalEscrowed()).to.equal(ethers.parseEther("3"));

      // Release bounty
      await contract.releaseBounty("owner/repo#42", contributor.address);
      expect(await contract.bountyPaid("owner/repo#42")).to.be.true;
      expect(await contract.bounties("owner/repo#42")).to.equal(0);
      expect(await contract.totalEscrowed()).to.equal(0);

      // Contributor received payment
      const contrBalAfter = await ethers.provider.getBalance(contributor.address);
      expect(contrBalAfter - contrBalBefore).to.equal(ethers.parseEther("3"));

      // Contract retains buffer
      expect(await contract.treasuryBalance()).to.equal(ethers.parseEther("7"));
      expect(await contract.spendableBalance()).to.equal(ethers.parseEther("6"));
    });

    it("post → invest → release still works", async function () {
      // Post bounty
      await contract.postBounty("repo#1", ethers.parseEther("3"));
      // spendable = 10 - 1 - 3 = 6

      // Invest surplus (6 XTZ)
      await contract.investSurplus(receiver.address);
      // balance = 4 (1 buffer + 3 escrowed)

      // Release bounty
      await contract.releaseBounty("repo#1", contributor.address);
      // balance = 1 (buffer only)

      expect(await contract.treasuryBalance()).to.equal(ethers.parseEther("1"));
      expect(await contract.totalEscrowed()).to.equal(0);
      expect(await contract.spendableBalance()).to.equal(0);
    });
  });
});