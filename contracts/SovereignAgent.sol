// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SovereignAgent
 * @notice Autonomous treasury contract for the SOVEREIGN-GENESIS AI agent on Tezos Etherlink.
 *         Manages bounties, life-support buffer, and DeFi surplus investment entirely on-chain.
 */
contract SovereignAgent is ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    address public agent;
    uint256 public lifeSupportBuffer;
    uint256 public totalEscrowed;   // sum of all posted-but-unpaid bounties

    mapping(string => uint256)  public bounties;
    mapping(string => bool)     public bountyPaid;
    mapping(string => address)  public bountyClaimant;   // optional: who claimed

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event BountyPosted(string indexed githubPrId, uint256 amount);
    event BountyReleased(string indexed githubPrId, address contributor, uint256 amount);
    event SurplusInvested(uint256 amount, address indexed target);
    event LifeSupportUpdated(uint256 amount);
    event Received(address indexed sender, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyAgent() {
        require(msg.sender == agent, "SovereignAgent: caller is not the agent");
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _agent           Address of the off-chain agent EOA (or multisig).
     * @param _lifeSupportBuffer Minimum XTZ balance the contract must always retain.
     */
    constructor(address _agent, uint256 _lifeSupportBuffer) {
        require(_agent != address(0), "SovereignAgent: zero agent address");
        agent             = _agent;
        lifeSupportBuffer = _lifeSupportBuffer;
        emit LifeSupportUpdated(_lifeSupportBuffer);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Treasury — accept XTZ
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Life-support configuration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the minimum balance the agent must retain.
     * @param amount New life-support buffer in wei.
     */
    function setLifeSupportBuffer(uint256 amount) external onlyAgent {
        lifeSupportBuffer = amount;
        emit LifeSupportUpdated(amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bounty system
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Escrow a bounty for a GitHub PR.
     * @dev    Checks-Effects-Interactions: state written before any transfer.
     *         The bounty amount is locked from the existing balance — no ETH sent here.
     * @param githubPrId  GitHub PR identifier string (e.g. "owner/repo#42").
     * @param amount      Amount in wei to reserve for this bounty.
     */
    function postBounty(string calldata githubPrId, uint256 amount) external onlyAgent {
        require(amount > 0, "SovereignAgent: zero bounty amount");
        require(bounties[githubPrId] == 0, "SovereignAgent: bounty already posted");
        require(!bountyPaid[githubPrId], "SovereignAgent: bounty already paid");

        // Cache reserved to save gas
        uint256 reserved = lifeSupportBuffer + totalEscrowed;
        uint256 bal = address(this).balance;
        require(bal >= reserved + amount, "SovereignAgent: insufficient spendable balance");

        // Effects
        bounties[githubPrId] = amount;
        totalEscrowed += amount;

        emit BountyPosted(githubPrId, amount);
    }

    /**
     * @notice Release an escrowed bounty to the contributor.
     * @param githubPrId   GitHub PR identifier.
     * @param contributor  Wallet address of the developer to pay.
     */
    function releaseBounty(
        string calldata githubPrId,
        address payable contributor
    ) external onlyAgent nonReentrant {
        require(contributor != address(0), "SovereignAgent: zero contributor address");
        require(!bountyPaid[githubPrId],   "SovereignAgent: bounty already paid");
        require(bounties[githubPrId] > 0,  "SovereignAgent: no bounty posted");

        uint256 amount = bounties[githubPrId];
        require(address(this).balance >= lifeSupportBuffer + amount,
                "SovereignAgent: would breach life-support buffer");

        // Checks-Effects-Interactions
        bountyPaid[githubPrId]     = true;
        bountyClaimant[githubPrId] = contributor;
        bounties[githubPrId]       = 0;
        totalEscrowed             -= amount;

        (bool success, ) = contributor.call{value: amount}("");
        require(success, "SovereignAgent: XTZ transfer failed");

        emit BountyReleased(githubPrId, contributor, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Yield / surplus investment
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Forward surplus XTZ to a DeFi yield protocol.
     * @param target  Payable address of the yield contract (e.g. liquidity pool).
     */
    function investSurplus(address payable target) external onlyAgent nonReentrant {
        require(target != address(0), "SovereignAgent: zero target address");

        uint256 surplus = _spendableBalance();
        require(surplus > 0, "SovereignAgent: no surplus to invest");

        // Effects before interaction
        // (no state to update; event emitted after transfer)

        (bool success, ) = target.call{value: surplus}("");
        require(success, "SovereignAgent: investment transfer failed");

        emit SurplusInvested(surplus, target);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Agent rotation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Transfer agent role (e.g. when upgrading to a new agent EOA).
     * @param newAgent  Address of the new agent.
     */
    function setAgent(address newAgent) external onlyAgent {
        require(newAgent != address(0), "SovereignAgent: zero agent address");
        agent = newAgent;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** @return Balance the agent may freely spend (total minus life-support). */
    function spendableBalance() external view returns (uint256) {
        return _spendableBalance();
    }

    /** @return Treasury balance (full). */
    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _spendableBalance() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        uint256 reserved = lifeSupportBuffer + totalEscrowed;
        if (bal <= reserved) return 0;
        return bal - reserved;
    }
}
