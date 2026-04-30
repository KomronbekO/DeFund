// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Crowdfunding
/// @notice Goal-or-refund crowdfunding. Creators publish campaigns; backers pledge ETH.
///         If goal met by deadline, creator claims; otherwise backers refund their pledge.
contract Crowdfunding is ReentrancyGuard {
    struct Campaign {
        address creator;
        uint128 goal;
        uint128 pledged;
        uint64 deadline;
        bool claimed;
        string metadataURI;
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => mapping(address => uint256)) public pledgesOf;

    event CampaignCreated(
        uint256 indexed id,
        address indexed creator,
        uint128 goal,
        uint64 deadline,
        string metadataURI
    );
    event Pledged(uint256 indexed id, address indexed backer, uint256 amount, uint128 newTotal);
    event Claimed(uint256 indexed id, address indexed creator, uint256 amount);
    event Refunded(uint256 indexed id, address indexed backer, uint256 amount);

    error InvalidGoal();
    error InvalidDeadline();
    error CampaignNotFound();
    error CampaignEnded();
    error CampaignActive();
    error ZeroPledge();
    error NotCreator();
    error AlreadyClaimed();
    error GoalNotMet();
    error GoalMet();
    error NoPledge();
    error TransferFailed();

    /// @notice Create a new campaign.
    /// @param goal Funding goal in wei. Must be > 0.
    /// @param deadline Unix timestamp at which pledging closes. Must be in the future.
    /// @param metadataURI IPFS or HTTPS URI pointing to off-chain metadata (title, description, image).
    /// @return id The new campaign's id.
    function createCampaign(uint128 goal, uint64 deadline, string calldata metadataURI) external returns (uint256 id) {
        if (goal == 0) revert InvalidGoal();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        id = campaignCount;
        _campaigns[id] = Campaign({
            creator: msg.sender,
            goal: goal,
            pledged: 0,
            deadline: deadline,
            claimed: false,
            metadataURI: metadataURI
        });
        unchecked {
            campaignCount = id + 1;
        }
        emit CampaignCreated(id, msg.sender, goal, deadline, metadataURI);
    }

    /// @notice Pledge ETH to a campaign. Pledges before the deadline only.
    function pledge(uint256 id) external payable {
        Campaign storage c = _loaded(id);
        if (block.timestamp >= c.deadline) revert CampaignEnded();
        if (msg.value == 0) revert ZeroPledge();

        c.pledged += uint128(msg.value);
        pledgesOf[id][msg.sender] += msg.value;

        emit Pledged(id, msg.sender, msg.value, c.pledged);
    }

    /// @notice Creator claims funds after deadline if goal met.
    function claim(uint256 id) external nonReentrant {
        Campaign storage c = _loaded(id);
        if (msg.sender != c.creator) revert NotCreator();
        if (block.timestamp < c.deadline) revert CampaignActive();
        if (c.pledged < c.goal) revert GoalNotMet();
        if (c.claimed) revert AlreadyClaimed();

        c.claimed = true;
        uint256 amount = c.pledged;

        (bool ok, ) = payable(c.creator).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(id, c.creator, amount);
    }

    /// @notice Backer refunds their pledge after deadline if goal not met.
    function refund(uint256 id) external nonReentrant {
        Campaign storage c = _loaded(id);
        if (block.timestamp < c.deadline) revert CampaignActive();
        if (c.pledged >= c.goal) revert GoalMet();

        uint256 amount = pledgesOf[id][msg.sender];
        if (amount == 0) revert NoPledge();

        pledgesOf[id][msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Refunded(id, msg.sender, amount);
    }

    /// @notice Read-only campaign accessor for clients and the indexer.
    function getCampaign(uint256 id) external view returns (Campaign memory) {
        if (id >= campaignCount) revert CampaignNotFound();
        return _campaigns[id];
    }

    function _loaded(uint256 id) private view returns (Campaign storage c) {
        if (id >= campaignCount) revert CampaignNotFound();
        c = _campaigns[id];
    }
}
