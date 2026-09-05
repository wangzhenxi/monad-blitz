# Monad Blitz — 技术方案

> 版本：v1.2（2026-09-05：同步 winnerCount/均分/create 后核对修订——费返还 best-effort、版本头与 §1 遗留旧措辞清理）· 输入：[product-design.md](./product-design.md) · [CONTEXT.md](../CONTEXT.md) · [ADR 0001](./adr/0001-escrow-qualification.md) · [ADR 0002](./adr/0002-on-site-admission-signature.md) · [ADR 0003](./adr/0003-onchain-entropy-gathering.md) · [日程](./schedule.md)
>
> 本文档将产品设计稿翻译为可实现、可验证的工程方案。所有与产品文档的偏离均在 §8 显式登记。

---

## 1. 总体架构

```
┌─────────────────────────┐       ┌──────────────────────────┐
│  前端 (Next.js + wagmi)  │       │  外部依赖                  │
│  /      参与者主页面      │       │  Pyth Entropy 合约         │
│  /host  签发者工具页      │       │  (Monad testnet, 入口待验证)│
│  /gather 观众集熵页       │       │  WalletConnect relay      │
└───────────┬─────────────┘       └───────────┬──────────────┘
            │  交易 / 事件读取                  │ 异步回调
            ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│  Lottery.sol（单合约，无 owner 权限函数）                   │
│  双模式准入(issuer) · 链上集熵(entropyRoot) · 双账本        │
└─────────────────────────────────────────────────────────┘
```

**技术栈**（沿用现有仓库骨架）：

| 层 | 选型 | 说明 |
|---|---|---|
| 合约 | Solidity ^0.8.28 + Foundry + OpenZeppelin | OZ 仅用 ECDSA/ReentrancyGuard；**无 Ownable** |
| 随机数 | Pyth Entropy V2（`@pythnetwork/entropy-sdk-solidity`） | 入口/代际/费已实测（§4） |
| 前端 | Next.js + wagmi v2 + viem | 现有 web/ 骨架复用，页面重写 |
| 钱包 | injected + WalletConnect | 桌面录屏用 injected；现场观众手机扫码用 WalletConnect（已确认） |
| 读链 | wagmi 公共 client 直接读事件/视图 | 不引入 indexer，当天交付不需要 |
| 部署 | forge script + `.env` | 合约参数见 §6 |

---

## 2. 智能合约设计（Lottery.sol）

### 2.1 状态机与存储

```
enum Status { Open, Drawing, Drawn }

Open ──draw()──> Drawing ──entropy回调──> Drawn
                    │
                    └──超时(entropyTimeout)后可再次 draw()──> Drawing（重新请求）

Open 期间: register() / submitEntropy() / fundPrizePool() 随时可用
Drawing 期间: fundPrizePool() 仍可注入（快照在回调时刻才定格）
Drawn 期间: claimDeposit() / claimPrize()；fundPrizePool() 拒绝（派奖以快照为准，防资金滞留）
```

```solidity
// ---------- immutable 部署参数（无 setter，无 owner） ----------
address public immutable issuer;          // 零地址=线上无许可模式；非零=线下验签模式
IEntropy public immutable entropy;        // Pyth Entropy 入口（待 11:00 验证，见 §4）
address public immutable entropyProvider; // Pyth testnet 默认 provider
                                   //   0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
uint256 public immutable depositAmount;   // 10 MOD（演示/正式参数化）
uint256 public immutable drawTime;        // 开奖最早可触发时间
uint256 public immutable entropyTimeout;  // 请求 Entropy 后允许重试的等待时长

// ---------- 资格账本 ----------
address[] public participants;            // 有序名单，随机索引的基础
mapping(address => bool) public registered;
mapping(address => bool) public depositClaimed;
uint256 public totalDepositsRemaining;    // 未领取押金总额（账本核算用）

// ---------- 奖池账本 ----------
uint256 public prizePoolReceived;         // fundPrizePool 累计注入（毛额）
uint256 public feesRefunded;              // 已从奖池返还给触发者的请求费
uint256 public prizesPaidOut;             // 已派发奖金累计（prizePerWinner × 已领人数）

// ---------- 随机数 ----------
Status public status;                     // Open → Drawing → Drawn
address[] public winners;                 // 实际中奖者 = min(winnerCount, participants.length)
uint256 public immutable winnerCount;     // 中奖人数（部署参数，/create 页配置）
uint256 public prizePerWinner;            // 开奖时刻奖池快照 ÷ 实际中奖人数
mapping(address => bool) public isWinner;
mapping(address => bool) public prizeClaimed;
bytes32 public entropyRoot;               // 链上集熵累积哈希（ADR 0003）
uint64  public entropySeq;                // 当前 Entropy 请求序号
uint256 public drawRequestedAt;           // 用于超时重试判断
address public drawRequester;
uint128 public entropyFeePaid;            // 本次请求垫付的费（回调成功后返还）
```

