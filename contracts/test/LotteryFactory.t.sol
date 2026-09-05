// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LotteryFactory} from "src/LotteryFactory.sol";
import {Lottery} from "src/Lottery.sol";

contract LotteryFactoryTest is Test {
    LotteryFactory internal factory;

    address internal constant ENTROPY = address(0xE1);
    address internal constant PROVIDER = address(0xE2);
    address internal constant ISSUER = address(0xE3);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        factory = new LotteryFactory();
    }

    function _args(uint256 drawDelay)
        internal
        view
        returns (address, address, address, uint256, uint256, uint256, uint256)
    {
        return (
            address(0), // 线上无许可
            ENTROPY,
            PROVIDER,
            block.timestamp + drawDelay,
            0.01 ether,
            120,
            1
        );
    }

    function _create(address sender) internal returns (address lotteryAddr) {
        vm.prank(sender);
        (
            address issuer,
            address entropy,
            address provider,
            uint256 drawTime,
            uint256 deposit,
            uint256 timeout,
            uint256 wc
        ) = _args(10 minutes);
        lotteryAddr = factory.createLottery(issuer, entropy, provider, drawTime, deposit, timeout, wc);
    }

    // ---------------------------------------------------------------------------------------------
    // createLottery
    // ---------------------------------------------------------------------------------------------

    function test_CreateLottery_DeploysAndRegisters() public {
        vm.expectEmit(false, true, false, true);
        emit LotteryFactory.LotteryCreated(address(0), ALICE, true); // 地址由后续断言覆盖
        address addr = _create(ALICE);

        assertTrue(addr != address(0));
        assertEq(factory.lotteriesLength(), 1);
        assertEq(factory.lotteries(0), addr);
        assertTrue(factory.registered(addr));
        assertEq(factory.creatorOf(addr), ALICE);

        // 部署的合约参数正确落位
        Lottery lottery = Lottery(addr);
        assertEq(lottery.depositAmount(), 0.01 ether);
        assertEq(lottery.winnerCount(), 1);
    }

    function test_CreateLottery_Multiple() public {
        address a = _create(ALICE);
        address b = _create(BOB);
        assertEq(factory.lotteriesLength(), 2);
        assertEq(factory.getLotteries()[0], a);
        assertEq(factory.getLotteries()[1], b);
        assertEq(factory.creatorOf(b), BOB);
    }

    // ---------------------------------------------------------------------------------------------
    // registerExisting
    // ---------------------------------------------------------------------------------------------

    function test_RegisterExisting_Success() public {
        // 手动部署一个 Lottery（不经工厂）
        (
            address issuer,
            address entropy,
            address provider,
            uint256 drawTime,
            uint256 deposit,
            uint256 timeout,
            uint256 wc
        ) = _args(1 hours);
        Lottery lottery = new Lottery(issuer, entropy, provider, drawTime, deposit, timeout, wc);

        vm.prank(BOB);
        vm.expectEmit(true, true, false, true);
        emit LotteryFactory.LotteryCreated(address(lottery), BOB, false);
        factory.registerExisting(address(lottery));

        assertEq(factory.lotteriesLength(), 1);
        assertEq(factory.creatorOf(address(lottery)), BOB);
        assertEq(factory.getLotteries()[0], address(lottery));
    }

    function test_RegisterExisting_RevertNotLottery() public {
        vm.prank(ALICE);
        vm.expectRevert(bytes("no code"));
        factory.registerExisting(address(0xBEEF)); // EOA 无代码

        // 部署一个非 Lottery 合约（另一个 factory 实例即可）
        LotteryFactory other = new LotteryFactory();
        vm.prank(ALICE);
        vm.expectRevert(bytes("not a lottery"));
        factory.registerExisting(address(other));
    }

    function test_RegisterExisting_RevertDuplicate() public {
        address a = _create(ALICE);
        vm.prank(BOB);
        vm.expectRevert(bytes("already registered"));
        factory.registerExisting(a);
    }
}
