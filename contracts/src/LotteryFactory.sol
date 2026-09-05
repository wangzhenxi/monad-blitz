// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Lottery} from "src/Lottery.sol";

/// @title Monad Blitz — Lottery 工厂：链上活动注册表
/// @notice 无 owner、无费用。createLottery 部署并登记活动；registerExisting 补录已有合约。
///         前端活动列表 = getLotteries() 直接读取（不依赖事件扫描，规避 Monad getLogs 100 块限制）。
contract LotteryFactory {
    /// @notice 全部活动（含补录），按登记顺序
    address[] public lotteries;
    /// @notice 活动 → 创建者/登记人（审计用）
    mapping(address => address) public creatorOf;
    /// @notice 活动 → 是否已登记（防重复）
    mapping(address => bool) public registered;

    /// @param created true = 经工厂部署；false = 补录已有合约
    event LotteryCreated(address indexed lottery, address indexed creator, bool created);

    /// @notice 部署新活动并登记（参数语义同 Lottery 构造函数）
    function createLottery(
        address issuer,
        address entropy,
        address provider,
        uint256 drawTime,
        uint256 depositAmount,
        uint256 entropyTimeout,
        uint256 winnerCount
    ) external returns (address lotteryAddr) {
        Lottery lottery = new Lottery(
            issuer, entropy, provider, drawTime, depositAmount, entropyTimeout, winnerCount
        );
        _register(address(lottery), true);
        return address(lottery);
    }

    /// @notice 补录链上已有的 Lottery（任何人可调用）。
    ///         用 issuer() 静态调用验证目标形似 Lottery，防垃圾地址注入列表。
    function registerExisting(address lotteryAddr) external {
        require(extcodesize(lotteryAddr) > 0, "no code");
        try Lottery(lotteryAddr).issuer() returns (address) {
            // 形似 Lottery，放行
        } catch {
            revert("not a lottery");
        }
        _register(lotteryAddr, false);
    }

    function _register(address lotteryAddr, bool created) internal {
        require(!registered[lotteryAddr], "already registered");
        registered[lotteryAddr] = true;
        creatorOf[lotteryAddr] = msg.sender;
        lotteries.push(lotteryAddr);

        emit LotteryCreated(lotteryAddr, msg.sender, created);
    }

    /// @notice 全量列表（前端直接 readContract，无需事件扫描）
    function getLotteries() external view returns (address[] memory) {
        return lotteries;
    }

    function lotteriesLength() external view returns (uint256) {
        return lotteries.length;
    }

    function extcodesize(address a) internal view returns (uint256 size) {
        assembly {
            size := extcodesize(a)
        }
    }
}
