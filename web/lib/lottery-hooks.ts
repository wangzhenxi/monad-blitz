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

export interface DeployInfo {
  block: bigint;
  /// 部署块时间戳（秒）
  time: number;
}

/// 活动创建时间：二分查找合约部署块（getCode 从无到有的边界）→ 取块时间戳。
/// 链上不存创建时间，只能从区块推导；结果 localStorage 永久缓存（mb-deploy-{addr}）。
/// RPC 不稳定时静默失败（返回 undefined），下次访问重试。
export function useDeployInfo(addr: Address | undefined): DeployInfo | undefined {
  const client = usePublicClient();
  const [info, setInfo] = useState<DeployInfo | undefined>(undefined);
  useEffect(() => {
    if (!client || !addr) {
      setInfo(undefined);
      return;
    }
    let stop = false;
    (async () => {
      const key = `mb-deploy-${addr.toLowerCase()}`;
      const save = (v: { block: string; time?: number }) =>
        localStorage.setItem(key, JSON.stringify(v));
      // 缓存先行（含"只有块号缺时间戳"的部分缓存）
      let cachedBlock: bigint | null = null;
      try {
        const c = JSON.parse(localStorage.getItem(key) ?? "null");
        if (c?.block) {
          if (c.time) {
            setInfo({ block: BigInt(c.block), time: Number(c.time) });
            return;
          }
          cachedBlock = BigInt(c.block);
        }
      } catch {
        /* 缓存损坏则重查 */
      }
      if (stop) return;

      let deployBlock = cachedBlock;
      if (deployBlock === null) {
        // 二分查找：getCode(addr, mid) 有代码 → 部署 ≤ mid
        const getCodeSafe = async (b: bigint): Promise<string | null | undefined> => {
          for (let i = 0; i < 2; i++) {
            try {
              return await client.getCode({ address: addr, blockNumber: b });
            } catch {
              /* 重试一次 */
            }
          }
          return null; // 网络失败，放弃本次查找
        };
        let lo = 0n;
        const latest = await client.getBlockNumber().catch(() => null);
        if (latest === null) return;
        // RPC 历史状态仅保留近期 ~100 万块；二分下界限制在窗口内，
        // 若窗口底已有代码说明合约太老（超出可追溯范围），放弃
        const HISTORY_WINDOW = 1_000_000n;
        lo = latest > HISTORY_WINDOW ? latest - HISTORY_WINDOW : 0n;
        const oldest = await getCodeSafe(lo);
        if (oldest === null) return;
        if (oldest && oldest !== "0x") return; // 超出历史窗口，无法定位部署块
        let hi: bigint = latest;
        while (lo < hi) {
          if (stop) return;
          const mid: bigint = (lo + hi) / 2n;
          const code = await getCodeSafe(mid);
          if (code === null) return; // 中途断网：不缓存，下次重试
          if (code && code !== "0x") hi = mid;
          else lo = mid + 1n;
        }
        const code = await getCodeSafe(lo);
        if (code === null || code === "0x") return; // 非合约地址
        deployBlock = lo;
        save({ block: deployBlock.toString() }); // 先缓存块号
      }
      if (stop) return;

      const blk = await client.getBlock({ blockNumber: deployBlock }).catch(() => null);
      if (!blk) return; // 时间戳下次补
      const result = { block: deployBlock, time: Number(blk.timestamp) };
      save({ block: deployBlock.toString(), time: result.time });
      if (!stop) setInfo(result);
    })();
    return () => {
      stop = true;
    };
  }, [client, addr]);
  return info;
}

/// 参与者注册时间：从部署块向上 95 块分块扫描 Registered 事件（Monad getLogs 限 100 块）。
/// 演示活动锁仓短、注册集中在创建后不久，从部署块向上扫通常 1-2 个分块即命中；
/// 找齐 expected 条提前停止；块号→时间戳与结果一并缓存（mb-reg-{addr}）。
/// 返回 Record<参与者地址(小写), 时间戳秒>，缺失者由调用方显示占位。
export function useRegisterTimes(
  addr: Address | undefined,
  deployBlock: bigint | undefined,
  expected: number | undefined,
): Record<string, number> {
  const client = usePublicClient();
  const [times, setTimes] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!client || !addr || deployBlock === undefined || !expected || expected <= 0) {
      setTimes({});
      return;
    }
    let stop = false;
    (async () => {
      const key = `mb-reg-${addr.toLowerCase()}`;
      let cached: { times: Record<string, string>; blocks: Record<string, string> } = {
        times: {},
        blocks: {},
      };
      try {
        cached = JSON.parse(localStorage.getItem(key) ?? "null") ?? cached;
      } catch {
        /* 缓存损坏则重扫 */
      }
      const map: Record<string, number> = {};
      for (const [p, t] of Object.entries(cached.times)) map[p] = Number(t);
      setTimes({ ...map }); // 缓存先行渲染
      if (Object.keys(map).length >= expected) return; // 已找齐

      const latest = await client.getBlockNumber().catch(() => null);
      if (latest === null || stop) return;

      // 部署块 → 最新块升序分块（与抽奖现场页同款扫描参数）
      const CHUNK = 95n;
      const MAX_CHUNKS = 600; // 兜底：最多扫 ~600*95 块，防超长活动拖死页面
      const ranges: { start: bigint; end: bigint }[] = [];
      let start = deployBlock;
      for (;;) {
        let end = start + CHUNK - 1n;
        if (end > latest) end = latest;
        ranges.push({ start, end });
        if (end >= latest || ranges.length >= MAX_CHUNKS) break;
        start = end + 1n;
      }

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const found: { participant: string; block: bigint }[] = [];
      const BATCH = 4;
      scan: for (let i = 0; i < ranges.length; i += BATCH) {
        if (stop) return;
        const results = await Promise.all(
          ranges
            .slice(i, i + BATCH)
            .map((r) =>
              client
                .getLogs({
                  address: addr,
                  event: {
                    type: "event",
                    name: "Registered",
                    inputs: [{ name: "participant", type: "address", indexed: true }],
                  },
                  fromBlock: r.start,
                  toBlock: r.end,
                })
                .catch(() => []),
            ),
        );
        for (const logs of results) {
          for (const l of logs) {
            const p = l.args.participant as Address | undefined;
            if (p) found.push({ participant: p.toLowerCase(), block: l.blockNumber });
          }
        }
        // 提前停止：已发现的独立参与者数（含缓存）够了
        if (
          new Set([...Object.keys(map), ...found.map((f) => f.participant)]).size >= expected
        ) {
          break scan;
        }
        await sleep(300);
      }
      if (stop) return;

      // 块号 → 时间戳（缓存命中跳过，4 并发）
      const blocks: Record<string, string> = { ...cached.blocks };
      const need = [...new Set(found.map((f) => f.block.toString()))].filter(
        (b) => !(b in blocks),
      );
      for (let i = 0; i < need.length; i += 4) {
        const wave = need.slice(i, i + 4);
        const blks = await Promise.all(
          wave.map((b) => client.getBlock({ blockNumber: BigInt(b) }).catch(() => null)),
        );
        wave.forEach((b, j) => {
          if (blks[j]) blocks[b] = Number(blks[j].timestamp).toString();
        });
      }
      for (const f of found) {
        const ts = blocks[f.block.toString()];
        if (ts) map[f.participant] = Number(ts);
      }
      localStorage.setItem(key, JSON.stringify({ times: map, blocks }));
      if (!stop) setTimes({ ...map });
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, addr, deployBlock?.toString(), expected]);
  return times;
}