### 2.2 函数清单

```solidity
constructor(
    address issuer_,        // address(0) 或工作人员密钥地址
    address entropy_,       // Entropy 合约入口
    address provider_,      // Entropy provider
    uint256 drawTime_,      // 正式 = now + 3 days；演示 = now + 3 min
    uint256 depositAmount_, // 10e18
    uint256 entropyTimeout_,// 演示 = 2 min
    uint256 winnerCount_    // 中奖人数 ≥ 1（/create 页配置），均分奖池
);

/// 注册 + 押金托管。线下模式 sig 必填，线上模式忽略。
/// 签名内容: keccak256(abi.encodePacked(participant, address(this), expiry))
/// 有效期: block.timestamp <= expiry（防重放：签名绑定本合约地址）
function register(bytes calldata sig) external payable;
    // require: status == Open || status == Drawn 前置不行——开奖后不可再注册
    //          => require(status == Open, "drawn"); require(block.timestamp < drawTime)
    //          require(!registered[msg.sender]); require(msg.value == depositAmount)
    //          线下模式: require(sig 有效且 expiry 未过)

/// 链上集熵提交（ADR 0003）。仅限已注册地址。
function submitEntropy(bytes32 e) external;
    // require(registered[msg.sender]); require(status == Open)
    // entropyRoot = keccak256(abi.encodePacked(entropyRoot, e));
    // emit EntropySubmitted(msg.sender, e, ++entropyCount)

/// 注入奖池。任何人（赞助方）。仅 Open/Drawing（Drawn 后拒绝：派奖以快照为准，防资金滞留）。
function fundPrizePool() external payable;

/// 触发开奖。任何人可调用（permissionless）。
function draw(bytes32 userSeed) external payable;
    // require: participants.length > 0; block.timestamp >= drawTime
    //          （winnerCount > 参与人数不回滚：回调时取 min，全员中奖，避免 drawTime 后无人可注册的死锁）
    //          status == Open || (status == Drawing && now - drawRequestedAt > entropyTimeout)
    //          熵根非零时强制: require(userSeed == entropyRoot)   // 现场模式
    // 请求费: msg.value >= entropy.getFeeV2(gasLimit)；超额部分计入奖池（prizePoolReceived）
    // 状态 → Drawing，记录 requester/fee/time，转发费给 Entropy 并请求随机数
    // emit DrawRequested(sequenceNumber, userSeed, entropyRoot)

/// Entropy 回调（V2: entropyCallback(uint64,address,bytes32) internal override，
///            继承 IEntropyConsumer，SDK 基类保证回调来源可信）
//  回调逻辑（多中奖者，均分奖池）:
//    n = min(winnerCount, participants.length)
//    以 randomNumber 为种子做部分 Fisher-Yates 洗牌（keccak 链式取数），取名单前 n 位为 winners
//      —— 确定性、不重复、任何人可按同一随机数在链下复现审计
//    prizePerWinner = prizePoolAvailable() / n      // 开奖时刻快照均分
//    status = Drawn
//    请求费返还: prizePool 记账扣减 feesRefunded += entropyFeePaid，转账给 drawRequester
//    emit WinnersSelected(winners, randomNumber, userSeed)

/// 领回押金（pull 模式）。
function claimDeposit() external nonReentrant;
    // require(status == Drawn && registered[msg.sender] && !depositClaimed[msg.sender])
    // totalDepositsRemaining -= depositAmount; 转账 depositAmount

/// 中奖者领奖（均分，pull 模式，每名一次）。
function claimPrize() external nonReentrant;
    // require(status == Drawn && isWinner[msg.sender] && !prizeClaimed[msg.sender])
    // prizesPaidOut += prizePerWinner; 转账 prizePerWinner
```

