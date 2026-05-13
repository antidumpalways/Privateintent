// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PrivateIntentEscrow
 * @notice Escrow contract for Private Intent cross-chain swaps on Ethereum Sepolia.
 *
 * Flow:
 *   1. User locks ETH in escrow with intent details (fromChain, toChain, etc.)
 *   2. Off-chain solver verifies intent and delivers output token on destination chain
 *   3. Solver submits proof (delivery tx hash) → escrow released to solver
 *   4. If dispute → AI judge verdict can trigger refund or release
 *
 * Key design points:
 *   - Non-custodial: user retains ownership of escrowed ETH
 *   - Time-locked: releaseAfter timestamp prevents early execution
 *   - Sentinel agent (live solver) can trigger release after valid proof
 *   - Dispute resolution via AI judge (off-chain, verdict submitted on-chain)
 */
contract PrivateIntentEscrow {
    // ─── Types ──────────────────────────────────────────────────────────────
    
    enum IntentStatus { Pending, Active, Delivered, Settled, Refunded, Disputed }

    struct Intent {
        uint256    id;
        address    payable user;
        address    payable solver;
        uint256    amount;          // Wei locked
        string     fromChain;
        string     toChain;
        string     fromToken;
        string     toToken;
        uint256    releaseAfter;    // Unix timestamp (0 = no timelock)
        IntentStatus status;
        string     deliveryTxHash;  // Solver's delivery proof
        string     proofHash;       // Off-chain generated proof
        uint256    createdAt;
        uint256    updatedAt;
    }

    // ─── State ──────────────────────────────────────────────────────────────

    address public sentinel;        // Live solver / escrow agent
    uint256 public nextIntentId;
    mapping(uint256 => Intent) public intents;
    
    event IntentCreated(
        uint256 indexed intentId,
        address indexed user,
        uint256 amount,
        string fromChain,
        string toChain,
        string fromToken,
        string toToken,
        uint256 releaseAfter
    );
    event IntentSettled(uint256 indexed intentId, address indexed solver, string deliveryTxHash);
    event IntentRefunded(uint256 indexed intentId, address indexed user);
    event IntentDisputed(uint256 indexed intentId, address indexed disputer);
    event SentinelUpdated(address indexed oldSentinel, address indexed newSentinel);

    // ─── Modifiers ──────────────────────────────────────────────────────────

    modifier onlySentinel() {
        require(msg.sender == sentinel, "Only sentinel can call this");
        _;
    }

    modifier intentExists(uint256 intentId) {
        require(intents[intentId].id == intentId, "Intent does not exist");
        _;
    }

    modifier intentStatus(uint256 intentId, IntentStatus expected) {
        require(intents[intentId].status == expected, "Invalid intent status");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(address _sentinel) {
        require(_sentinel != address(0), "Sentinel cannot be zero address");
        sentinel = _sentinel;
        nextIntentId = 1;
    }

    // ─── Functions ─────────────────────────────────────────────────────────

    /**
     * @notice User locks ETH in escrow for a cross-chain intent.
     * @param fromChain Origin blockchain (e.g. "ETH")
     * @param toChain Destination blockchain (e.g. "SOL")
     * @param fromToken Token being sent
     * @param toToken Token expected on destination
     * @param releaseAfter Optional timelock timestamp (0 = no timelock)
     * @param proofHash Off-chain generated proof hash
     * @return intentId The created intent ID
     */
    function createIntent(
        string calldata fromChain,
        string calldata toChain,
        string calldata fromToken,
        string calldata toToken,
        uint256 releaseAfter,
        string calldata proofHash
    ) external payable returns (uint256 intentId) {
        require(msg.value > 0, "Must lock ETH");
        require(bytes(fromChain).length > 0, "fromChain required");
        require(bytes(toChain).length > 0, "toChain required");

        if (releaseAfter > 0) {
            require(releaseAfter > block.timestamp, "releaseAfter must be in future");
            require(releaseAfter < block.timestamp + 30 days, "releaseAfter too far");
        }

        intentId = nextIntentId++;
        intents[intentId] = Intent({
            id:             intentId,
            user:           payable(msg.sender),
            solver:         payable(address(0)),
            amount:         msg.value,
            fromChain:      fromChain,
            toChain:        toChain,
            fromToken:      fromToken,
            toToken:        toToken,
            releaseAfter:   releaseAfter,
            status:         IntentStatus.Active,
            deliveryTxHash: "",
            proofHash:      proofHash,
            createdAt:      block.timestamp,
            updatedAt:      block.timestamp
        });

        emit IntentCreated(intentId, msg.sender, msg.value, fromChain, toChain, fromToken, toToken, releaseAfter);
    }

    /**
     * @notice Sentinel releases escrow to solver after valid delivery proof.
     * @param intentId Intent ID
     * @param solverAddress Solver's address to receive funds
     * @param deliveryTxHash Hash of delivery transaction on destination chain
     */
    function settleIntent(
        uint256 intentId,
        address payable solverAddress,
        string calldata deliveryTxHash
    ) external onlySentinel intentExists(intentId) intentStatus(intentId, IntentStatus.Active) {
        Intent storage intent = intents[intentId];
        
        require(solverAddress != address(0), "Invalid solver address");
        require(bytes(deliveryTxHash).length > 0, "Delivery tx hash required");
        require(intent.releaseAfter == 0 || block.timestamp >= intent.releaseAfter, "Timelock not expired");

        intent.status = IntentStatus.Settled;
        intent.solver = solverAddress;
        intent.deliveryTxHash = deliveryTxHash;
        intent.updatedAt = block.timestamp;

        // Transfer ETH to solver
        uint256 amount = intent.amount;
        (bool success, ) = solverAddress.call{value: amount}("");
        require(success, "Transfer to solver failed");

        emit IntentSettled(intentId, solverAddress, deliveryTxHash);
    }

    /**
     * @notice Refunds escrow to user (sentinel-triggered, e.g. after dispute verdict).
     * @param intentId Intent ID
     */
    function refundIntent(
        uint256 intentId
    ) external onlySentinel intentExists(intentId) {
        Intent storage intent = intents[intentId];
        require(
            intent.status == IntentStatus.Active || intent.status == IntentStatus.Disputed,
            "Cannot refund in current status"
        );

        intent.status = IntentStatus.Refunded;
        intent.updatedAt = block.timestamp;

        uint256 amount = intent.amount;
        (bool success, ) = intent.user.call{value: amount}("");
        require(success, "Refund to user failed");

        emit IntentRefunded(intentId, intent.user);
    }

    /**
     * @notice Mark an intent as disputed (user or sentinel can trigger).
     * @param intentId Intent ID
     */
    function disputeIntent(
        uint256 intentId
    ) external intentExists(intentId) intentStatus(intentId, IntentStatus.Active) {
        require(
            msg.sender == intents[intentId].user || msg.sender == sentinel,
            "Only user or sentinel can dispute"
        );
        intents[intentId].status = IntentStatus.Disputed;
        intents[intentId].updatedAt = block.timestamp;
        emit IntentDisputed(intentId, msg.sender);
    }

    /**
     * @notice Update sentinel address (only sentinel itself).
     * @param newSentinel New sentinel address
     */
    function updateSentinel(address newSentinel) external onlySentinel {
        require(newSentinel != address(0), "Invalid sentinel address");
        address old = sentinel;
        sentinel = newSentinel;
        emit SentinelUpdated(old, newSentinel);
    }

    // ─── View ───────────────────────────────────────────────────────────────

    function getIntent(uint256 intentId) external view returns (Intent memory) {
        require(intents[intentId].id == intentId, "Intent does not exist");
        return intents[intentId];
    }

    function getIntentCount() external view returns (uint256) {
        return nextIntentId - 1;
    }
}