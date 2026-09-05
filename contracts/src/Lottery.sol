// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";

/// @title Monad Blitz — 押金托管 + 可验证随机数抽奖
/// @notice 单合约、无 owner、无 setter、无 withdraw；全部参数 immutable。
///         双模式准入（线上无许可 / 线下 issuer 验签）· 链上集熵（entropyRoot）· 双账本资金核算。
contract Lottery is IEntropyConsumer, ReentrancyGuard {
    // ---------------------------------------------------------------------------------------------
    // 类型
    // ---------------------------------------------------------------------------------------------

    enum Status {
        Open, // register / submitEntropy / fundPrizePool 可用
        Drawing, // 等待 Entropy 回调；超时后可重试 draw
        Drawn // claimDeposit / claimPrize 可用；fundPrizePool 拒绝
    }

    // ---------------------------------------------------------------------------------------------
    // immutable 部署参数（无 setter，无 owner）
    // ---------------------------------------------------------------------------------------------

    /// @notice 零地址 = 线上无许可模式；非零 = 线下验签模式
    address public immutable issuer;
    /// @notice Pyth Entropy 入口（V2）
    IEntropyV2 public immutable entropy;
    /// @notice Entropy provider
    address public immutable entropyProvider;
    /// @notice 每人押金（wei）
    uint256 public immutable depositAmount;
    /// @notice 开奖最早可触发时间
    uint256 public immutable drawTime;
    /// @notice Entropy 请求超时（超时后可重新 draw，重新缴费）
    uint256 public immutable entropyTimeout;
    /// @notice 中奖人数（>=1），实际中奖人数 = min(winnerCount, 参与人数)
    uint256 public immutable winnerCount;

    /// @notice 回调 gasLimit（含费返还转账 + winnerCount 轮洗牌与名单写入）
    uint32 private constant CALLBACK_GAS_LIMIT = 250_000;

    // ---------------------------------------------------------------------------------------------
    // 资格账本
    // ---------------------------------------------------------------------------------------------

    address[] public participants;
    mapping(address => bool) public registered;
    mapping(address => bool) public depositClaimed;
    uint256 public totalDepositsRemaining;

    // ---------------------------------------------------------------------------------------------
    // 奖池账本
    // ---------------------------------------------------------------------------------------------

    /// @notice fundPrizePool 注入 + draw 超额 msg.value 累计（毛额）
    uint256 public prizePoolReceived;
    /// @notice 已从奖池实际返还给触发者的请求费
    uint256 public feesRefunded;
    /// @notice 已派发奖金累计（prizePerWinner × 已领人数）
    uint256 public prizesPaidOut;

    // ---------------------------------------------------------------------------------------------
    // 随机数
    // ---------------------------------------------------------------------------------------------

    Status public status;
    address[] public winners;
    uint256 public prizePerWinner;
    mapping(address => bool) public isWinner;
    mapping(address => bool) public prizeClaimed;
    /// @notice 链上集熵累积哈希（ADR 0003）：keccak(entropyRoot || e) 链式累积
    bytes32 public entropyRoot;
    /// @notice 已提交熵条数
    uint256 public entropyCount;
    /// @notice 当前 Entropy 请求序号
    uint64 public entropySeq;
    uint256 public drawRequestedAt;
    address public drawRequester;
    /// @notice 本次请求垫付的费（回调成功后 best-effort 返还）
    uint128 public entropyFeePaid;
    /// @notice 本次请求的 userSeed（回调时入事件，供链下审计复现）
    bytes32 private drawUserSeed;

    // ---------------------------------------------------------------------------------------------
    // 事件
    // ---------------------------------------------------------------------------------------------

    event Registered(address indexed participant);
    event EntropySubmitted(address indexed participant, bytes32 entropy, uint256 index);
    event PrizePoolFunded(address indexed sponsor, uint256 amount);
    event DrawRequested(uint64 indexed sequenceNumber, bytes32 userSeed, bytes32 entropyRoot);
    event WinnersSelected(address[] winners, bytes32 randomNumber, bytes32 userSeed);
    event DepositClaimed(address indexed participant, uint256 amount);
    event PrizeClaimed(address indexed winner, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // 构造
    // ---------------------------------------------------------------------------------------------

    constructor(
        address issuer_, // address(0) = 线上模式；工作人员密钥地址 = 线下模式
        address entropy_, // Entropy 合约入口
        address provider_, // Entropy provider
        uint256 drawTime_, // 正式 = now + 3 days；演示 = now + 3 min
        uint256 depositAmount_, // 10e18
        uint256 entropyTimeout_, // 演示 = 2 min
        uint256 winnerCount_ // 中奖人数 >= 1，均分奖池
    ) {
        require(entropy_ != address(0), "zero entropy");
        require(provider_ != address(0), "zero provider");
        require(drawTime_ > block.timestamp, "draw time past");
        require(depositAmount_ > 0, "zero deposit");
        require(entropyTimeout_ > 0, "zero timeout");
        require(winnerCount_ >= 1, "winner count < 1");

        issuer = issuer_;
        entropy = IEntropyV2(entropy_);
        entropyProvider = provider_;
        drawTime = drawTime_;
        depositAmount = depositAmount_;
        entropyTimeout = entropyTimeout_;
        winnerCount = winnerCount_;
    }

    /// @dev IEntropyConsumer 要求：回调鉴权依据
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    // ---------------------------------------------------------------------------------------------
    // 资格：注册 + 押金托管
    // ---------------------------------------------------------------------------------------------

    /// @notice 注册 + 押金托管。线下模式 sig 必填，线上模式忽略。
    ///         sig 打包格式（97 字节）: abi.encodePacked(uint256(expiry), ecdsaSig(65))
    ///         签名内容: keccak256(abi.encodePacked(participant, address(this), expiry))
    ///         防重放：签名绑定本合约地址（活动 ID）+ 有效期 block.timestamp <= expiry
    function register(bytes calldata sig) external payable {
        require(status == Status.Open, "not open");
        require(block.timestamp < drawTime, "draw time passed");
        require(!registered[msg.sender], "already registered");
        require(msg.value == depositAmount, "wrong deposit");

        if (issuer != address(0)) {
            require(sig.length == 97, "bad sig length");
            uint256 expiry = uint256(bytes32(sig[0:32]));
            require(block.timestamp <= expiry, "expired");
            bytes32 digest = keccak256(abi.encodePacked(msg.sender, address(this), expiry));
            address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), sig[32:]);
            require(signer == issuer, "bad sig");
        }

        registered[msg.sender] = true;
        participants.push(msg.sender);
        totalDepositsRemaining += depositAmount;

        emit Registered(msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // 链上集熵（ADR 0003）
    // ---------------------------------------------------------------------------------------------

    /// @notice 链上集熵提交。仅限已注册地址，仅 Open 期间。
    function submitEntropy(bytes32 e) external {
        require(status == Status.Open, "not open");
        require(registered[msg.sender], "not registered");
        require(e != bytes32(0), "zero entropy");

        entropyRoot = keccak256(abi.encodePacked(entropyRoot, e));
        entropyCount += 1;

        emit EntropySubmitted(msg.sender, e, entropyCount);
    }

    // ---------------------------------------------------------------------------------------------
    // 奖池
    // ---------------------------------------------------------------------------------------------

    /// @notice 注入奖池。任何人可调用。Open/Drawing 可用；Drawn 后拒绝（派奖以快照为准，防资金滞留）。
    function fundPrizePool() external payable {
        require(status != Status.Drawn, "drawn");
        require(msg.value > 0, "zero value");

        prizePoolReceived += msg.value;

        emit PrizePoolFunded(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------------------------------
    // 开奖
    // ---------------------------------------------------------------------------------------------

    /// @notice 触发开奖。任何人可调用（permissionless）。
    ///         entropyRoot 非零时强制 userSeed == entropyRoot（现场模式）；为零时接受任意 seed（定时模式承诺值）。
    ///         msg.value >= getFeeV2(gasLimit)，超额部分计入奖池毛额。
    function draw(bytes32 userSeed) external payable {
        require(participants.length > 0, "no participants");
        require(block.timestamp >= drawTime, "too early");
        require(
            status == Status.Open
                || (status == Status.Drawing && block.timestamp - drawRequestedAt > entropyTimeout),
            "drawing in progress"
        );
        if (entropyRoot != bytes32(0)) {
            require(userSeed == entropyRoot, "seed != entropyRoot");
        }

        uint128 fee = entropy.getFeeV2(entropyProvider, CALLBACK_GAS_LIMIT);
        require(msg.value >= fee, "insufficient fee");

        // 超额部分计入奖池毛额
        if (msg.value > fee) {
            prizePoolReceived += msg.value - fee;
        }

        // 超时重试时旧在途费直接作废（已消耗于 Entropy，无法返还；旧请求迟到回调被 seq 校验拒绝）
        entropyFeePaid = fee;
        drawRequestedAt = block.timestamp;
        drawRequester = msg.sender;
        drawUserSeed = userSeed;
        status = Status.Drawing;

        entropySeq = entropy.requestV2{value: fee}(entropyProvider, userSeed, CALLBACK_GAS_LIMIT);

        emit DrawRequested(entropySeq, userSeed, entropyRoot);
    }

    /// @notice Entropy 回调（V2）。SDK 基类 _entropyCallback 已保证仅接受 Entropy 合约发起的回调。
    function entropyCallback(uint64 sequenceNumber, address /*provider*/, bytes32 randomNumber)
        internal
        override
    {
        require(status == Status.Drawing, "not drawing");
        require(sequenceNumber == entropySeq, "bad sequence");

        // ---- 1) 请求费返还（best-effort）：奖池充足时返还给触发者，不足时跳过，回调不 revert ----
        //      先于快照执行：均分基数即返还后的池子余额。
        uint128 fee = entropyFeePaid;
        entropyFeePaid = 0;
        // 重入窗口：status 仍为 Drawing，claim* / register / submitEntropy / draw 全部拒绝，
        // 仅 fundPrizePool 可进（自愿加钱，无资金损害）。
        if (fee > 0 && prizePoolReceived - feesRefunded - prizesPaidOut >= fee) {
            (bool ok,) = drawRequester.call{value: fee}("");
            if (ok) {
                feesRefunded += fee; // 仅实际转出时记账，保持不变式
            }
        }

        // ---- 2) 多中奖者抽取：以 randomNumber 为种子做部分 Fisher-Yates 洗牌，取前 n 位 ----
        //      确定性、不重复，任何人可按同一随机数在链下复现审计。
        address[] memory pool = participants;
        uint256 total = pool.length;
        uint256 n = winnerCount < total ? winnerCount : total;

        bytes32 rand = randomNumber;
        for (uint256 i = 0; i < n; i++) {
            rand = keccak256(abi.encodePacked(rand));
            uint256 j = i + (uint256(rand) % (total - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }

        winners = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            winners[i] = pool[i];
            isWinner[pool[i]] = true;
        }

        // ---- 3) 开奖时刻奖池快照均分 ----
        prizePerWinner = prizePoolAvailable() / n;
        status = Status.Drawn;

        emit WinnersSelected(winners, randomNumber, drawUserSeed);
    }

    // ---------------------------------------------------------------------------------------------
    // 领取（pull 模式）
    // ---------------------------------------------------------------------------------------------

    /// @notice 领回押金（Drawn 后，每地址一次）
    function claimDeposit() external nonReentrant {
        require(status == Status.Drawn, "not drawn");
        require(registered[msg.sender], "not registered");
        require(!depositClaimed[msg.sender], "already claimed");

        depositClaimed[msg.sender] = true;
        totalDepositsRemaining -= depositAmount;

        emit DepositClaimed(msg.sender, depositAmount);

        (bool ok,) = msg.sender.call{value: depositAmount}("");
        require(ok, "deposit transfer failed");
    }

    /// @notice 中奖者领奖（均分快照，每地址一次）
    function claimPrize() external nonReentrant {
        require(status == Status.Drawn, "not drawn");
        require(isWinner[msg.sender], "not winner");
        require(!prizeClaimed[msg.sender], "already claimed");

        prizeClaimed[msg.sender] = true;
        prizesPaidOut += prizePerWinner;

        emit PrizeClaimed(msg.sender, prizePerWinner);

        (bool ok,) = msg.sender.call{value: prizePerWinner}("");
        require(ok, "prize transfer failed");
    }

    // ---------------------------------------------------------------------------------------------
    // 视图
    // ---------------------------------------------------------------------------------------------

    /// @notice 奖池可派奖余额 = 毛额 - 已返费 - 已派奖
    ///         （在途请求费由触发者垫付、从未计入毛额，不参与扣减；不变式
    ///          balance == totalDepositsRemaining + prizePoolAvailable() 恒成立）
    function prizePoolAvailable() public view returns (uint256) {
        return prizePoolReceived - feesRefunded - prizesPaidOut;
    }

    function participantsLength() external view returns (uint256) {
        return participants.length;
    }

    function winnersList() external view returns (address[] memory) {
        return winners;
    }
}