**事件**（前端与审计的数据源）：

```
Registered(address indexed participant)
EntropySubmitted(address indexed participant, bytes32 entropy, uint256 index)
PrizePoolFunded(address indexed sponsor, uint256 amount)
DrawRequested(uint64 indexed sequenceNumber, bytes32 userSeed, bytes32 entropyRoot)
WinnersSelected(address[] winners, bytes32 randomNumber, bytes32 userSeed)   // 中奖名单一次性公布（动态数组不可 indexed）
DepositClaimed(address indexed participant, uint256 amount)
PrizeClaimed(address indexed winner, uint256 amount)
```

### 2.3 双模式准入（依据 ADR 0002）

- `issuer == address(0)`：`register(sig)` 忽略 sig，无许可注册。
- `issuer != address(0)`：`ecrecover` 验签，签名由签发者工具页（`/host`）在浏览器本地生成，私钥不上传。
- 签名格式（最小实现，OZ `ECDSA.recover` + EIP-191 `toEthSignedMessageHash`）：

```solidity
bytes32 digest = keccak256(abi.encodePacked(msg.sender, address(this), expiry));
address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(digest), sig);
require(signer == issuer, "bad sig");
require(block.timestamp <= expiry, "expired");
```

> 绑定 `address(this)` 使签名天然绑定单期活动（即产品文档中的"活动 ID"），同一签名无法跨合约重放；`expiry` 由工具页默认设为活动当日结束。

### 2.4 链上集熵与熵根（依据 ADR 0003）

- 观众（须已注册）在 `/gather` 页提交熵 → `entropyRoot = keccak256(abi.encodePacked(entropyRoot, e))`。
- `entropyRoot != 0` 时 `draw` 强制 `userSeed == entropyRoot`（现场模式语义）；为零时接受任意 userSeed（定时模式公开承诺语义）。
- 前端同时展示熵根与各观众熵事件，触发者与观众可肉眼核对"现场熵确实进入了开奖"。

### 2.5 随机数集成（Pyth Entropy V2，已验证）

已验证事实（2026-09-05 链上实测，详见 §4）：

- 入口（ERC-1967 代理）：`0x825c0390f379C631f3Cf11A82a37D20BddF93c07`
- 实现合约：`0xdf21D137Aadc95588205586636710ca2890538d5`（Pyth 官方跨链标准实现）
- 接口代际：**V2**（`getFeeV2`/`requestV2` 全系选择器在位）
- 默认 provider：`0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344`（`getDefaultProvider()` 链上确认）
- 请求费：`getFeeV2()` 实测 **0.12816 MON**（动态值，以链上实时调用为准）

合约集成（SDK `@pythnetwork/entropy-sdk-solidity`）：

- 继承 `IEntropyConsumer`，实现 `entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) internal override`——SDK 基类自带回调来源鉴权，无需手写 `msg.sender` 校验
- 请求走全参形态 `requestV2(provider, userSeed, gasLimit)`，费用用 `getFeeV2(gasLimit)` 实时读取：必须携带 userSeed（定时模式 = 项目方公开承诺值；现场模式 = 链上熵根），这是"任何单方无法操纵"叙事的合约层落点
- gasLimit 建议 250000（回调含请求费返还转账 + winnerCount 轮洗牌循环与名单写入）
- `draw()` 要求 `msg.value >= fee`，超额部分自动计入奖池（`prizePoolReceived`），保持 §2.6 不变式成立
- 产品文档回调名 `providerConfirmedRandomNumber` 为笔误，V2 实际回调即上述 `entropyCallback`

