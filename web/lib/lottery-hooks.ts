"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, usePublicClient, useReadContract } from "wagmi";
import type { Address } from "viem";
import {
  lotteryAbi,
  entropyAbi,
  getLotteryAddress,
  ENTROPY_ADDRESS,
  ENTROPY_PROVIDER,
  CALLBACK_GAS_LIMIT,
} from "./lottery";

const POLL = 4000; // 轮询间隔（ms）

/// SSR/水合安全的活动地址：首帧 undefined（wagmi 自动跳过查询、href 渲染占位），
/// 挂载后切到 URL ?addr=。直接在渲染期读 window 会导致 hydration 属性修补不稳定。
export function useLotteryAddr(): Address | undefined {
  const [addr, setAddr] = useState<Address | undefined>(undefined);
  useEffect(() => {
    setAddr(getLotteryAddress());
  }, []);
  return addr;
}

export interface LotterySnapshot {
  addr: Address;
  status: number;
  issuer: Address;
  depositAmount: bigint;
  drawTime: bigint;
  entropyTimeout: bigint;
  winnerCount: bigint;
  participantsLength: bigint;
  /// 奖池字段读取失败时为 undefined（区别于真实的 0，前端显示"…"而不是伪装成 0）
  prizePoolAvailable: bigint | undefined;
  prizePoolReceived: bigint | undefined;
  prizePerWinner: bigint;
  entropyRoot: `0x${string}`;
  entropyCount: bigint;
  entropyFeePaid: bigint;
  drawRequestedAt: bigint;
  entropyFee: bigint;
}

/// 汇总读取活动状态（自动轮询）
export function useLotterySnapshot(addr: Address | undefined): {
  data: LotterySnapshot | undefined;
  isLoading: boolean;
  refetch: () => void;
} {
  const common = { address: addr, abi: lotteryAbi } as const;
  const q = { refetchInterval: POLL } as const;

  const status = useReadContract({ ...common, functionName: "status", query: q });
  const issuer = useReadContract({ ...common, functionName: "issuer" });
  const depositAmount = useReadContract({ ...common, functionName: "depositAmount" });
  const drawTime = useReadContract({ ...common, functionName: "drawTime" });
  const entropyTimeout = useReadContract({ ...common, functionName: "entropyTimeout" });
  const winnerCount = useReadContract({ ...common, functionName: "winnerCount" });
  const participantsLength = useReadContract({ ...common, functionName: "participantsLength", query: q });
  const prizePoolAvailable = useReadContract({ ...common, functionName: "prizePoolAvailable", query: q });
  const prizePoolReceived = useReadContract({ ...common, functionName: "prizePoolReceived", query: q });
  const prizePerWinner = useReadContract({ ...common, functionName: "prizePerWinner", query: q });
  const entropyRoot = useReadContract({ ...common, functionName: "entropyRoot", query: q });
  const entropyCount = useReadContract({ ...common, functionName: "entropyCount", query: q });
  const entropyFeePaid = useReadContract({ ...common, functionName: "entropyFeePaid", query: q });
  const drawRequestedAt = useReadContract({ ...common, functionName: "drawRequestedAt", query: q });

  const entropyFee = useReadContract({
    address: ENTROPY_ADDRESS,
    abi: entropyAbi,
    functionName: "getFeeV2",
    args: [ENTROPY_PROVIDER, CALLBACK_GAS_LIMIT],
    query: { refetchInterval: 30_000 },
  });

  const data = useMemo<LotterySnapshot | undefined>(() => {
    if (
      !addr ||
      status.data === undefined ||
      issuer.data === undefined ||
      depositAmount.data === undefined ||
      drawTime.data === undefined ||
      entropyTimeout.data === undefined ||
      winnerCount.data === undefined
    ) {
      return undefined;
    }
    return {
      addr,
      status: status.data,
      issuer: issuer.data,
      depositAmount: depositAmount.data,
      drawTime: drawTime.data,
      entropyTimeout: entropyTimeout.data,
      winnerCount: winnerCount.data,
      participantsLength: participantsLength.data ?? 0n,
      prizePoolAvailable: prizePoolAvailable.data,
      prizePoolReceived: prizePoolReceived.data,
      prizePerWinner: prizePerWinner.data ?? 0n,
      entropyRoot: entropyRoot.data ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      entropyCount: entropyCount.data ?? 0n,
      entropyFeePaid: entropyFeePaid.data ?? 0n,
      drawRequestedAt: drawRequestedAt.data ?? 0n,
      entropyFee: entropyFee.data ?? 0n,
    };
  }, [
    addr,
    status.data,
    issuer.data,
    depositAmount.data,
    drawTime.data,
    entropyTimeout.data,
    winnerCount.data,
    participantsLength.data,
    prizePoolAvailable.data,
    prizePoolReceived.data,
    prizePerWinner.data,
    entropyRoot.data,
    entropyCount.data,
    entropyFeePaid.data,
    drawRequestedAt.data,
    entropyFee.data,
  ]);

  return {
    data,
    isLoading: status.isLoading,
    refetch: () => {
      status.refetch();
      participantsLength.refetch();
      prizePoolAvailable.refetch();
      entropyRoot.refetch();
      prizePerWinner.refetch();
    },
  };
}

/// 当前连接身份的注册/中奖/领取状态
export function useIdentity(addr: Address | undefined) {
  const { address } = useConnection();
  const common = { address: addr, abi: lotteryAbi } as const;
  const q = { refetchInterval: POLL } as const;

  const registered = useReadContract({
    ...common,
    functionName: "registered",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: q,
  });
  const depositClaimed = useReadContract({
    ...common,
    functionName: "depositClaimed",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: q,
  });
  const isWinner = useReadContract({
    ...common,
    functionName: "isWinner",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: q,
  });
  const prizeClaimed = useReadContract({
    ...common,
    functionName: "prizeClaimed",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: q,
  });

  return {
    address,
    registered: registered.data,
    depositClaimed: depositClaimed.data,
    isWinner: isWinner.data,
    prizeClaimed: prizeClaimed.data,
  };
}

/// 读取历史事件日志（一次性拉取）
export function useLogs(
  addr: Address | undefined,
  eventName: string,
  { enabled = true, fromBlock = 0n }: { enabled?: boolean; fromBlock?: bigint } = {},
) {
  const client = usePublicClient();
  const [logs, setLogs] = useState<unknown[]>([]);
  useEffect(() => {
    if (!addr || !enabled || !client) return;
    let stop = false;
    client
      .getLogs({
        address: addr,
        event: lotteryAbi.find((i) => i.type === "event" && i.name === eventName) as never,
        fromBlock,
      })
      .then((res) => {
        if (!stop) setLogs(res as unknown[]);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr, enabled, eventName, client]);
  return logs;
}

/// 每秒跳动的时钟（倒计时用）
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
