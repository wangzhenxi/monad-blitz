"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import type { Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectWallet } from "@/components/connect-wallet";
import { AppNav } from "@/components/app-nav";
import { FACTORY_ADDRESS, STATUS_LABEL, factoryAbi, formatMON, lotteryAbi, shortAddress } from "@/lib/lottery";

interface ActivityStat {
  addr: Address;
  status: number;
  participants: bigint;
  entropyCount: bigint;
  prizePool: bigint | undefined;
}

/// 首页：链上聚合量化数据 + 活动列表（数据源 = 工厂注册表，无活动上下文依赖）
export function LotteryOverview() {
  const client = usePublicClient();
  const { data: addrs, isLoading: listLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getLotteries",
    query: { refetchInterval: 15_000 },
  });

  const [stats, setStats] = useState<ActivityStat[]>([]);
  const [loading, setLoading] = useState(true);

  const activityList = useMemo(() => [...(addrs ?? [])].reverse(), [addrs]);

  useEffect(() => {
    if (!client || !addrs) return;
    let stop = false;
    setLoading(true);
    (async () => {
      const rows = await Promise.all(
        addrs.map(async (a) => {
          const read = (fn: string) =>
            client
              .readContract({ address: a, abi: lotteryAbi, functionName: fn as never })
              .catch(() => undefined);
          const [status, participants, entropyCount, prizePool] = await Promise.all([
            read("status"),
            read("participantsLength"),
            read("entropyCount"),
            read("prizePoolAvailable"),
          ]);
          return {
            addr: a,
            status: (status as unknown as number) ?? 0,
            participants: (participants as unknown as bigint) ?? 0n,
            entropyCount: (entropyCount as unknown as bigint) ?? 0n,
            prizePool: prizePool as bigint | undefined,
          };
        }),
      );
      if (!stop) {
        setStats(rows);
        setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [client, addrs]);

  // 聚合指标
  const totals = useMemo(() => {
    const drawn = stats.filter((s) => s.status === 2).length;
    const participants = stats.reduce((sum, s) => sum + s.participants, 0n);
    const entropy = stats.reduce((sum, s) => sum + s.entropyCount, 0n);
    const prize = stats.reduce((sum, s) => sum + (s.prizePool ?? 0n), 0n);
    return { count: stats.length, drawn, participants, entropy, prize };
  }, [stats]);

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav title="Monad Blitz" right={<ConnectWallet />} />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 flex flex-col gap-6">
        {/* ---------- Hero ---------- */}
        <Card>
          <CardContent className="py-6 flex flex-col gap-3">
            <div className="text-2xl font-bold">链上可信抽奖平台</div>
            <div className="text-sm text-muted-foreground">
              押金托管 + 可验证随机数：名单可验证、开奖不可操纵、派奖由合约执行。
              从下方活动列表选择一场活动，或创建新活动。
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/create"><Button size="sm">创建活动</Button></a>
              <a href="/docs/product"><Button size="sm" variant="outline">产品设计</Button></a>
              <a href="/docs/tech"><Button size="sm" variant="outline">技术方案</Button></a>
            </div>
          </CardContent>
        </Card>

        {/* ---------- 聚合量化指标 ---------- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="活动总数" value={loading ? "…" : totals.count.toString()} sub={`已开奖 ${totals.drawn} 场`} />
          <StatCard label="累计参与人次" value={loading ? "…" : totals.participants.toString()} />
          <StatCard label="累计集熵条数" value={loading ? "…" : totals.entropy.toString()} />
          <StatCard
            label="链上奖池总额"
            value={loading ? "…" : `${formatMON(totals.prize)} MON`}
            sub="赞助方注入，与押金分离"
          />
        </div>

        {/* ---------- 活动列表 ---------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">活动列表（链上注册表）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {listLoading && activityList.length === 0 && (
              <span className="text-sm text-muted-foreground">正在从链上读取活动…</span>
            )}
            {!listLoading && activityList.length === 0 && (
              <span className="text-sm text-muted-foreground">暂无活动，点击上方"创建活动"开始第一场</span>
            )}
            {stats.map((s) => (
              <ActivityRow key={s.addr} stat={s} />
            ))}
          </CardContent>
        </Card>
      </main>

      <footer className="px-6 py-4 text-center text-sm text-muted-foreground border-t">
        Monad Blitz · Escrow + VRF Lottery · Pyth Entropy V2
      </footer>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4 text-center">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ stat }: { stat: ActivityStat }) {
  const statusBadge =
    stat.status === 0
      ? "bg-green-100 text-green-800"
      : stat.status === 1
        ? "bg-amber-100 text-amber-800"
        : "bg-muted text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-2 border-b last:border-b-0 py-2">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{shortAddress(stat.addr)}</Badge>
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge}`}>
            {STATUS_LABEL[stat.status]}
          </span>
          <span className="text-xs text-muted-foreground">
            {stat.participants.toString()} 人 · 集熵 {stat.entropyCount.toString()} 条 ·{" "}
            奖池 {stat.prizePool !== undefined ? formatMON(stat.prizePool) : "…"} MON
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <a
          className="text-sm underline text-muted-foreground hover:text-foreground"
          href={`/gather?addr=${stat.addr}`}
        >
          集熵现场
        </a>
        <a
          className="text-sm underline font-medium hover:underline"
          href={`/play?addr=${stat.addr}`}
        >
          进入活动 →
        </a>
      </div>
    </div>
  );
}
