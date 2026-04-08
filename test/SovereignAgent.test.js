// Sample unit tests for SovereignAgent contract
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SovereignAgent", function () {
  let SovereignAgent;
  let deployedContract;

  beforeEach(async () => {
    SovereignAgent = await ethers.getContractFactory("SovereignAgent");
    const agentAddress = "0xDA4B4B000dA321910935D70cf7B5e6A445584E31"; // A valid tested Ethereum address
    const lifeSupportBuffer = ethers.utils.parseUnits("1.0", 18);
    deployedContract = await SovereignAgent.deploy(
      agentAddress,
      lifeSupportBuffer
    );
    await deployedContract.deployed();
  });

  describe("Function: postBounty", () => {
    it("should lock the correct amount of XTZ", async () => {
      const amount = ethers.utils.parseUnits("1.0", 18);

      await deployedContract.postBounty(amount);
      const balance = await deployedContract.getBountyBalance(); // Assuming you have such a function
      expect(balance).to.equal(amount);
    });
  });
  describe("Function: releaseBounty", () => {
    it("should release bounty when criteria are met", async () => {
      // Arrange tests for sufficient conditions here, then act
      await deployedContract.releaseBounty(); // Check assertions after this
    });

    it("should not release bounty without held funds", async () => {
      await expect(
        deployedContract.releaseBounty(
          "owner/repo#42",
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("SovereignAgent: zero contributor address");
    });
  });
  describe("Function: investSurplus", () => {
    it("should forward surplus funds to DeFi protocols", async () => {
      const surplus = ethers.utils.parseUnits("1.0", 18);
      await deployedContract.investSurplus(surplus);
      // add assertions to verify the funds were forwarded
    });
  });
});
