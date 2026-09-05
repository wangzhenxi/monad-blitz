// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {Lottery} from "src/Lottery.sol";
import {MockEntropy} from "test/mocks/MockEntropy.sol";

contract LotteryTest is Test {
    // ---------- 参与者 ----------
    address immutable ALICE = makeAddr("alice");
    address immutable BOB = makeAddr("bob");
    address immutable CAROL = makeAddr("carol");
    address immutable DAVE = makeAddr("dave");
    address immutable EVE = makeAddr("eve"); // 非注册者/赞助方
    address immutable ATTACKER = makeAddr("attacker");

    // ---------- issuer（线下模式） ----------
    uint256 constant ISSUER_KEY = 0xA11CE;
    address issuer;

    MockEntropy entropy;
    Lottery lottery;

    uint256 constant DEPOSIT = 1 ether;
    uint256 constant TIMEOUT = 2 minutes;
    uint256 constant DRAW_DELAY = 3 minutes;
    uint256 drawAt; // block.timestamp + DRAW_DELAY
    uint256 constant FEE = 0.1 ether; // MockEntropy.fee

    function setUp() public {
        issuer = vm.addr(ISSUER_KEY);
        entropy = new MockEntropy();
        drawAt = block.timestamp + DRAW_DELAY;
        // 默认线上无许可模式（issuer = 0），winnerCount = 3
        lottery = _deploy(address(0), 3);
    }

    // ---------------------------------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------------------------------

    function _deploy(address issuer_, uint256 winnerCount_) internal returns (Lottery) {
        return new Lottery(
            issuer_,
            address(entropy),
            address(1), // provider
            drawAt,
            DEPOSIT,
            TIMEOUT,
            winnerCount_
        );
    }

    /// @dev 生成线下模式签名（97 字节：expiry ++ r ++ s ++ v）
    function _makeSig(address participant, uint256 expiry) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(participant, address(lottery), expiry));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(ISSUER_KEY, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(uint256(expiry), r, s, v);
    }

    function _register(address p) internal {
        vm.deal(p, DEPOSIT + 1 ether);
        vm.prank(p);
        lottery.register{value: DEPOSIT}("");
    }

    function _registerSigned(address p, uint256 expiry) internal {
        vm.deal(p, DEPOSIT + 1 ether);
        bytes memory sig = _makeSig(p, expiry);
        vm.prank(p);
        lottery.register{value: DEPOSIT}(sig);
    }

    function _fund(address sponsor, uint256 amount) internal {
        vm.deal(sponsor, amount + 1 ether);
        vm.prank(sponsor);
        lottery.fundPrizePool{value: amount}();
    }

    function _draw(address trigger) internal {
        uint128 fee = entropy.getFeeV2(address(1), 250_000);
        if (trigger.balance < fee) {
            vm.deal(trigger, fee);
        }
        bytes32 seed = lottery.entropyRoot(); // 先取值，避免消耗 prank
        vm.prank(trigger);
        lottery.draw{value: fee}(seed);
    }

    /// @dev 4 人注册 + 赞助奖池 10 ETH
    function _fullHouse() internal {
        _register(ALICE);
        _register(BOB);
        _register(CAROL);
        _register(DAVE);
        deal(EVE, 100 ether);
        _fund(EVE, 10 ether);
    }

    /// @dev 双账本不变式断言（§2.6）
    function _assertInvariant() internal view {
        assertEq(
            address(lottery).balance,
            lottery.totalDepositsRemaining() + lottery.prizePoolAvailable(),
            "ledger invariant broken"
        );
    }

    /// @dev 以 randomNumber 链下复现洗牌（§5.1 审计复现测试）
    function _replayWinners(address[] memory participants_, bytes32 randomNumber, uint256 winnerCnt)
        internal
        pure
        returns (address[] memory)
    {
        uint256 total = participants_.length;
        uint256 n = winnerCnt < total ? winnerCnt : total;
        bytes32 rand = randomNumber;
        for (uint256 i = 0; i < n; i++) {
            rand = keccak256(abi.encodePacked(rand));
            uint256 j = i + (uint256(rand) % (total - i));
            (participants_[i], participants_[j]) = (participants_[j], participants_[i]);
        }
        address[] memory result = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            result[i] = participants_[i];
        }
        return result;
    }

    function _participantsList() internal view returns (address[] memory) {
        uint256 len = lottery.participantsLength();
        address[] memory list = new address[](len);
        for (uint256 i; i < len; i++) {
            list[i] = lottery.participants(i);
        }
        return list;
    }

    // ---------------------------------------------------------------------------------------------
    // 1) 资格：注册
    // ---------------------------------------------------------------------------------------------

    function test_Register_DepositAmountMismatch() public {
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        vm.expectRevert(bytes("wrong deposit"));
        lottery.register{value: DEPOSIT - 1}("");
    }

    function test_Register_Success() public {
        vm.expectEmit(true, false, false, true);
        emit Lottery.Registered(ALICE);
        _register(ALICE);

        assertTrue(lottery.registered(ALICE));
        assertEq(lottery.participantsLength(), 1);
        assertEq(lottery.totalDepositsRemaining(), DEPOSIT);
        _assertInvariant();
    }

    function test_Register_Duplicate() public {
        _register(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(bytes("already registered"));
        lottery.register{value: DEPOSIT}("");
    }

    function test_Register_AfterDrawn() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(42)));

        vm.deal(ATTACKER, 10 ether);
        vm.prank(ATTACKER);
        vm.expectRevert(bytes("not open"));
        lottery.register{value: DEPOSIT}("");
    }

    function test_Register_AfterDrawTimePassed() public {
        vm.warp(drawAt + 1);
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        vm.expectRevert(bytes("draw time passed"));
        lottery.register{value: DEPOSIT}("");
    }

    // ---------------------------------------------------------------------------------------------
    // 2) 线下模式验签
    // ---------------------------------------------------------------------------------------------

    function test_Register_Offline_ValidSig() public {
        lottery = _deploy(issuer, 3);
        uint256 expiry = block.timestamp + 1 days;

        vm.expectEmit(true, false, false, true);
        emit Lottery.Registered(ALICE);
        _registerSigned(ALICE, expiry);
        assertTrue(lottery.registered(ALICE));
    }

    function test_Register_Offline_Expired() public {
        lottery = _deploy(issuer, 3);
        // expiry 须短于 drawTime，使"过期"先于"开奖时间已过"触发
        uint256 expiry = block.timestamp + 1 minutes;
        vm.deal(ALICE, 10 ether);

        bytes memory sig = _makeSig(ALICE, expiry);
        vm.warp(expiry + 1);
        vm.prank(ALICE);
        vm.expectRevert(bytes("expired"));
        lottery.register{value: DEPOSIT}(sig);
    }

    function test_Register_Offline_ForgedSig() public {
        lottery = _deploy(issuer, 3);
        uint256 expiry = block.timestamp + 1 days;
        vm.deal(BOB, 10 ether);

        // ALICE 的签名被 BOB 使用
        bytes memory sig = _makeSig(ALICE, expiry);
        vm.prank(BOB);
        vm.expectRevert(); // ECDSA.recover 失败或 bad sig
        lottery.register{value: DEPOSIT}(sig);
    }

    function test_Register_Offline_ReplayToOtherLottery() public {
        lottery = _deploy(issuer, 3);
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _makeSig(ALICE, expiry);

        // 另一期活动（不同合约地址）上重放同一签名 → digest 绑定 address(this) 拒绝
        Lottery lottery2 = _deploy(issuer, 3);
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        vm.expectRevert();
        lottery2.register{value: DEPOSIT}(sig);
    }

    function test_Register_Offline_SigRequired() public {
        lottery = _deploy(issuer, 3);
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        vm.expectRevert(bytes("bad sig length"));
        lottery.register{value: DEPOSIT}("");
    }

    function test_Register_Offline_BadSigLength() public {
        lottery = _deploy(issuer, 3);
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        vm.expectRevert(bytes("bad sig length"));
        lottery.register{value: DEPOSIT}(hex"deadbeef");
    }

    // ---------------------------------------------------------------------------------------------
    // 3) 链上集熵
    // ---------------------------------------------------------------------------------------------

    function test_SubmitEntropy_Accumulates() public {
        _register(ALICE);
        _register(BOB);

        vm.prank(ALICE);
        lottery.submitEntropy(bytes32(uint256(1)));
        vm.prank(BOB);
        lottery.submitEntropy(bytes32(uint256(2)));

        assertEq(lottery.entropyCount(), 2);
        bytes32 expectRoot = keccak256(abi.encodePacked(bytes32(0), bytes32(uint256(1))));
        expectRoot = keccak256(abi.encodePacked(expectRoot, bytes32(uint256(2))));
        assertEq(lottery.entropyRoot(), expectRoot);
    }

    function test_SubmitEntropy_NotRegistered() public {
        vm.prank(EVE);
        vm.expectRevert(bytes("not registered"));
        lottery.submitEntropy(bytes32(uint256(1)));
    }

    function test_SubmitEntropy_AfterDrawn() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(42)));

        vm.prank(ALICE);
        vm.expectRevert(bytes("not open"));
        lottery.submitEntropy(bytes32(uint256(1)));
    }

    function test_SubmitEntropy_ZeroValue() public {
        _register(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(bytes("zero entropy"));
        lottery.submitEntropy(bytes32(0));
    }

    // ---------------------------------------------------------------------------------------------
    // 4) 状态机
    // ---------------------------------------------------------------------------------------------

    function test_Draw_TooEarly() public {
        _fullHouse();
        vm.warp(drawAt - 1);
        vm.deal(EVE, 1 ether);
        vm.prank(EVE);
        vm.expectRevert(bytes("too early"));
        lottery.draw{value: FEE}(bytes32(uint256(1)));
    }

    function test_Draw_NoParticipants() public {
        vm.warp(drawAt);
        vm.deal(EVE, 1 ether);
        vm.prank(EVE);
        vm.expectRevert(bytes("no participants"));
        lottery.draw{value: FEE}(bytes32(uint256(1)));
    }

    function test_Draw_WhileDrawing_NotTimedOut() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);

        vm.deal(ATTACKER, 1 ether);
        vm.prank(ATTACKER);
        vm.expectRevert(bytes("drawing in progress"));
        lottery.draw{value: FEE}(bytes32(uint256(1)));
    }

    function test_Draw_TimeoutRetry() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        uint64 seq1 = lottery.entropySeq();

        // 未超时不可重试
        vm.warp(block.timestamp + TIMEOUT - 1);
        vm.deal(ATTACKER, 1 ether);
        vm.prank(ATTACKER);
        vm.expectRevert(bytes("drawing in progress"));
        lottery.draw{value: FEE}(bytes32(uint256(1)));

        // 超时后重试成功，旧请求迟到回调被 seq 拒绝
        vm.warp(block.timestamp + 2);
        _draw(ATTACKER);
        uint64 seq2 = lottery.entropySeq();
        assertGt(seq2, seq1);

        vm.prank(ATTACKER);
        vm.expectRevert(bytes("bad sequence"));
        entropy.reveal(seq1, bytes32(uint256(999)));

        entropy.reveal(seq2, bytes32(uint256(7)));
        assertEq(uint8(lottery.status()), uint8(Lottery.Status.Drawn));
        _assertInvariant();
    }

    function test_Draw_RequiresEntropyRootWhenNonZero() public {
        _fullHouse();
        vm.prank(ALICE);
        lottery.submitEntropy(bytes32(uint256(123)));

        vm.warp(drawAt);
        vm.deal(EVE, 1 ether);
        vm.prank(EVE);
        vm.expectRevert(bytes("seed != entropyRoot"));
        lottery.draw{value: FEE}(bytes32(uint256(999)));

        // 与熵根一致则通过
        vm.prank(EVE);
        lottery.draw{value: FEE}(lottery.entropyRoot());
    }

    function test_Draw_InsufficientFee() public {
        _fullHouse();
        vm.warp(drawAt);
        vm.deal(EVE, 1 ether);
        vm.prank(EVE);
        vm.expectRevert(bytes("insufficient fee"));
        lottery.draw{value: FEE - 1}(bytes32(uint256(1)));
    }

    function test_Draw_ExcessValueCreditedToPool() public {
        _fullHouse();
        vm.warp(drawAt);
        uint256 before = lottery.prizePoolReceived();

        vm.deal(EVE, 10 ether);
        vm.prank(EVE);
        lottery.draw{value: FEE + 1.5 ether}(lottery.entropyRoot());

        assertEq(lottery.prizePoolReceived(), before + 1.5 ether);
        _assertInvariant();
    }

    function test_Callback_ReplayRejected() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        uint64 seq = lottery.entropySeq();
        entropy.reveal(seq, bytes32(uint256(42)));
        assertEq(uint8(lottery.status()), uint8(Lottery.Status.Drawn));

        // 同一回调重放：状态已 Drawn
        vm.expectRevert(bytes("not drawing"));
        entropy.reveal(seq, bytes32(uint256(42)));
    }

    function test_Callback_ForgedCallerRejected() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);

        // 攻击者直接调用 lottery._entropyCallback 伪造回调（基类鉴权：msg.sender != entropy）
        vm.prank(ATTACKER);
        (bool ok,) = address(lottery).call(
            abi.encodeWithSignature(
                "_entropyCallback(uint64,address,bytes32)",
                lottery.entropySeq(),
                address(1),
                bytes32(uint256(42))
            )
        );
        assertFalse(ok, "forged callback must be rejected");
        assertEq(uint8(lottery.status()), uint8(Lottery.Status.Drawing));
    }

    function test_FundPrizePool_AfterDrawn() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(42)));

        vm.deal(EVE, 100 ether);
        vm.prank(EVE);
        vm.expectRevert(bytes("drawn"));
        lottery.fundPrizePool{value: 1 ether}();
    }

    function test_FundPrizePool_DuringDrawing() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE); // Drawing 中

        vm.deal(EVE, 100 ether);
        vm.prank(EVE);
        lottery.fundPrizePool{value: 1 ether}(); // 允许（快照在回调时刻定格）
        assertEq(lottery.prizePoolReceived(), 11 ether);
        _assertInvariant();
    }

    // ---------------------------------------------------------------------------------------------
    // 5) 多中奖者与均分
    // ---------------------------------------------------------------------------------------------

    function test_MultiWinner_DistinctAndReplayable() public {
        _fullHouse(); // 4 注册者，winnerCount = 3
        vm.warp(drawAt);
        _draw(EVE);

        bytes32 randomNumber = bytes32(uint256(0xBEEF));
        entropy.reveal(lottery.entropySeq(), randomNumber);

        // 中奖名单链下复现
        address[] memory expect = _replayWinners(_participantsList(), randomNumber, 3);
        address[] memory actual = lottery.winnersList();
        assertEq(actual.length, 3);
        for (uint256 i; i < 3; i++) {
            assertEq(actual[i], expect[i]);
            assertTrue(lottery.isWinner(expect[i]));
        }
        // 不重复
        assertFalse(actual[0] == actual[1] || actual[0] == actual[2] || actual[1] == actual[2]);
    }

    function test_MultiWinner_PrizePerWinner() public {
        _fullHouse(); // 奖池 10 ETH，winnerCount = 3
        vm.warp(drawAt);
        address trigger = EVE;
        _draw(trigger);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        // 返还费 0.1 后：(10 - 0.1) / 3
        assertEq(lottery.prizePerWinner(), 9.9 ether / 3);

        // 中奖者各领 3.3 ETH
        address[] memory ws = lottery.winnersList();
        for (uint256 i; i < ws.length; i++) {
            uint256 wbal = ws[i].balance;
            vm.prank(ws[i]);
            lottery.claimPrize();
            assertEq(ws[i].balance - wbal, lottery.prizePerWinner());
        }
        // 尾差滞留 = (10 - 0.1) % 3 = 0（9.9 / 3 整除）
        // 未中奖者领回押金
        address loser = _findLoser();
        uint256 lbal = loser.balance;
        vm.prank(loser);
        lottery.claimDeposit();
        assertEq(loser.balance - lbal, DEPOSIT);

        _assertInvariant();
    }

    function test_ClaimPrize_Twice() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        address w = lottery.winnersList()[0];
        vm.prank(w);
        lottery.claimPrize();
        vm.prank(w);
        vm.expectRevert(bytes("already claimed"));
        lottery.claimPrize();
    }

    function test_ClaimPrize_NotWinner() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        address loser = _findLoser();
        vm.prank(loser);
        vm.expectRevert(bytes("not winner"));
        lottery.claimPrize();
    }

    function test_ClaimDeposit_Twice() public {
        _fullHouse();
        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        address loser = _findLoser();
        vm.prank(loser);
        lottery.claimDeposit();
        vm.prank(loser);
        vm.expectRevert(bytes("already claimed"));
        lottery.claimDeposit();
    }

    function test_WinnerCountExceedsParticipants() public {
        // winnerCount = 10 > 参与人数 2 → 全员中奖，不回滚
        lottery = _deploy(address(0), 10);
        _register(ALICE);
        _register(BOB);
        _fund(EVE, 6 ether);

        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(5)));

        address[] memory ws = lottery.winnersList();
        assertEq(ws.length, 2);
        assertTrue(lottery.isWinner(ALICE) && lottery.isWinner(BOB));
        assertEq(lottery.prizePerWinner(), (6 ether - FEE) / 2);
    }

    function test_DustRemainsInContract() public {
        // 奖池 1 wei + 10 ETH：10.000000000000000001 - 0.1 / 3 有尾差
        lottery = _deploy(address(0), 3);
        _register(ALICE);
        _register(BOB);
        _register(CAROL);
        _register(DAVE);
        _fund(EVE, 10 ether + 2 wei);

        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        address[] memory ws = lottery.winnersList();
        for (uint256 i; i < ws.length; i++) {
            vm.prank(ws[i]);
            lottery.claimPrize();
        }
        // 全员领回押金（winner 亦是注册者）
        address[] memory all = _participantsList();
        for (uint256 i; i < all.length; i++) {
            vm.prank(all[i]);
            lottery.claimDeposit();
        }

        uint256 dust = (10 ether + 2 wei - FEE) % 3;
        assertEq(address(lottery).balance, dust, "dust must remain");
        assertEq(lottery.prizePoolAvailable(), dust);
    }

    // ---------------------------------------------------------------------------------------------
    // 6) 费返还边界
    // ---------------------------------------------------------------------------------------------

    function test_FeeRefund_WhenPoolSufficient() public {
        _fullHouse();
        vm.warp(drawAt);
        address trigger = EVE;
        uint256 before = trigger.balance;
        _draw(trigger); // 垫付 0.1

        assertEq(lottery.entropyFeePaid(), FEE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        assertEq(lottery.feesRefunded(), FEE, "fee refunded");
        assertEq(trigger.balance, before, "trigger made whole");
        assertEq(lottery.entropyFeePaid(), 0);
        _assertInvariant();
    }

    function test_FeeRefund_EmptyPool_SkipWithoutRevert() public {
        // 空奖池：无人 fundPrizePool，draw 垫付费，回调不 revert、跳过返还
        _register(ALICE);
        _register(BOB);

        vm.warp(drawAt);
        address trigger = EVE;
        deal(trigger, 1 ether);
        uint256 before = trigger.balance;
        _draw(trigger);

        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        assertEq(uint8(lottery.status()), uint8(Lottery.Status.Drawn), "callback must not revert");
        assertEq(lottery.feesRefunded(), 0, "no refund");
        assertEq(trigger.balance, before - FEE, "trigger lost the fee");
        assertEq(lottery.prizePerWinner(), 0);
        _assertInvariant();
    }

    function test_FeeRefund_PoolSmallerThanFee() public {
        // 奖池 0.05 < 费 0.1 → 跳过返还，奖池全部分给中奖者
        lottery = _deploy(address(0), 1);
        _register(ALICE);
        _register(BOB);
        _fund(EVE, 0.05 ether);

        vm.warp(drawAt);
        _draw(EVE);
        entropy.reveal(lottery.entropySeq(), bytes32(uint256(1)));

        assertEq(lottery.feesRefunded(), 0);
        assertEq(lottery.prizePerWinner(), 0.05 ether, "whole pool to the winner");
        _assertInvariant();
    }

    // ---------------------------------------------------------------------------------------------
    // 7) 全流程不变式
    // ---------------------------------------------------------------------------------------------

    function test_FullFlow_InvariantEachStep() public {
        _fullHouse();
        _assertInvariant();

        vm.prank(ALICE);
        lottery.submitEntropy(bytes32(uint256(11)));
        vm.prank(BOB);
        lottery.submitEntropy(bytes32(uint256(22)));
        _assertInvariant();

        vm.warp(drawAt);
        _draw(EVE);
        _assertInvariant();

        entropy.reveal(lottery.entropySeq(), bytes32(uint256(33)));
        _assertInvariant();

        address[] memory ws = lottery.winnersList();
        for (uint256 i; i < ws.length; i++) {
            vm.prank(ws[i]);
            lottery.claimPrize();
            _assertInvariant();
        }
        // 全员领回押金（winner 亦是注册者）
        address[] memory all = _participantsList();
        for (uint256 i; i < all.length; i++) {
            vm.prank(all[i]);
            lottery.claimDeposit();
            _assertInvariant();
        }

        // 终态：合约余尾差
        assertEq(address(lottery).balance, (10 ether - FEE) % 3);
    }

    function _findLoser() internal view returns (address) {
        address[] memory all = _participantsList();
        for (uint256 i; i < all.length; i++) {
            if (!lottery.isWinner(all[i])) return all[i];
        }
        revert("no loser found");
    }
}
