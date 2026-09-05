import { AppNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "技术方案 — Monad Blitz" };

const DOC_URL = "https://github.com/wangzhenxi/monad-blitz/blob/main/docs/tech-design.md";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold mt-8 mb-3 first:mt-0">{children}</h2>;
}

export default function TechDocPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8 flex flex-col gap-2">
        <Card>
          <CardContent className="py-6 flex flex-col gap-4">
            <div className="text-xl font-bold">技术方案 — 单合约 · 无 owner · 双账本</div>
            <div className="text-sm text-muted-foreground">
              单合约无权限函数，全部参数 immutable；双模式准入（线上无许可 / 线下 issuer ECDSA 验签）；链上集熵
              keccak 链式累积；押金与奖池双账本分离核算。
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Solidity ^0.8.28 + Foundry</Badge>
              <Badge variant="outline">OpenZeppelin ECDSA</Badge>
              <Badge variant="outline">Pyth Entropy V2</Badge>
              <Badge variant="outline">Next.js + wagmi + viem</Badge>
            </div>
          </CardContent>
        </Card>

        <H>总体架构</H>
        <Card>
          <CardContent className="py-4">
            <pre className="text-xs leading-relaxed overflow-x-auto font-mono bg-muted/50 rounded-md p-4">{`┌─────────────────────────┐       ┌──────────────────────────┐
│  前端 (Next.js + wagmi)  │       │  外部依赖                  │
│  /      参与者主页面      │       │  Pyth Entropy V2 (已验证)  │
│  /gather 观众集熵页       │       │  WalletConnect relay      │
│  /host  签发者工具页      │       └───────────┬──────────────┘
│  /create 创建活动(工厂)   │                   │ 异步回调
└───────────┬─────────────┘                   ▼
            │  交易 / 事件读取    ┌─────────────────────────────┐
            └───────────────────▶│  LotteryFactory + Lottery.sol │
                                │  (无 owner, 全 immutable)     │
                                └─────────────────────────────┘`}</pre>
          </CardContent>
        </Card>

        <H>合约状态机</H>
        <Card>
          <CardContent className="py-4">
            <pre className="text-xs leading-relaxed overflow-x-auto font-mono bg-muted/50 rounded-md p-4">{`Open ──draw()──▶ Drawing ──entropyCallback──▶ Drawn
                    │
                    └─超时(entropyTimeout)后可再次 draw()（重新缴费）

Open:    register() / submitEntropy() / fundPrizePool()
Drawing: fundPrizePool() 仍可注入（快照在回调时刻定格）
Drawn:   claimDeposit() / claimPrize()；fundPrizePool() 拒绝`}</pre>
          </CardContent>
        </Card>

        <H>核心设计要点</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-3">
            <div>
              <b>双模式准入（ADR 0002）</b>
              <div className="text-muted-foreground">
                issuer == 0 → 无许可注册；issuer ≠ 0 → EIP-191 验签，签名 keccak(participant ‖ address(this) ‖ expiry)
                绑定合约地址防跨合约重放，expiry 防过期。
              </div>
            </div>
            <div>
              <b>链上集熵（ADR 0003）</b>
              <div className="text-muted-foreground">
                已注册观众 submitEntropy(e)，熵根 = keccak(entropyRoot ‖ e) 链式累积；熵根非零时 draw 强制
                userSeed == entropyRoot（现场模式语义）。
              </div>
            </div>
            <div>
              <b>双账本不变式</b>
              <div className="text-muted-foreground">
                合约余额 == 押金账本（totalDepositsRemaining）+ 奖池账本（prizePoolAvailable）+ 在途请求费。
                押金永不分给 winner，奖池永不退还 sponsor，无交叉路径。
              </div>
            </div>
            <div>
              <b>开奖与派奖</b>
              <div className="text-muted-foreground">
                回调以随机数为种子做部分 Fisher-Yates 洗牌取前 N 名；派奖 = 开奖时刻奖池快照均分（÷ N，
                wei 级尾差滞留）；实际中奖人数 = min(winnerCount, 参与人数)。
              </div>
            </div>
          </CardContent>
        </Card>

        <H>Pyth Entropy V2 集成（链上实测已验证）</H>
        <Card>
          <CardContent className="py-4">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ["入口（ERC-1967 代理）", "0x825c0390f379C631f3Cf11A82a37D20BddF93c07"],
                  ["默认 provider", "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344"],
                  ["接口代际", "V2（getFeeV2 / requestV2）"],
                  ["请求费实测", "≈ 0.128 MON（动态值，draw 时附 5% buffer）"],
                  ["回调", "entropyCallback(uint64, address, bytes32)，SDK 基类自带来源鉴权"],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap align-top">{k}</td>
                    <td className="py-2 font-mono text-xs break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-muted-foreground mt-3">
              随机数 = 验证者熵 + 用户种子共同决定；洗牌确定性可复现，任何人可按同一随机数链下重算名单核验。
            </div>
          </CardContent>
        </Card>

        <H>安全清单（摘要）</H>
        <Card>
          <CardContent className="py-4 text-sm">
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>重入：claimDeposit / claimPrize 加 ReentrancyGuard，pull 模式领取</li>
              <li>权限：无 owner、无 setter、无 withdraw；全部参数 immutable，部署即固定</li>
              <li>回调伪造：SDK IEntropyConsumer 基类保证仅接受 Entropy 合约回调</li>
              <li>签名重放：digest 绑定 address(this) + expiry；请求费返还 best-effort，回调永不 revert</li>
              <li>资金滞留：pull 模式无时限 claim；Drawn 后 fundPrizePool 拒绝追加</li>
            </ul>
          </CardContent>
        </Card>

        <H>前端工程</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-2">
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li><b>6 个入口页</b>：首页（全流程单页）/ 抽奖现场（摇一摇产熵 + 实时熵流）/ 入场管理（本地签名 + 二维码）/ 创建活动（经工厂合约部署 + 链上活动列表）/ 产品设计 / 技术方案</li>
              <li>活动上下文：URL ?addr= 优先，回落 NEXT_PUBLIC_LOTTERY_ADDRESS</li>
              <li>Monad 适配：eth_getLogs 100 块限制 → 集熵历史 95 块分块扫描 + localStorage 增量缓存；活动列表走工厂合约 view 读取（无事件扫描）</li>
              <li>钱包：injected（桌面）+ WalletConnect（现场观众手机扫码）</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardContent className="py-4 text-sm flex flex-col gap-1">
            <div className="font-medium">完整技术方案文档</div>
            <a className="text-blue-600 hover:underline break-all" href={DOC_URL} target="_blank" rel="noreferrer">
              {DOC_URL}
            </a>
            <div className="text-xs text-muted-foreground">
              含完整函数签名与 require 清单、Foundry 测试计划、部署参数、与产品文档的偏离登记表。
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="px-6 py-4 text-center text-sm text-muted-foreground border-t">
        Monad Blitz · Escrow + VRF Lottery · Pyth Entropy V2
      </footer>
    </div>
  );
}
