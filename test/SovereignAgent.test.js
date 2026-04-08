const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SovereignAgent Contract", () => {
  let owner;
  let agent;
  let sovereignAgent;

  beforeEach(async () => {
    [owner, agent] = await ethers.getSigners();
    const SovereignAgent = await ethers.getContractFactory("SovereignAgent");
    sovereignAgent = await SovereignAgent.deploy(
      agent.address,
      ethers.utils.parseEther("1.0")
    );
  });

  describe("Function: postBounty", () => {
    it("should lock the correct amount of XTZ", async () => {
      const amount = ethers.utils.parseEther("1");
      await sovereignAgent.postBounty("owner/repo#42", amount);
      const bounty = await sovereignAgent.bounties("owner/repo#42");
      expect(bounty).to.equal(amount);
    });

    it("should handle insufficient balance", async () => {
      const amount = ethers.utils.parseEther("10"); // Assuming the agent does not have enough balance
      await expect(
        sovereignAgent.postBounty("owner/repo#42", amount)
      ).to.be.revertedWith("SovereignAgent: insufficient spendable balance");
    });

    it("should reject duplicate bounty postings", async () => {
      const amount = ethers.utils.parseEther("1");
      await sovereignAgent.postBounty("owner/repo#42", amount);
      await expect(
        sovereignAgent.postBounty("owner/repo#42", amount)
      ).to.be.revertedWith("SovereignAgent: bounty already posted");
    });
  });

  describe("Function: releaseBounty", () => {
    it("should pay the contributor correctly", async () => {
      const amount = ethers.utils.parseEther("1");
      await sovereignAgent.postBounty("owner/repo#42", amount);
      await sovereignAgent.releaseBounty("owner/repo#42", agent.address);
      const claimed = await sovereignAgent.bountyClaimant("owner/repo#42");
      expect(claimed).to.equal(agent.address);
    });

    it("should release bounty without held funds", async () => {
      const amount = ethers.utils.parseEther("1");
      await sovereignAgent.postBounty("owner/repo#42", amount);
      await expect(
        sovereignAgent.releaseBounty(
          "owner/repo#42",
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("SovereignAgent: zero contributor address");
    });
  });

  describe("Function: investSurplus", () => {
    it("should forward surplus funds to DeFi protocols", async () => {
      const target = agent.address; // Mock target
      const amount = ethers.utils.parseEther("1");
      await ethers.provider.send("eth_sendTransaction", [
        {
          from: owner.address,
          to: sovereignAgent.address,
          value: amount,
        },
      ]);
      await expect(sovereignAgent.investSurplus(target)).to.emit(
        sovereignAgent,
        "SurplusInvested"
      );
    });

    it("should not invest surplus if no surplus exists", async () => {
      const target = agent.address;
      await expect(sovereignAgent.investSurplus(target)).to.be.revertedWith(
        "SovereignAgent: no surplus to invest"
      );
    });
  });

  describe("Additional Bounty Test Scenarios", () => {
    it("should reject duplicate bounty postings", async () => {
      const amount = ethers.utils.parseEther("1");
      await sovereignAgent.postBounty("owner/repo#42", amount);
      await expect(
        sovereignAgent.postBounty("owner/repo#42", amount)
      ).to.be.revertedWith("SovereignAgent: bounty already posted");
    });

    it("should not invest surplus if no surplus exists", async () => {
      const target = agent.address;
      await expect(sovereignAgent.investSurplus(target)).to.be.revertedWith(
        "SovereignAgent: no surplus to invest"
      );
    });
  });
});
