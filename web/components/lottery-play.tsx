"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useConnection,
  usePublicClient,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ConnectWallet } from "@/components/connect-wallet";
import { AppNav } from "@/components/app-nav";
import {
  lotteryAbi,
  formatMON,
  formatCountdown,
  formatTs,
  shortAddress,
  STATUS_LABEL,
  errMsg,
} from "@/lib/lottery";
import {
  useDeployInfo,
  useIdentity,
  useLotteryAddr,
  useLotterySnapshot,
  useNow,
  useRegisterTimes,
} from "@/lib/lottery-hooks";

const STATUS = { Open: 0, Drawing: 1, Drawn: 2 } as const;

export function LotteryPlay() {
  const addr = useLotteryAddr();
  const client = usePublicClient();
  const { isConnected } = useConnection();
  const { data: snap, isLoading, refetch } = useLotterySnapshot(addr);
  const id = useIdentity(addr);
  const now = useNow();
  const { writeContractAsync, isPending } = useWriteContract();

  // URL 凭证（线下模式，来自 /host 二维码）
  const [urlSig, setUrlSig] = useState<`0x${string}` | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sig = p.get("sig");
    if (sig?.startsWith("0x")) setUrlSig(sig as `0x${string}`);
    const ex = p.get("expiry");
    if (ex) setExpiry(Number(ex));
  }, []);

  // 中奖名单（Drawn 时读取）
  const [winners, setWinners] = useState<Address[]>([]);
  const loadWinners = useCallback(async () => {
    if (!client || !addr || snap?.status !== STATUS.Drawn) return;
    try {
      const list = (await client.readContract({
        address: addr,
        abi: lotteryAbi,
        functionName: "winnersList",
      })) as Address[];
      setWinners(list);
    } catch {
      /* ignore */
    }
  }, [client, addr, snap?.status]);
  useEffect(() => {
    loadWinners();
  }, [loadWinners]);

  useWatchContractEvent({
    address: addr,
    abi: lotteryAbi,
    eventName: "WinnersSelected",
    onLogs: () => {
      loadWinners();
      refetch();
    },
  });
  useWatchContractEvent({
    address: addr,
    abi: lotteryAbi,
    eventName: "Registered",
    onLogs: () => refetch(),
  });
  useWatchContractEvent({
    address: addr,
    abi: lotteryAbi,
    eventName: "EntropySubmitted",
    onLogs: () => refetch(),
  });
  useWatchContractEvent({
    address: addr,
    abi: lotteryAbi,
    eventName: "PrizePoolFunded",
    onLogs: () => refetch(),
  });

  // 定时模式承诺 seed 输入
  const [seedInput, setSeedInput] = useState("");
  const [seed, setSeed] = useState<`0x${string}` | null>(null);

  const [txMsg, setTxMsg] = useState<string | null>(null);
  const send = async (label: string, fn: string, args: unknown[] = [], value?: bigint) => {
    try {
      setTxMsg(`${label}：请确认钱包交易…`);
      const hash = await writeContractAsync({
        address: addr,
        abi: lotteryAbi,
        functionName: fn,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(args.length ? { args: args as any } : {}),
        ...(value !== undefined ? { value } : {}),
      } as never);
      setTxMsg(`${label}：交易已提交 ${shortAddress(hash)}，等待上链…`);
      await client?.waitForTransactionReceipt({ hash });
      setTxMsg(`${label}：完成 ✓`);
      refetch();
      setTimeout(() => setTxMsg(null), 5000);
    } catch (e) {
      setTxMsg(`${label}：${errMsg(e)}`);
      setTimeout(() => setTxMsg(null), 6000);
    }
  };

  // 无活动上下文（缺 ?addr=）：明确提示，不回落到任意合约（须在全部 hooks 之后早退）
  const registeredList = useParticipants(addr, snap?.participantsLength);
  // 参与时间：注册事件的区块时间戳（依赖部署块，从部署块起扫描 Registered 事件）
  const deployInfo = useDeployInfo(addr);
  const regTimes = useRegisterTimes(
    addr,
    deployInfo?.block,
    snap ? Number(snap.participantsLength) : undefined,
  );
  if (!addr) {
    return (
      <div className="flex flex-col flex-1 min-h-screen">
        <AppNav right={<ConnectWallet />} />
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 flex flex-col gap-6">
          <Card>
            <CardContent className="py-4 flex flex-col gap-3 text-sm">
              <div className="font-medium">缺少活动参数</div>
              <div className="text-muted-foreground">
                本页需要指定活动：请从首页活动列表选择，或使用带 <code className="font-mono">?addr=合约地址</code> 的活动链接。
              </div>
              <Button variant="outline" onClick={() => (window.location.href = "/")}>
                去首页选择活动
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // 倒计时与按钮可见性
  const toDraw = snap ? Number(snap.drawTime) - now : 0;
  const canDraw = !!snap && now >= Number(snap.drawTime) && snap.participantsLength > 0n;
  const isLiveMode = !!snap && snap.entropyRoot !== "0x" + "0".repeat(64);
  const drawSeed: `0x${string}` | null = isLiveMode
    ? (snap?.entropyRoot ?? null)
    : (seed as `0x${string}` | null);
  const retryAt = snap && snap.status === STATUS.Drawing ? Number(snap.drawRequestedAt) + Number(snap.entropyTimeout) : 0;
  const canRetry = !!snap && snap.status === STATUS.Drawing && now > retryAt;

  const fee = snap?.entropyFee ?? 0n;
  const feeWithBuffer = (fee * 105n) / 100n; // 5% buffer，超额部分入奖池

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav right={<ConnectWallet />} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 flex flex-col gap-6">
        {/* ---------- 状态面板 ---------- */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">活动状态</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Monad testnet</Badge>
              {snap && <Badge>{STATUS_LABEL[snap.status] ?? snap.status}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <Stat
              label="距开奖"
              value={snap ? (snap.status === STATUS.Open ? formatCountdown(toDraw) : "—") : "…"}
            />
            <Stat label="参与人数" value={snap ? snap.participantsLength.toString() : "…"} />
            <Stat
              label="奖池"
              value={
                snap
                  ? snap.prizePoolAvailable !== undefined
                    ? `${formatMON(snap.prizePoolAvailable)} MON`
                    : "读取中…"
                  : "…"
              }
              sub={snap && snap.status === STATUS.Drawn ? `人均 ${formatMON(snap.prizePerWinner)} MON` : undefined}
            />
            <Stat
              label="中奖名额"
              value={snap ? snap.winnerCount.toString() : "…"}
              sub={`押金 ${snap ? formatMON(snap.depositAmount) : "…"} MON`}
            />
          </CardContent>
          <CardContent className="pt-0">
            <div className="text-xs text-muted-foreground break-all">
              合约 {addr ? shortAddress(addr) : "…"} ·{" "}
              {snap && snap.issuer !== "0x0000000000000000000000000000000000000000"
                ? "线下验签模式"
                : "线上无许可模式"}
              {snap && snap.entropyCount > 0n && (
                <>
                  {" "}· 已集熵 {snap.entropyCount.toString()} 条
                  <div className="mt-1 font-mono">熵根 {snap.entropyRoot}</div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading && !snap && <div className="text-center text-muted-foreground">加载合约状态…</div>}
        {txMsg && (
          <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">{txMsg}</div>
        )}

        {/* ---------- Open：注册 ---------- */}
        {snap?.status === STATUS.Open && (
          <RegisterCard
            snap={snap}
            id={id}
            isConnected={isConnected}
            urlSig={urlSig}
            expiry={expiry}
            now={now}
            onRegister={() => send("注册", "register", [urlSig ?? "0x"], snap.depositAmount)}
          />
        )}

        {/* ---------- Open 到期：触发开奖 ---------- */}
        {snap?.status === STATUS.Open && canDraw && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">触发开奖</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {isLiveMode ? (
                <div className="text-sm text-muted-foreground">
                  现场模式：将使用链上熵根作为 userSeed（已自动填入）
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="定时模式：输入项目方公布的承诺 seed（0x…）"
                    value={seedInput}
                    onChange={(e) => setSeedInput(e.target.value)}
                  />
                  <Button variant="outline" onClick={() => setSeed(seedInput as `0x${string}`)}>
                    确认 seed
                  </Button>
                </div>
              )}
              <Button
                disabled={!isConnected || !drawSeed || isPending}
                onClick={() => drawSeed && send("开奖", "draw", [drawSeed], feeWithBuffer)}
              >
                {isPending
                  ? "请求中…"
                  : `一键开奖（附请求费 ≈ ${formatMON(feeWithBuffer)} MON）`}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ---------- Drawing：等待回调 ---------- */}
        {snap?.status === STATUS.Drawing && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">正在等待 Pyth Entropy 回调…</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <div>
                回调超时重试：{canRetry ? "已可重试" : formatCountdown(retryAt - now)} 后
              </div>
              <Button
                variant="outline"
                disabled={!isConnected || !canRetry || isPending}
                onClick={() =>
                  send(
                    "重新开奖",
                    "draw",
                    [snap.entropyRoot !== "0x" + "0".repeat(64) ? snap.entropyRoot : (seed ?? "0x0000000000000000000000000000000000000000000000000000000000000000")],
                    feeWithBuffer,
                  )
                }
              >
                超时重试（重新缴费）
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ---------- Drawn：结果与领取 ---------- */}
        {snap?.status === STATUS.Drawn && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">开奖结果</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {winners.length === 0 && <span className="text-muted-foreground">读取名单…</span>}
                {winners.map((w) => (
                  <Badge key={w} variant={id.address === w ? "default" : "secondary"}>
                    🏆 {shortAddress(w)}
                    {id.address === w ? "（你）" : ""}
                  </Badge>
                ))}
              </div>
              <div className="text-sm">
                人均奖金 <span className="font-semibold">{formatMON(snap.prizePerWinner)} MON</span>
                {" "}· 奖池快照 {snap.prizePoolReceived !== undefined ? `${formatMON(snap.prizePoolReceived)} MON` : "…"}
              </div>
              <Separator />
              {id.registered && (
                <div className="flex flex-wrap gap-2">
                  {id.isWinner && !id.prizeClaimed && (
                    <Button disabled={isPending} onClick={() => send("领奖", "claimPrize")}>
                      领取奖金 {formatMON(snap.prizePerWinner)} MON
                    </Button>
                  )}
                  {id.isWinner && id.prizeClaimed && (
                    <Badge>奖金已领取 ✓</Badge>
                  )}
                  {!id.depositClaimed && (
                    <Button
                      variant="outline"
                      disabled={isPending}
                      onClick={() => send("领回押金", "claimDeposit")}
                    >
                      领回押金 {formatMON(snap.depositAmount, 1)} MON
                    </Button>
                  )}
                  {id.depositClaimed && <Badge variant="secondary">押金已领回 ✓</Badge>}
                </div>
              )}
              {!id.registered && isConnected && (
                <div className="text-sm text-muted-foreground">非本期参与者</div>
              )}
              {!isConnected && <div className="text-sm text-muted-foreground">连接钱包查看身份</div>}
            </CardContent>
          </Card>
        )}

        {/* ---------- 参与名单 ---------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">参与名单（{registeredList.length}）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {registeredList.length === 0 && (
              <span className="text-sm text-muted-foreground">暂无参与者</span>
            )}
            {registeredList.map((p, i) => {
              const t = regTimes[p.toLowerCase()];
              return (
                <Badge key={p} variant="outline">
                  {i + 1}. {shortAddress(p)}
                  <span className="ml-1 text-muted-foreground">{t ? formatTs(t) : "…"}</span>
                </Badge>
              );
            })}
          </CardContent>
        </Card>
      </main>

      <footer className="px-6 py-4 text-center text-sm text-muted-foreground border-t">
        Monad Blitz · Escrow + VRF Lottery · Pyth Entropy V2
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function RegisterCard({
  snap,
  id,
  isConnected,
  urlSig,
  expiry,
  now,
  onRegister,
}: {
  snap: { issuer: Address; depositAmount: bigint; drawTime: bigint };
  id: { registered?: boolean };
  isConnected: boolean;
  urlSig: `0x${string}` | null;
  expiry: number | null;
  now: number;
  onRegister: () => void;
}) {
  const offline = snap.issuer !== "0x0000000000000000000000000000000000000000";
  if (id.registered) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center justify-between">
          <span className="text-sm">已注册 · 押金已托管</span>
          <Badge>✓ 参与成功</Badge>
        </CardContent>
      </Card>
    );
  }
  if (now >= Number(snap.drawTime)) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">注册参与</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="text-sm text-muted-foreground">
          押金 {formatMON(snap.depositAmount)} MON 托管于合约，开奖后可领回（未中奖者与中奖者均可）
        </div>
        {offline ? (
          urlSig ? (
            <>
              <div className="text-xs text-muted-foreground">
                凭证有效期至：{expiry ? new Date(expiry * 1000).toLocaleString("zh-CN") : "（签名内含）"}
              </div>
              <Button disabled={!isConnected || isPendingText()} onClick={onRegister}>
                凭工作人员签发的凭证注册
              </Button>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              线下验签模式：请扫描工作人员二维码（/host 页签发）
            </div>
          )
        ) : (
          <Button disabled={!isConnected || isPendingText()} onClick={onRegister}>
            {isConnected ? "注册（线上无许可）" : "连接钱包后注册"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function isPendingText() {
  return false; // RegisterCard 内无需 pending 状态（由外层 txMsg 提示）
}

function useParticipants(addr: Address | undefined, count: bigint | undefined) {
  const client = usePublicClient();
  const [list, setList] = useState<Address[]>([]);
  useEffect(() => {
    if (!client || !addr || !count) {
      setList([]);
      return;
    }
    let stop = false;
    (async () => {
      const n = Number(count);
      const out: Address[] = [];
      for (let i = 0; i < n; i++) {
        try {
          const p = (await client.readContract({
            address: addr,
            abi: lotteryAbi,
            functionName: "participants",
            args: [BigInt(i)],
          })) as Address;
          out.push(p);
        } catch {
          break;
        }
      }
      if (!stop) setList(out);
    })();
    return () => {
      stop = true;
    };
  }, [client, addr, count?.toString()]);
  return list;
}