### 2.6 双账本资金核算

合约为单地址收款，账本靠变量分离（产品文档"押金账本与奖池账本分离核算"的落地）：

```
不变式: address(this).balance
        == totalDepositsRemaining          // 押金账本（未领部分）
         + prizePoolAvailable()            // 奖池账本（可派奖部分）
         + (status == Drawing ? entropyFeePaid : 0)   // 在途请求费

prizePoolAvailable() = prizePoolReceived - feesRefunded - prizesPaidOut
                     （Drawn 时刻快照 = prizePerWinner × 实际中奖人数 + 尾差）
```

- `claimDeposit` 从押金账本扣（`totalDepositsRemaining` 递减，天然防超发）。
- `claimPrize` 每次转出 `prizePerWinner`（开奖快照均分，重复领取由 `prizeClaimed` 拒绝）。
- 尾差（快照 % 中奖人数，wei 级）永久滞留合约，金额可忽略，审计按 dust 说明；Drawn 后 `fundPrizePool` 拒绝，无资金滞留路径。
- 请求费返还从奖池毛额中记账扣减（`feesRefunded`），链上可审计。
- 押金与奖池在资金流上无任何交叉路径：押金永不分给 winner，奖池永不退还 sponsor。

### 2.7 安全清单

| # | 项 | 措施 |
|---|---|---|
| 1 | 重入 | `claimDeposit`/`claimPrize` 加 `ReentrancyGuard`；pull 模式 |
| 2 | 权限 | 无 owner、无 setter、无 withdraw；全部参数 immutable |
| 3 | 回调伪造 | V2 由 SDK `IEntropyConsumer` 基类保证（仅接受 Entropy 合约发起的回调） |
| 4 | 签名重放 | digest 绑定 `address(this)` + `expiry` |
| 5 | 回调失败 | 状态机 Drawing + `entropyTimeout` 允许重试（重新缴费），资金安全（押金/奖池不动） |
| 6 | 取模偏差 | 参与人数 ≤ 数百量级，`random % n` 偏差可忽略（demo/活动场景） |
| 7 | 资金滞留 | pull 模式无时限 claim，无损失；超时回收列入未来规划（不在本期） |
| 8 | Gas | `register` O(1)（push）；回调含 winnerCount 轮洗牌循环（≤ 名单长度，活动量级安全，gasLimit 已上浮至 250k）；`participants` 读取走 public getter 分页（前端按需） |
| 9 | winnerCount > 参与人数 | 回调取 `min(winnerCount, n)` 全员中奖，不回滚（避免 drawTime 过后无人可注册的死锁） |

---

## 3. 前端设计

### 3.1 页面与路由

| 路由 | 受众 | 职责 |
|---|---|---|
| `/create` | 主办方 | 创建活动：连接钱包 → 表单配置（准入模式：线上无许可 / 线下验签 + issuer 地址、押金额、开奖时间或锁仓时长、winnerCount）→ 浏览器内 `deployContract` 直接部署 → 成功后跳转 `/?addr=<新地址>` 并记入本地活动列表。 |
| `/` | 参与者/评委/触发者 | 全流程单页：连接钱包 → 状态面板（倒计时/名单/奖池/熵根/中奖人数）→ 注册（线上模式）→ 触发开奖（定时模式显示项目方承诺 seed，现场模式自动取熵根）→ 中奖公布 → 领回押金/领奖。演示录屏主舞台。 |
| `/host` | 工作人员（线下模式） | 输入参与者地址 + 有效期 → 浏览器本地用 issuer 私钥签名 → 渲染二维码（`participant/sig/expiry` 打包）。私钥仅存浏览器内存，可粘贴临时密钥。 |
| `/gather` | 现场观众 | 扫码直达轻量页：摇一摇/手动输入产熵 → `submitEntropy` 交易 → 实时列表展示所有已提交熵与聚合熵根。含注册入口（线下模式先扫 `/host` 码完成验签注册）。 |

