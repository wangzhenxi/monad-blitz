import { AppNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "产品设计 — Monad Blitz" };

const DOC_URL = "https://github.com/wangzhenxi/monad-blitz/blob/main/docs/product-design.md";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold mt-8 mb-3 first:mt-0">{children}</h2>;
}

export default function ProductDocPage() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav title="产品设计" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8 flex flex-col gap-2">
        <Card>
          <CardContent className="py-6 flex flex-col gap-4">
            <div className="text-xl font-bold">Monad Blitz — 链上可信抽奖平台</div>
            <div className="text-sm text-muted-foreground">
              用智能合约托管 + 可验证随机数，彻底消除抽奖场景中"主办方作弊"的信任问题。
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>押金托管</Badge>
              <Badge>Pyth Entropy VRF</Badge>
              <Badge>链上集熵</Badge>
              <Badge>双模式准入</Badge>
              <Badge>Monad 原生</Badge>
            </div>
          </CardContent>
        </Card>

        <H>解决什么问题</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-2">
            <div>传统抽奖中，参与者无法验证三件事——本产品把三件事全部变成<b>链上可验证</b>：</div>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>中奖名单是不是真的？ → <b>链上注册事件</b>，一地址一份押金，一地址一份资格</li>
              <li>开奖过程是否被操纵？ → <b>Pyth Entropy 可验证随机数</b>，任何单方无法操纵</li>
              <li>承诺的奖品会发吗？ → <b>合约托管奖池，合约强制派发</b>，到期 100% 退押金</li>
            </ul>
          </CardContent>
        </Card>

        <H>核心机制（用户旅程）</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-2">
            {[
              ["①", "注册", "register() 附 10 MOD 押金 → 资格名单 +1，押金入合约托管"],
              ["②", "注资", "赞助方 fundPrizePool() 注入奖金（与押金严格分离）"],
              ["③", "锁仓", "押金在锁仓期内锁定，任何人不可取回"],
              ["④", "开奖", "到期后任何人触发 draw(userSeed) → 请求 Pyth Entropy"],
              ["⑤", "公布", "链上随机数洗牌取前 N 名中奖者，均分奖池"],
              ["⑥", "领取", "未中奖者领回全部押金，中奖者各领 奖池/N"],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3">
                <span className="text-muted-foreground w-5 shrink-0">{n}</span>
                <span><b>{t}</b> · <span className="text-muted-foreground">{d}</span></span>
              </div>
            ))}
          </CardContent>
        </Card>

        <H>两种开奖形式</H>
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">定时开奖</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              部署时设定 drawTime；项目方预先公布承诺 seed（公开不可抵赖）；到期任何人触发。适合线上社区活动、周期性营销抽奖。
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">现场开奖（差异化亮点）</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              现场观众扫码提交熵（摇手机/输入），链上聚合为熵根并强制作为 userSeed——<b>把现场变成随机数源</b>，观众真实参与开奖。适合黑客松颁奖、meetup、展会。
            </CardContent>
          </Card>
        </div>

        <H>线下准入：防远程薅羊毛</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-2">
            <div>
              线下活动的奖池若被远程羊毛党稀释（押金零成本时薅羊毛是正期望），双模式准入一套合约代码解决：
            </div>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li><b>线上无许可模式</b>（issuer = 零地址）：任何人 register() 即可入围</li>
              <li><b>线下验签模式</b>（issuer ≠ 零地址）：工作人员在 /host 页对参与者地址 ECDSA 签名（绑定地址+合约+有效期），生成二维码当面回传，合约 ecrecover 验签通过才入围</li>
              <li>签发者密钥<b>无提款权限</b>，最大损失仅若干张无效准入票——与检票员放熟人进场同级的有界信任</li>
            </ul>
          </CardContent>
        </Card>

        <H>信任模型对比（评委核心关注）</H>
        <Card>
          <CardContent className="py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 font-normal">信任风险</th>
                  <th className="py-2 font-normal">传统抽奖</th>
                  <th className="py-2 font-normal">Monad Blitz</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["参与者真实性", "名单不透明，可凭空造假", "链上注册事件，一地址一份押金"],
                  ["主办方操纵结果", "黑箱开奖，无法验证", "可验证随机数，任何单方无法操纵"],
                  ["奖品承诺", "口头发钱，可能赖账", "奖金预先锁入合约，强制派发"],
                  ["押金安全", "无此概念", "合约托管，到期 100% 退回"],
                  ["开奖执行", "主办方说了算", "到期后任何人可触发，无准入"],
                ].map(([risk, trad, ours]) => (
                  <tr key={risk} className="border-b last:border-b-0">
                    <td className="py-2 pr-2">{risk}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{trad}</td>
                    <td className="py-2">{ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-muted-foreground mt-3">
              残余信任假设（诚实声明）：Pyth 验证者网络（多数诚实）、Monad 共识层；线下模式另含签发者准入信任（与检票同级，无资金权限）。合约无 owner、无提款函数、参数全部 immutable。
            </div>
          </CardContent>
        </Card>

        <H>商业价值要点</H>
        <Card>
          <CardContent className="py-4 text-sm flex flex-col gap-2">
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li><b>为什么必须是 Web3</b>：名单/开奖/资金三个环节全部上公开账本，信任从"平台品牌"降级为"验证数学与代码"；Web2 中心化数据库可随时篡改，第三方公证只是信任转移</li>
              <li><b>为什么是 Monad</b>：以太坊一笔注册 gas 数美元（经济上不成立）；Monad 亚美分 gas + 高 TPS 支撑现场百人并发扫码</li>
              <li><b>目标客户</b>：品牌市场部（可验证公平成为信任资产）、Web3 项目/DAO（防女巫精准触达真人）、线下活动主办方（集熵互动工具）、直播平台（主播自证清白）</li>
              <li><b>收入模式</b>：按场次 SaaS 服务费 + 未来门票分成 + 增值服务（开奖大屏/数据报告）。押金与奖池 100% 归用户，平台收入不与参与者利益冲突</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardContent className="py-4 text-sm flex flex-col gap-1">
            <div className="font-medium">完整产品设计文档</div>
            <a className="text-blue-600 hover:underline break-all" href={DOC_URL} target="_blank" rel="noreferrer">
              {DOC_URL}
            </a>
            <div className="text-xs text-muted-foreground">
              含完整需求拷问记录、边界情形风险清单、演示脚本、未来规划等。
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
