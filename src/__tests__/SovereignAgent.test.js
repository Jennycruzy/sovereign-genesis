const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SovereignAgent Contract", function () {
  let SovereignAgent;
  let contract;

  beforeEach(async function () {
    SovereignAgent = await ethers.getContractFactory("SovereignAgent");
    contract = await SovereignAgent.deploy();
    await contract.deployed();
  });

  describe("postBounty", function () {
    it("should post a bounty successfully", async function () {
      const amount = ethers.utils.parseEther("1"); // Assume sufficient balance is 1 ETH
      await contract.postBounty(amount);
      const bounty = await contract.bounties(0); // Assuming bounties is an array
      expect(bounty.amount.toString()).to.equal(amount.toString());
    });

    it("should reject duplicate bounty postings", async function () {
      const amount = ethers.utils.parseEther("1");
      await contract.postBounty(amount);
      await expect(contract.postBounty(amount)).to.be.revertedWith(
        "Duplicate bounty"
      ); // Adjust error message accordingly
    });

    it("should reject posting if insufficient balance", async function () {
      const insufficientAmount = ethers.utils.parseEther("0.1"); // Assuming balance is less than this
      await expect(contract.postBounty(insufficientAmount)).to.be.revertedWith(
        "Insufficient balance"
      ); // Adjust error message accordingly
    });
  });

  describe("releaseBounty", function () {
    it("should release the bounty successfully", async function () {
      const amount = ethers.utils.parseEther("1");
      await contract.postBounty(amount);
      await contract.releaseBounty(0);
      const bounty = await contract.bounties(0);
      expect(bounty.released).to.be.true; // Assuming the bounty has a released flag
    });

    it("should reject release for non-existent bounties", async function () {
      await expect(contract.releaseBounty(999)).to.be.revertedWith(
        "Bounty does not exist"
      ); // Adjust error message accordingly
    });
  });

  describe("investSurplus", function () {
    it("should reject surplus investment if no surplus exists", async function () {
      await expect(contract.investSurplus()).to.be.revertedWith(
        "No surplus to invest"
      ); // Adjust error message accordingly
    });
  });
});