**活动上下文解析**：所有页面读取 URL `?addr=<合约地址>` 优先，缺省回落 `NEXT_PUBLIC_LOTTERY_ADDRESS`（演示主活动）。`/host` 签名 digest 绑定合约地址（§2.3），同样遵循该规则——签发二维码/分享链接须携带 `?addr=`。

### 3.2 关键交互流（对应产品文档 §2 旅程）

0. **创建活动**（主办方，`/create`）：表单配置参数 → viem `deployContract`（bytecode+abi 由 `contracts/out` 产物导入，Entropy 地址/provider 从 env 注入）→ 钱包确认 → 进入新活动页（`?addr=`）。
1. **注册**：`/` 或 `/gather` 连接钱包（injected/WalletConnect）→ `register(sig)`，sig 来自 `/host` 二维码或为空（线上模式）→ 监听 `Registered` 事件刷新名单。
2. **集熵**（现场模式）：观众在 `/gather` 产熵提交 → 所有端实时看 `EntropySubmitted` 事件与聚合熵根。
3. **开奖**：到期后 `/` 页"开奖"按钮 → 前端预填 `userSeed`（现场模式 = 读链上 `entropyRoot`；定时模式 = 活动页公布的承诺值）→ `draw(userSeed)` 附请求费（前端先 `getFee` 估算）→ 轮询 `WinnersSelected`。
4. **领回/领奖**：`Drawn` 后按钮按钱包身份出现（未中奖者 = 领押金；中奖者 = 各领 奖池/N）。

### 3.3 前端工程要点

- wagmi config 增加 `walletConnect` connector，projectId `ee21bfa0b7e219ce48913fe5d2edd05c`（`NEXT_PUBLIC_WC_PROJECT_ID`）。
- 已部署 Vercel（已确认演示需要真实扫码集熵）；`/host` 二维码与 `/gather` 分享链接基于 `NEXT_PUBLIC_APP_URL`（Vercel 域名）生成。
- 合约 ABI：`contracts/out` 编译产物导出 JSON 供 web 引用（最小 ABI 手写于 `web/lib/lottery.ts`）；`/create` 浏览器内部署需**完整 bytecode** 一并打包。
- 事件读取用 wagmi `useReadContract`/`watchContractEvent`；名单分页读 `participants(i)`。
- 演示钱包 4 个（≥20 MOD）提前准备（对齐产品文档 §8）。

---

## 4. 随机数链路验证结论（✅ 已完成，2026-09-05）

### 4.1 结论

| 项 | 值 | 验证方式 |
|---|---|---|
| 入口地址（ERC-1967 代理） | `0x825c0390f379C631f3Cf11A82a37D20BddF93c07` | 用户提供 + 链上实测 |
| 实现合约 | `0xdf21D137Aadc95588205586636710ca2890538d5` | EIP-1967 impl slot 读取；与 Pyth 官方文档示例（Optimism）同地址，跨链标准实现 |
| 接口代际 | **V2**（`getFeeV2`/`requestV2` 全系在位；V1 `requestWithCallback` 兼容并存） | impl bytecode 选择器匹配 + 代理 `eth_call getFeeV2()` 成功 |
| 默认 provider | `0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344` | 代理 `getDefaultProvider()` 调用 |
| 请求费 | **0.12816 MON**（`getFeeV2()`，动态值） | `eth_call` 实测 |

### 4.2 过程记录（取证）

- 产品文档原引用地址 `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320`：dispatcher 仅 16 个治理选择器（Wormhole 治理形态，`entropyUpgradableMagic`/`parseGovernanceVM` 等），无 request/getFee；231 天前的 `request(address,bytes32,bool)` 调用 status=0。结论：不可用作入口，产品文档已加勘误。
- issue pyth-network/documentation#898 提到的 `0x90eC5b8a...`：当前无代码。
- 有效入口 `0x825c...f3C07` 为 178 字节 ERC-1967 代理（业务选择器经 delegatecall 生效，字节码匹配不到属正常），故验证必须用 `eth_call` 实测——`getFeeV2()` 返回成功即坐实 V2。

