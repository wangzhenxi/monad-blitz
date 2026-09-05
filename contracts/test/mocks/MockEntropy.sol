// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

/// @title Pyth Entropy V2 最小 mock（测试用）
/// @notice 仅实现 Lottery 用到的接口子集：getFeeV2(provider, gasLimit) 与 requestV2(provider, userSeed, gasLimit)。
///         reveal() 模拟 provider 侧回调：以 Entropy 合约身份调用 consumer._entropyCallback。
contract MockEntropy {
    uint64 public nextSeq = 1;
    uint128 public fee = 0.1 ether;

    mapping(uint64 => address) public consumers;
    mapping(uint64 => bytes32) public seeds;
    mapping(uint64 => uint256) public paidValues;

    event Requested(
        uint64 indexed seq, address indexed consumer, address provider, bytes32 userSeed, uint256 value
    );

    function getFeeV2(address /*provider*/, uint32 /*gasLimit*/) external view returns (uint128) {
        return fee;
    }

    function requestV2(address provider, bytes32 userSeed, uint32 /*gasLimit*/)
        external
        payable
        returns (uint64)
    {
        require(msg.value >= fee, "insufficient fee");
        uint64 seq = nextSeq++;
        consumers[seq] = msg.sender;
        seeds[seq] = userSeed;
        paidValues[seq] = msg.value;
        emit Requested(seq, msg.sender, provider, userSeed, msg.value);
        return seq;
    }

    /// @notice 模拟 Entropy 回调（调用者扮演 Entropy 合约本身）
    function reveal(uint64 seq, bytes32 randomNumber) external {
        IEntropyConsumer(consumers[seq])._entropyCallback(seq, address(1), randomNumber);
    }
}
