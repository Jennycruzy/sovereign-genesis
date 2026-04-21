const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SovereignAgent", function () {
    let SovereignAgent;
    let sovereignAgent;
    let owner;
    let addr1;
    let addr2;
    let investmentWallet;

    // This beforeEach hook runs before each test in this suite
    beforeEach(async function () {
        // Get the list of test accounts from Hardhat
        [owner, addr1, addr2, investmentWallet] = await ethers.getSigners();
        
        // Get the ContractFactory for SovereignAgent
        SovereignAgent = await ethers.getContractFactory("SovereignAgent");
        
        // Deploy the contract. The constructor of SovereignAgent is assumed to take an initial owner address.
        // We set the 'owner' (first signer) as the initial owner of the contract.
        sovereignAgent = await SovereignAgent.deploy(owner.address);
        
        // Wait for the contract to be deployed on the local Hardhat network
        await sovereignAgent.waitForDeployment();
    });

    describe("postBounty", function () {
        it("should allow anyone to post a bounty with ETH and emit a BountyPosted event", async function () {
            const bountyAmount = ethers.parseEther("1"); // 1 ETH
            const description = "Help fix the dashboard UI responsiveness";

            // addr1 posts a bounty, sending 1 ETH along with the transaction
            // Expect an event 'BountyPosted' to be emitted with correct arguments
            await expect(sovereignAgent.connect(addr1).postBounty(description, { value: bountyAmount }))
                .to.emit(sovereignAgent, "BountyPosted")
                .withArgs(0, addr1.address, bountyAmount, description); // The first bounty ID is 0

            // Verify the bounty details stored in the contract's 'bounties' mapping
            const bounty = await sovereignAgent.bounties(0); 
            expect(bounty.poster).to.equal(addr1.address);
            expect(bounty.amount).to.equal(bountyAmount);
            expect(bounty.description).to.equal(description);
            expect(bounty.released).to.be.false; // Bounty should not be released yet

            // Verify the contract's ETH balance increased by the bounty amount
            expect(await ethers.provider.getBalance(sovereignAgent.target)).to.equal(bountyAmount);
        });

        it("should increment nextBountyId for each new bounty posted", async function () {
            const bountyAmount1 = ethers.parseEther("0.5");
            const bountyAmount2 = ethers.parseEther("0.75");

            // Post the first bounty
            await sovereignAgent.connect(addr1).postBounty("Bounty 1 description", { value: bountyAmount1 });
            // After the first bounty, nextBountyId should be 1
            expect(await sovereignAgent.nextBountyId()).to.equal(1); 

            // Post the second bounty
            await sovereignAgent.connect(addr2).postBounty("Bounty 2 description", { value: bountyAmount2 });
            // After the second bounty, nextBountyId should be 2
            expect(await sovereignAgent.nextBountyId()).to.equal(2); 

            // Verify the total contract balance reflects both bounties
            expect(await ethers.provider.getBalance(sovereignAgent.target)).to.equal(bountyAmount1 + bountyAmount2);
        });

        it("should revert if bounty amount (msg.value) is zero", async function () {
            const description = "Zero value bounty that should fail";
            // Attempt to post a bounty with 0 ETH, which should revert
            await expect(sovereignAgent.connect(addr1).postBounty(description, { value: 0 }))
                .to.be.revertedWith("Bounty amount must be greater than zero");
        });
    });

    describe("releaseBounty", function () {
        const bountyAmount = ethers.parseEther("1");
        const description = "Fix critical bug in backend service";
        let bountyId; // Variable to store the ID of the bounty posted in beforeEach

        // This beforeEach hook runs before each test in the 'releaseBounty' suite
        beforeEach(async function () {
            // Post a bounty using addr1. This ensures a bounty exists for testing release functionality.
            await sovereignAgent.connect(addr1).postBounty(description, { value: bountyAmount });
            bountyId = 0; // The first bounty posted will consistently have ID 0 based on `nextBountyId++`
        });

        it("should allow the owner to release a bounty to a recipient and emit a BountyReleased event", async function () {
            const initialRecipientBalance = await ethers.provider.getBalance(addr2.address);
            const initialContractBalance = await ethers.provider.getBalance(sovereignAgent.target);

            // Owner releases the bounty to addr2
            // Expect an event 'BountyReleased' to be emitted with correct arguments
            await expect(sovereignAgent.connect(owner).releaseBounty(bountyId, addr2.address))
                .to.emit(sovereignAgent, "BountyReleased")
                .withArgs(bountyId, addr2.address, bountyAmount);

            // Verify the recipient's balance increased by the bounty amount
            const finalRecipientBalance = await ethers.provider.getBalance(addr2.address);
            expect(finalRecipientBalance).to.equal(initialRecipientBalance + bountyAmount);

            // Verify the contract's balance decreased by the bounty amount
            const finalContractBalance = await ethers.provider.getBalance(sovereignAgent.target);
            expect(finalContractBalance).to.equal(initialContractBalance - bountyAmount);

            // Verify the bounty's status is updated to 'released'
            const bounty = await sovereignAgent.bounties(bountyId);
            expect(bounty.released).to.be.true;
        });

        it("should revert if an unauthorized caller tries to release a bounty", async function () {
            // addr1 (who is not the owner) tries to release the bounty
            // Expect a custom error from Ownable contract
            await expect(sovereignAgent.connect(addr1).releaseBounty(bountyId, addr2.address))
                .to.be.revertedWithCustomError(sovereignAgent, "OwnableUnauthorizedAccount")
                .withArgs(addr1.address); // The error should include the unauthorized address
        });

        it("should revert if trying to release a non-existent bounty", async function () {
            const nonExistentBountyId = 999; // An ID that has not been posted
            // Owner tries to release a bounty with an invalid ID
            await expect(sovereignAgent.connect(owner).releaseBounty(nonExistentBountyId, addr2.address))
                .to.be.revertedWith("Bounty does not exist");
        });

        it("should revert if trying to release an already released bounty", async function () {
            // First, release the bounty successfully
            await sovereignAgent.connect(owner).releaseBounty(bountyId, addr2.address);

            // Then, try to release the same bounty again
            await expect(sovereignAgent.connect(owner).releaseBounty(bountyId, addr2.address))
                .to.be.revertedWith("Bounty already released");
        });
    });

    describe("investSurplus", function () {
        const surplusAmount = ethers.parseEther("0.5"); // Amount to invest

        // This beforeEach hook runs before each test in the 'investSurplus' suite
        beforeEach(async function () {
            // Send some surplus ETH directly to the contract.
            // This simulates funds accumulating in the contract beyond active bounties,
            // which can then be invested. We use 'owner.sendTransaction' to send ETH
            // directly to the contract's 'receive' or 'fallback' function.
            await owner.sendTransaction({
                to: sovereignAgent.target,
                value: ethers.parseEther("1"), // Contract will have 1 ETH surplus initially for these tests
            });
        });

        it("should allow the owner to invest surplus funds to an investment wallet and emit a SurplusInvested event", async function () {
            const initialInvestmentWalletBalance = await ethers.provider.getBalance(investmentWallet.address);
            const initialContractBalance = await ethers.provider.getBalance(sovereignAgent.target);

            // Owner invests surplus funds to the 'investmentWallet'
            // Expect an event 'SurplusInvested' to be emitted with correct arguments
            await expect(sovereignAgent.connect(owner).investSurplus(investmentWallet.address, surplusAmount))
                .to.emit(sovereignAgent, "SurplusInvested")
                .withArgs(investmentWallet.address, surplusAmount);

            // Verify the investment wallet's balance increased by the invested amount
            const finalInvestmentWalletBalance = await ethers.provider.getBalance(investmentWallet.address);
            expect(finalInvestmentWalletBalance).to.equal(initialInvestmentWalletBalance + surplusAmount);

            // Verify the contract's balance decreased by the invested amount
            const finalContractBalance = await ethers.provider.getBalance(sovereignAgent.target);
            expect(finalContractBalance).to.equal(initialContractBalance - surplusAmount);
        });

        it("should revert if an unauthorized caller tries to invest surplus", async function () {
            // addr1 (who is not the owner) tries to invest surplus
            // Expect a custom error from Ownable contract
            await expect(sovereignAgent.connect(addr1).investSurplus(investmentWallet.address, surplusAmount))
                .to.be.revertedWithCustomError(sovereignAgent, "OwnableUnauthorizedAccount")
                .withArgs(addr1.address);
        });

        it("should revert if investment amount is zero", async function () {
            // Owner tries to invest 0 ETH
            await expect(sovereignAgent.connect(owner).investSurplus(investmentWallet.address, 0))
                .to.be.revertedWith("Investment amount must be greater than zero");
        });

        it("should revert if contract has insufficient balance for the requested investment", async function () {
            const largerAmount = ethers.parseEther("2"); // Contract only has 1 ETH from beforeEach
            // Owner tries to invest an amount greater than the contract's current balance
            await expect(sovereignAgent.connect(owner).investSurplus(investmentWallet.address, largerAmount))
                .to.be.revertedWith("Insufficient contract balance for investment");
        });
    });
});