### 4.3 降级路径

不再需要（Entropy V2 可用）。原 commit-reveal 备选设计已作废；若 testnet 后续异常可从 git 历史找回。

---

## 5. 测试计划

### 5.1 Foundry 单测（`contracts/test/Lottery.t.sol`）

- 资格：注册押金金额校验、重复注册拒绝、开奖后注册拒绝、线下模式验签（有效/过期/伪造/重放签名）。
- 集熵：entropyRoot 累积正确性、非注册者拒绝、Drawn 后拒绝、熵根非零时 draw 强制校验。
- 状态机：未到期 draw 拒绝、空名单 draw 拒绝、Drawing 超时重试、重复回调拒绝、Drawn 后 fundPrizePool 拒绝。
- 多中奖者：winnerCount=3 抽取不重复、洗牌结果可由 randomNumber 链下复现、均分金额正确（快照 ÷ N）、重复 claimPrize 拒绝、winnerCount > 参与人数时全员中奖、wei 级尾差滞留断言。
- 费返还边界：奖池充足时全额返还；**空奖池/不足时回调不 revert、跳过返还**；draw 附带超额 msg.value 时差额计入奖池。
- 资金：双账本不变式（§2.6）在每步操作后断言、claimDeposit/claimPrize 重复领取拒绝、请求费返还金额正确。
- Entropy 交互用 SDK/自写 mock 合约模拟回调（含恶意回调者拒绝）。

### 5.2 Testnet 集成测试

- `forge script` 部署 + 全流程走查（4 钱包注册 → 集熵 → draw → 回调 → 领回/领奖），顺带实测真实请求费与回调时延（对照 §4.1 的 0.128 MON）。
- 底金规则实测（产品风险 #1）：~12 MOD 余额账户 register 是否因 10 MON 底金回滚。

### 5.3 前端手测清单（对齐演示脚本 §8）

多浏览器窗口 3 观众扫码集熵 → 熵根一致 → 一键开奖 → 未中奖领回（余额回归）→ 中奖领奖。
创建流程：`/create` 部署一台 winnerCount=3 的新活动 → URL 带新地址进入主页面 → 走通全流程。

---

## 6. 部署方案

```bash
# contracts/.env
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
DEPLOYER_KEY=...
ENTROPY_ADDRESS=0x825c0390f379C631f3Cf11A82a37D20BddF93c07
ENTROPY_PROVIDER=0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
ISSUER_ADDRESS=0x          # 线上模式部署：留空传 address(0)；线下演示：工作人员临时密钥
```

| 场景 | drawTime | depositAmount | entropyTimeout | issuer | winnerCount |
|---|---|---|---|---|---|
| 演示（录屏/现场） | now + 3 min | 10 MOD | 2 min | **非零**（已确认：展示线下验签全流程） | **3**（4 注册者 → 3 中奖 1 未中奖，均分与领回同屏演示） |
| 正式使用 | now + 3 days | 10 MOD | 30 min | 按活动形态 | 按活动（/create 配置） |

- 部署脚本 `script/DeployLottery.s.sol`（forge script，constructor 参数全部来自 env）。
- `/create` 页浏览器内部署与 forge script 走同一构造参数集（Entropy 地址/provider 由前端 env 注入）。
- 部署后立即 `fundPrizePool`（赞助方钱包）+ 3 个钱包预注册（演示预准备，对齐 §8）。
- **演示奖池须明显大于请求费 0.128 MON**（费从奖池返还触发者），建议注入 ≥ 1 MOD。
- 前端 `.env.local` 增加 `NEXT_PUBLIC_LOTTERY_ADDRESS`、`NEXT_PUBLIC_WC_PROJECT_ID`、`NEXT_PUBLIC_APP_URL`（Vercel 域名，二维码用）。

