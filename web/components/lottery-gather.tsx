"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, usePublicClient, useWatchContractEvent, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectWallet, shortAddress } from "@/components/connect-wallet";
import { AppNav } from "@/components/app-nav";
import { lotteryAbi, errMsg } from "@/lib/lottery";
import { useIdentity, useLotteryAddr, useLotterySnapshot, useNow } from "@/lib/lottery-hooks";

interface EntropyItem {
  participant: Address;
  entropy: `0x${string}`;
  index: bigint;
}

export function LotteryGather() {
  const addr = useLotteryAddr();
  const client = usePublicClient();
  const { isConnected } = useConnection();
  const { data: snap, refetch } = useLotterySnapshot(addr);
  const id = useIdentity(addr);
  const { writeContractAsync, isPending } = useWriteContract();
  const now = useNow();

  const [items, setItems] = useState<EntropyItem[]>([]);
  const [myEntropy, setMyEntropy] = useState<`0x${string}` | null>(null);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [shakeSupported, setShakeSupported] = useState(false);
  const [manualSeed, setManualSeed] = useState("");
  const listeners = useRef<(() => void)[]>([]); // [windows shake cleanup]

  const loadHistory = useCallback(async () => {
    if (!client || !addr) return;
    try {
      // 1) 缓存先行渲染（回看历史活动时即时显示），并确定增量扫描下限
      const cacheKey = `mb-entropy-${addr.toLowerCase()}`;
      let cached: { items: { p: string; e: string; i: string }[]; scannedTo: string } | null = null;
      try {
        cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
      } catch {
        cached = null;
      }
      const cachedItems: EntropyItem[] = (cached?.items ?? []).map((x) => ({
        participant: x.p as Address,
        entropy: x.e as `0x${string}`,
        index: BigInt(x.i),
      }));
      if (cachedItems.length) setItems(cachedItems);

      // 2) 增量扫描：只扫缓存未覆盖的新块
      //    Monad eth_getLogs 限制 100 块范围 → 95 块分块；RPC 限流 25 req/s → 低并发 + 批间延时
      const latest = await client.getBlockNumber();
      const CHUNK = 95n;
      const WINDOW = 5700n; // 单次最多回看 ~80 分钟
      const floor = latest > WINDOW ? latest - WINDOW : 0n;
      const prevScanned = cached?.scannedTo ? BigInt(cached.scannedTo) : 0n;
      const target = floor > prevScanned + 1n ? floor : prevScanned + 1n;
      if (target > latest) return;

      const ranges: { start: bigint; end: bigint }[] = [];
      let end = latest;
      for (;;) {
        let start = end > CHUNK ? end - CHUNK : 0n;
        if (start < target) start = target;
        ranges.push({ start, end });
        if (start <= target) break;
        end = start - 1n;
      }

      const BATCH = 4;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const found: EntropyItem[] = [];
      for (let i = 0; i < ranges.length; i += BATCH) {
        const results = await Promise.all(
          ranges.slice(i, i + BATCH).map((r) =>
            client
              .getLogs({
                address: addr,
                event: {
                  type: "event",
                  name: "EntropySubmitted",
                  inputs: [
                    { name: "participant", type: "address", indexed: true },
                    { name: "entropy", type: "bytes32", indexed: false },
                    { name: "index", type: "uint256", indexed: false },
                  ],
                },
                fromBlock: r.start,
                toBlock: r.end,
              }).catch(() => []),
          ),
        );
        for (const logs of results) found.push(...(logs.map((l) => l.args as unknown as EntropyItem)));
        await sleep(300);
      }

      // 3) 合并去重（watch 事件与缓存可能重叠），回写缓存
      const byIndex = new Map<string, EntropyItem>();
      for (const it of cachedItems) byIndex.set(it.index.toString(), it);
      for (const it of found) byIndex.set(it.index.toString(), it);
      const merged = [...byIndex.values()].sort((a, b) => Number(a.index) - Number(b.index));
      setItems(merged);
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          items: merged.map((x) => ({ p: x.participant, e: x.entropy, i: x.index.toString() })),
          scannedTo: target.toString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [client, addr]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useWatchContractEvent({
    address: addr,
    abi: lotteryAbi,
    eventName: "EntropySubmitted",
    onLogs: (logs) => {
      const parsed = logs.map((l) => l.args as unknown as EntropyItem);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.index.toString()));
        const add = parsed.filter((p) => !seen.has(p.index.toString()));
        return add.length ? [...prev, ...add] : prev;
      });
      refetch();
    },
  });

  // ---- 产熵 ----
  const randomEntropy = useCallback(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex =
      "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") as `0x${string}`;
    setMyEntropy(hex);
    return hex;
  }, []);

  // 摇一摇（DeviceMotion，iOS 需用户手势触发权限）
  const requestShake = useCallback(async () => {
    type DME = { requestPermission?: () => Promise<string> };
    const dme = (window as unknown as { DeviceMotionEvent?: DME }).DeviceMotionEvent;
    if (dme?.requestPermission) {
      try {
        const res = await dme.requestPermission();
        if (res !== "granted") return;
      } catch {
        return;
      }
    }
    setShakeSupported(true);
  }, []);

  useEffect(() => {
    const handler = () => {
      randomEntropy();
      if (navigator.vibrate) navigator.vibrate(200);
    };
    window.addEventListener("monad-blitz-shake", handler);
    return () => window.removeEventListener("monad-blitz-shake", handler);
  }, [randomEntropy]);

  useEffect(() => {
    if (!shakeSupported) return;
    let last = { x: 0, y: 0, z: 0, t: 0 };
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const t = Date.now();
      const dx = Math.abs((a.x ?? 0) - last.x);
      const dy = Math.abs((a.y ?? 0) - last.y);
      const dz = Math.abs((a.z ?? 0) - last.z);
      if (t - last.t > 700 && (dx > 18 || dy > 18 || dz > 18)) {
        last = { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0, t };
        window.dispatchEvent(new Event("monad-blitz-shake"));
      } else if (t - last.t > 500) {
        last = { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0, t };
      }
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [shakeSupported]);

  // ---- 提交 ----
  const submit = async (e: `0x${string}`) => {
    try {
      setTxMsg("提交熵：请确认钱包交易…");
      const hash = await writeContractAsync({
        address: addr,
        abi: lotteryAbi,
        functionName: "submitEntropy",
        args: [e],
      } as never);
      setTxMsg(`提交熵：交易 ${shortAddress(hash)} 等待上链…`);
      await client?.waitForTransactionReceipt({ hash });
      setTxMsg("提交熵：完成 ✓（已计入链上熵根）");
      refetch();
      loadHistory();
      setTimeout(() => setTxMsg(null), 5000);
    } catch (err) {
      setTxMsg(`提交熵：${errMsg(err)}`);
      setTimeout(() => setTxMsg(null), 6000);
    }
  };

  const open = snap?.status === 0;
  const urlSig = (() => {
    if (typeof window === "undefined") return null;
    const sig = new URLSearchParams(window.location.search).get("sig");
    return sig?.startsWith("0x") ? (sig as `0x${string}`) : null;
  })();

  // 缺 ?addr=：明确提示（不回落到任意合约）
  if (!addr) {
    return (
      <div className="flex flex-col flex-1 min-h-screen">
        <AppNav title="集熵现场" right={<ConnectWallet />} />
        <main className="mx-auto w-full max-w-md flex-1 px-6 py-8 flex flex-col gap-6">
          <Card>
            <CardContent className="py-4 flex flex-col gap-3 text-sm">
              <div className="font-medium">缺少活动参数</div>
              <div className="text-muted-foreground">
                请使用带 <code className="font-mono">?addr=合约地址</code> 的活动链接（从首页活动列表或现场二维码进入）。
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

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <AppNav title="集熵现场" right={<ConnectWallet />} />

      <main className="mx-auto w-full max-w-md flex-1 px-6 py-8 flex flex-col gap-6">
        {/* 熵根展示 */}
        <Card>
          <CardContent className="py-4 flex flex-col gap-1">
            <div className="text-xs text-muted-foreground">聚合熵根（链上实时）</div>
            <div className="font-mono text-sm break-all">
              {snap?.entropyRoot ?? "加载中…"}
            </div>
            <div className="text-xs text-muted-foreground">
              已提交 {snap?.entropyCount.toString() ?? "…"} 条 ·{" "}
              {snap && snap.entropyRoot !== "0x" + "0".repeat(64)
                ? "开奖将强制使用此熵根"
                : "暂无熵，开奖用承诺 seed"}
            </div>
          </CardContent>
        </Card>

        {txMsg && <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">{txMsg}</div>}

        {/* 注册入口（未注册 + Open） */}
        {open && addr && snap && !id.registered && Number(snap.drawTime) > now && (
          <RegisterEntry
            addr={addr}
            snap={snap}
            id={id}
            isConnected={isConnected}
            urlSig={urlSig}
            onDone={() => refetch()}
          />
        )}

        {/* 产熵提交 */}
        {open && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">提交你的熵</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!id.registered && (
                <div className="text-sm text-muted-foreground">仅限已注册参与者</div>
              )}
              {id.registered && (
                <>
                  {myEntropy && (
                    <div className="text-xs text-muted-foreground break-all font-mono">
                      你的熵：{myEntropy}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      disabled={isPending}
                      onClick={requestShake}
                      className={shakeSupported ? "animate-pulse" : ""}
                    >
                      📱 {shakeSupported ? "摇一摇已开启" : "开启摇一摇"}
                    </Button>
                    <Button variant="outline" disabled={isPending} onClick={randomEntropy}>
                      🎲 随机生成
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      placeholder="或手动输入熵（0x…64位hex）"
                      value={manualSeed}
                      onChange={(e) => setManualSeed(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const v = manualSeed.trim() as `0x${string}`;
                        if (/^0x[0-9a-fA-F]{64}$/.test(v)) setMyEntropy(v);
                      }}
                    >
                      采用
                    </Button>
                  </div>
                  <Button disabled={!myEntropy || isPending} onClick={() => myEntropy && submit(myEntropy)}>
                    {isPending ? "提交中…" : "提交熵上链"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* 实时熵列表 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">现场熵流（{items.length}）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 max-h-96 overflow-auto">
            {items.length === 0 && (
              <span className="text-sm text-muted-foreground">暂无提交，等你的第一条熵</span>
            )}
            {items
              .slice()
              .reverse()
              .map((it) => (
                <div key={it.index.toString()} className="text-xs break-all">
                  <Badge variant="outline">#{it.index.toString()}</Badge>{" "}
                  {shortAddress(it.participant)}{" "}
                  <span className="font-mono text-muted-foreground">
                    {it.entropy.slice(0, 18)}…
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/// 未注册观众的注册入口：线下模式要求 URL 带签发凭证（扫 /host 码），线上模式直接注册
function RegisterEntry({
  addr,
  snap,
  id,
  isConnected,
  urlSig,
  onDone,
}: {
  addr: Address;
  snap: { issuer: Address; depositAmount: bigint };
  id: { registered?: boolean; address?: Address };
  isConnected: boolean;
  urlSig: `0x${string}` | null;
  onDone: () => void;
}) {
  const client = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [msg, setMsg] = useState<string | null>(null);
  const offline = snap.issuer !== "0x0000000000000000000000000000000000000000";

  const register = async () => {
    try {
      setMsg("注册：请确认钱包交易（含押金）…");
      const hash = await writeContractAsync({
        address: addr,
        abi: lotteryAbi,
        functionName: "register",
        args: [urlSig ?? "0x"],
        value: snap.depositAmount,
      } as never);
      await client?.waitForTransactionReceipt({ hash });
      setMsg("注册成功 ✓ 可开始提交熵");
      onDone();
    } catch (e) {
      setMsg(`注册：${errMsg(e)}`);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">注册参与</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="text-sm text-muted-foreground">
          押金 {Number(snap.depositAmount) / 1e18} MON，开奖后可领回
        </div>
        {offline && !urlSig ? (
          <div className="text-sm text-muted-foreground">
            线下验签活动：请先扫工作人员的注册二维码
          </div>
        ) : (
          <Button disabled={!isConnected || isPending} onClick={register}>
            {offline ? "凭二维码凭证注册" : "注册（无许可）"}
          </Button>
        )}
        {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
      </CardContent>
    </Card>
  );
}
