"use client";

import { useMemo, useState } from "react";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { decodeEventLog, type Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConnectWallet } from "@/components/connect-wallet";
import { AppNav } from "@/components/app-nav";
import {
  ENTROPY_ADDRESS,
  ENTROPY_PROVIDER,
  FACTORY_ADDRESS,
  STATUS_LABEL,
  factoryAbi,
  formatMON,
  lotteryAbi,
  shortAddress,
  errMsg,
} from "@/lib/lottery";

/// 活动行：链上实时状态 + 直达入口（主页面 / 集熵现场）
function ActivityRow({ addr }: { addr: Address }) {
  const q = { refetchInterval: 10_000 } as const;
  const { data: status } = useReadContract({
    address: addr,
    abi: lotteryAbi,
    functionName: "status",
    query: q,
  });
  const { data: participants } = useReadContract({
    address: addr,
    abi: lotteryAbi,
    functionName: "participantsLength",
    query: q,
  });
  const { data: entropyCount } = useReadContract({
    address: addr,
    abi: lotteryAbi,
    functionName: "entropyCount",
    query: q,
  });
  const { data: deposit } = useReadContract({
    address: addr,
    abi: lotteryAbi,
    functionName: "depositAmount",
    query: q,
  });
  const { data: winnerCount } = useReadContract({
    address: addr,
    abi: lotteryAbi,
    functionName: "winnerCount",
  });

  const statusBadge =
    status === 0
      ? "bg-green-100 text-green-800"
      : status === 1
        ? "bg-amber-100 text-amber-800"
        : "bg-muted text-muted-foreground";

  return (
    <div className="flex items-center justify-between gap-2 border-b last:border-b-0 py-2">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{shortAddress(addr)}</Badge>
          {status !== undefined && (
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge}`}>
              {STATUS_LABEL[status]}
            </span>
          )}
          {participants !== undefined && entropyCount !== undefined && (
            <span className="text-xs text-muted-foreground">
              {participants.toString()} 人 · 集熵 {entropyCount.toString()} 条
            </span>
          )}
        </div>
        {deposit !== undefined && winnerCount !== undefined && (
          <span className="text-xs text-muted-foreground truncate">
            押金 {formatMON(deposit)} MON · {winnerCount.toString()} 名中奖
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <a
          className="text-sm underline text-muted-foreground hover:text-foreground"
          href={`/gather?addr=${addr}`}
        >
          集熵现场
        </a>
        <a
          className="text-sm underline text-muted-foreground hover:text-foreground"
          href={`/play?addr=${addr}`}
        >
          详情
        </a>
      </div>
    </div>
  );
}

export function LotteryCreate() {
  const { isConnected, address } = useConnection();
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  // 表单状态
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [issuerAddr, setIssuerAddr] = useState("");
  const [deposit, setDeposit] = useState("0.01");
  const [lockMinutes, setLockMinutes] = useState("3");
  const [winnerCount, setWinnerCount] = useState("3");

  const [msg, setMsg] = useState<string | null>(null);
  const [manualAddr, setManualAddr] = useState("");
  const [registering, setRegistering] = useState(false);

  // 链上活动列表：工厂注册表 getLotteries()（新创建的在前）
  const { data: lotteries, isLoading: listLoading, refetch: refetchList } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getLotteries",
    query: { refetchInterval: 15_000 },
  });
  const list = useMemo(() => [...(lotteries ?? [])].reverse(), [lotteries]);

  const validate = (): string | null => {
    const dep = Number(deposit);
    if (!dep || dep <= 0) return "押金须为正数（MON）";
    const mins = Number(lockMinutes);
    if (!mins || mins <= 0) return "锁仓时长须为正数（分钟）";
    const wc = Number(winnerCount);
    if (!Number.isInteger(wc) || wc < 1) return "中奖人数须为 ≥1 的整数";
    if (mode === "offline" && !/^0x[0-9a-fA-F]{40}$/.test(issuerAddr.trim())) {
      return "线下模式需提供 issuer 地址";
    }
    return null;
  };

  /// 经工厂创建：部署 + 链上登记一步完成，从 LotteryCreated 事件解析新活动地址
  const create = async () => {
    const err = validate();
    if (err) {
      setMsg(err);
      return;
    }
    if (!isConnected || !address || !client) return;
    setMsg("创建交易已构建，请在钱包中确认…");
    try {
      const drawTime = BigInt(Math.floor(Date.now() / 1000) + Number(lockMinutes) * 60);
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "createLottery",
        args: [
          (mode === "offline" ? issuerAddr.trim() : "0x0000000000000000000000000000000000000000") as Address,
          ENTROPY_ADDRESS,
          ENTROPY_PROVIDER,
          drawTime,
          BigInt(Math.floor(Number(deposit) * 1e18)),
          BigInt(120), // entropyTimeout：2 分钟
          BigInt(Number(winnerCount)),
        ],
      });

      setMsg(`工厂交易已提交 ${shortAddress(hash)}，等待上链…`);
      const receipt = await client.waitForTransactionReceipt({ hash });
      const created = receipt.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "LotteryCreated");
      const lotteryAddr = created?.args.lottery as Address | undefined;
      if (!lotteryAddr) throw new Error("未从回执解析到新活动地址");

      await refetchList();
      setMsg(`创建成功 ✓ ${shortAddress(lotteryAddr)}，正在跳转…`);
      setTimeout(() => {
        window.location.href = `/?addr=${lotteryAddr}`;
      }, 1200);
    } catch (e) {
      setMsg(`创建失败：${errMsg(e)}`);
    }
  };

  /// 补录链上已有活动（工厂校验目标形似 Lottery 后登记）
  const registerExisting = async () => {
    const a = manualAddr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setMsg("合约地址格式错误（0x…40 位 hex）");
      return;
    }
    if (list.some((x) => x.toLowerCase() === a.toLowerCase())) {
      setMsg("该合约已在列表中");
      return;
    }
    if (!isConnected || !client) return;
    setRegistering(true);
    setMsg("补录交易已构建，请在钱包中确认…");
    try {
      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "registerExisting",
        args: [a as Address],
      });
      setMsg(`补录交易已提交 ${shortAddress(hash)}，等待上链…`);
      await client.waitForTransactionReceipt({ hash });
      await refetchList();
      setManualAddr("");
      setMsg("补录成功 ✓ 已加入链上活动列表");
    } catch (e) {
      setMsg(`补录失败：${errMsg(e)}`);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav right={<ConnectWallet />} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 flex flex-col gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">活动参数</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* 准入模式 */}
            <div className="flex gap-2">
              <Button
                variant={mode === "online" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("online")}
              >
                线上无许可
              </Button>
              <Button
                variant={mode === "offline" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("offline")}
              >
                线下验签
              </Button>
            </div>
            {mode === "offline" && (
              <div>
                <label className="text-sm font-medium" htmlFor="issuer">
                  Issuer 地址（工作人员密钥，/host 页需对应私钥）
                </label>
                <Input
                  id="issuer"
                  className="mt-1"
                  placeholder="0x…"
                  value={issuerAddr}
                  onChange={(e) => setIssuerAddr(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium" htmlFor="deposit">
                  押金（MON）
                </label>
                <Input
                  id="deposit"
                  className="mt-1"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="lock">
                  锁仓（分钟）
                </label>
                <Input
                  id="lock"
                  className="mt-1"
                  value={lockMinutes}
                  onChange={(e) => setLockMinutes(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="wc">
                  中奖人数
                </label>
                <Input
                  id="wc"
                  className="mt-1"
                  value={winnerCount}
                  onChange={(e) => setWinnerCount(e.target.value)}
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              工厂 {shortAddress(FACTORY_ADDRESS)} · Entropy 入口 {shortAddress(ENTROPY_ADDRESS)} · provider{" "}
              {shortAddress(ENTROPY_PROVIDER)} · 回调超时 2 分钟 · 派奖 = 开奖时刻奖池快照均分
            </div>

            {msg && (
              <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm break-all">{msg}</div>
            )}

            <Button disabled={!isConnected || isPending} onClick={create}>
              {isConnected
                ? isPending
                  ? "创建中…"
                  : "经工厂创建活动"
                : "连接钱包后创建"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">活动列表（链上注册表）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {listLoading && list.length === 0 && (
              <span className="text-sm text-muted-foreground">正在从链上读取活动列表…</span>
            )}
            {!listLoading && list.length === 0 && (
              <span className="text-sm text-muted-foreground">
                暂无活动；在上方创建，或补录 CLI 部署的合约地址
              </span>
            )}
            {list.map((a) => (
              <ActivityRow key={a} addr={a} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">补录已有活动</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              placeholder="0x… 合约地址（CLI 部署的活动，登记到链上列表）"
              value={manualAddr}
              onChange={(e) => setManualAddr(e.target.value)}
            />
            <Button variant="outline" disabled={!isConnected || registering} onClick={registerExisting}>
              {registering ? "补录中…" : "补录"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