---

## 7. 任务分解（13:00–17:00，对齐 schedule.md）

| 时段 | 任务 | 产出 |
|---|---|---|
| 13:00–14:00 | Lottery.sol 全量实现 + 单测（Entropy 用 mock） | 合约 + 测试绿 |
| 14:00–14:30 | testnet 部署（演示参数）+ §5.2 实测（底金规则/请求费/回调时延） | 已部署地址 |
| 14:30–15:30 | 前端 `/` 主页面（注册/状态/开奖/领回领奖） | 主流程可走通 |
| 15:30–16:15 | `/gather` 集熵页 + `/host` 签发工具页 + `/create` 创建页 | 四页齐备 |
| 16:15–17:00 | 全链路联调（含 Vercel 真机扫码）+ 演示彩排（4 钱包脚本化） | 录屏就绪 |

> 依赖关系：Entropy 入口已验证（§4），无阻塞项；合约与前端 13:00 起即可并行（前端先用手写 ABI）。

---

## 8. 与产品文档的偏离登记

| # | 偏离 | 理由 |
|---|---|---|
| 1 | ~~合约不做 `winnerCount` 参数，固定单中奖者~~ **已撤销（2026-09-05 改判）**：产品遗留项 #3 重新拍板为"完整创建流程 + 均分奖池"，`winnerCount` 已进合约与前端（§2.2/§3.1），不再构成偏离 | 决策记录见 §9 |
| 2 | 产品文档回调名 `providerConfirmedRandomNumber` 修正为 V2 `entropyCallback`（实证：Monad testnet 部署的是 V2 接口，见 §4） | 链上接口取证结果，文档原拼写两代均不存在 |
| 3 | `register` 增加显式 `sig` 参数（线上模式传空） | 双模式同函数签名的最小实现 |
| 4 | 新增 `submitEntropy`/`entropyRoot`（产品文档未含） | ADR 0003 链上集熵决策（拷问会话确认） |
| 5 | 新增 `entropyTimeout` 显式参数 | 产品文档风险 #2"超时后重新 draw"的参数化落地 |

## 9. 决策与待定项

已拍板（2026-09-05 拷问会话 + 实测）：

- [x] **Entropy 入口/代际/请求费** → `0x825C...f3C07`，V2 接口，费 0.128 MON（§4）
- [x] **移动端接入** → injected + WalletConnect（projectId `ee21bfa0b7e219ce48913fe5d2edd05c`）
- [x] **演示需真实扫码** → 前端已部署 Vercel，`/gather` 走公网 URL
- [x] **演示 issuer 形态** → 非零（展示线下验签全流程）
- [x] **winnerCount 暴露形态**（2026-09-05 拍板）→ **完整创建流程**：`/create` 页浏览器内部署，可配中奖人数/押金/开奖时间/准入模式；**派奖 = 开奖时刻奖池快照均分**（快照 ÷ N，实际中奖人数 = min(N, 参与人数)），Drawn 后禁止追加注入
- [x] **仓库模板处置** → 已删除（2026-09-05）：BlitzNFT 合约/测试/脚本、web 的 mint/my-nfts/recent-mints 组件、NFT metadata API 路由、lib/contract.ts；`page.tsx` 换占位页（构建已验证），`connect-wallet`/`providers`/`ui`/`lib/wagmi.ts` 复用
- [x] **Vercel 域名** → `https://monad-blitz-pink.vercel.app`（已写入 `web/.env.example` 的 `NEXT_PUBLIC_APP_URL`）

待定：

- [ ] **10 MON 底金规则冒烟**（产品风险 #1）：规则已推演结案（期初 ≥10 MOD 账户门槛 = 押金 + 10 MOD + gas；<10 MOD 账户任何减余额交易回滚），开发阶段跑 21 MOD 成功 + 12 MOD 失败两个用例实证；降押金分析与"维持 10 MOD"决策见产品文档风险表 #1
