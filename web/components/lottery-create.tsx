"use client";

import { useMemo, useState } from "react";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { decodeEventLog, type Address } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  formatTs,
  lotteryAbi,
  shortAddress,
  errMsg,
} from "@/lib/lottery";
import { useDeployInfo } from "@/lib/lottery-hooks";

/// 弹窗内的一行链接：标签 + 完整链接 + 复制按钮（复制后短暂显示"已复制"）
function CopyRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 剪贴板 API 不可用时的兜底（非 HTTPS / 旧浏览器）
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">
        {url}
      </span>
      <Button variant="outline" size="sm" className="shrink-0" onClick={copy}>
        {copied ? "已复制 ✓" : "复制"}
      </Button>
    </div>
  );
}

/// 活动行：链上实时状态 + 直达入口（主页面 / 抽奖现场）
function ActivityRow({ addr }: { addr: Address }) {
  const q = { refetchInterval: 10_000 } as const;
  const created = useDeployInfo(addr); // 创建时间：部署块时间戳（首次访问二分查找，之后走缓存）
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
            押金 {formatMON(deposit)} MON · {winnerCount.toString()} 名中奖 · 创建{" "}
            {created ? formatTs(created.time) : "…"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <a
          className="text-sm underline text-muted-foreground hover:text-foreground"
          href={`/gather?addr=${addr}`}
        >
          抽奖现场
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
  const [prizePool, setPrizePool] = useState("0.1");
  const [lockMinutes, setLockMinutes] = useState("3");
  const [winnerCount, setWinnerCount] = useState("3");

  const [msg, setMsg] = useState<string | null>(null);
  const [manualAddr, setManualAddr] = useState("");
  const [registering, setRegistering] = useState(false);
  /// 创建成功的新活动地址（非空时弹出"复制活动链接"弹窗）
  const [created, setCreated] = useState<Address | null>(null);

  // 链上活动列表：工厂注册表 getLotteries()（新创建的在前）
  const { data: lotteries, isLoading: listLoading, refetch: refetchList } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getLotteries",
    query: { refetchInterval: 15_000 },
  });
  const list = useMemo(() => [...(lotteries ?? [])].reverse(), [lotteries]);

  /// issuer 地址归一化：去空白与零宽字符（从文档/网页复制时常见坑，肉眼不可见但校验必挂）
  const cleanIssuer = (raw: string) =>
    raw.replace(/[\s\u200b\u200c\u200d\ufeff\u00a0]/g, "");

  /// issuer 地址实时校验：错误信息具体化（区分"没填"与"格式错在哪"），
  /// 避免"填了地址却提示需提供地址"的误导
  const issuerError = useMemo(() => {
    if (mode !== "offline") return null;
    if (issuerAddr.trim() === "") return "线下模式需填写 Issuer 地址";
    const cleaned = cleanIssuer(issuerAddr);
    if (!cleaned.startsWith("0x")) return "Issuer 地址格式错误：须以 0x 开头";
    if (cleaned.length === 42 && /^[0-9a-fA-F]+$/.test(cleaned.slice(2))) return null;
    const hexLen = cleaned.length - 2;
    if (/…/.test(cleaned)) return "Issuer 地址格式错误：这是缩写地址（含 …），须填完整 42 位地址";
    if (hexLen !== 40) return `Issuer 地址格式错误：须为 0x + 40 位十六进制（当前 ${hexLen} 位）`;
    return "Issuer 地址格式错误：含非十六进制字符";
  }, [mode, issuerAddr]);

  const validate = (): string | null => {
    const dep = Number(deposit);
    if (!dep || dep <= 0) return "押金须为正数（MON）";
    const pp = prizePool.trim() === "" ? 0 : Number(prizePool);
    if (Number.isNaN(pp) || pp < 0) return "初始奖池须为非负数字（MON），0 = 不注资";
    const mins = Number(lockMinutes);
    if (!mins || mins <= 0) return "锁仓时长须为正数（分钟）";
    const wc = Number(winnerCount);
    if (!Number.isInteger(wc) || wc < 1) return "中奖人数须为 ≥1 的整数";
    if (issuerError) return issuerError;
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
      setMsg(`创建成功 ✓ ${shortAddress(lotteryAddr)}`);
      setCreated(lotteryAddr);

      // 初始奖池 > 0：创建交易上链后自动发起第二笔注资（前端方案，两笔交易）
      const pp = prizePool.trim() === "" ? 0 : Number(prizePool);
      const prizeWei = BigInt(Math.floor(pp * 1e18));
      if (prizeWei > 0n) {
        setMsg(`活动已创建 ✓ 正在注入初始奖池 ${pp} MON，请在钱包确认第二笔交易…`);
        try {
          const fundHash = await writeContractAsync({
            address: lotteryAddr,
            abi: lotteryAbi,
            functionName: "fundPrizePool",
            value: prizeWei,
          });
          setMsg(`注资交易已提交 ${shortAddress(fundHash)}，等待上链…`);
          await client.waitForTransactionReceipt({ hash: fundHash });
          setMsg(`创建成功 ✓ ${shortAddress(lotteryAddr)} · 奖池已注入 ${pp} MON`);
        } catch (e) {
          setMsg(
            `活动已创建 ✓ ${shortAddress(lotteryAddr)}，但奖池注入未完成：${errMsg(e)}。` +
              `可稍后用 CLI fundPrizePool() 补注。`,
          );
        }
      }
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
                  placeholder="0x…（完整 42 位地址，勿复制缩写形式）"
                  value={issuerAddr}
                  aria-invalid={issuerError ? true : undefined}
                  onChange={(e) => setIssuerAddr(e.target.value)}
                />
                {issuerAddr.trim() !== "" && issuerError && (
                  <div className="mt-1 text-xs text-destructive break-all">{issuerError}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                <label className="text-sm font-medium" htmlFor="prizepool">
                  初始奖池（MON）
                </label>
                <Input
                  id="prizepool"
                  className="mt-1"
                  placeholder="0 = 不注资"
                  value={prizePool}
                  onChange={(e) => setPrizePool(e.target.value)}
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
              初始奖池在创建交易确认后自动发起第二笔注资交易（与押金分离，开奖时中奖者均分）。
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
            {list.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                <span>合约地址 · 状态 · 人数/集熵条数 · 押金/中奖人数/创建时间</span>
                <span>入口</span>
              </div>
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

      {/* 创建成功：复制活动链接弹窗 */}
      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>活动创建成功 🎉</DialogTitle>
            <DialogDescription>
              复制下方链接分享给参与者。线下验签活动请先在「入场管理」页生成入场凭证。
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="flex flex-col gap-2">
              <CopyRow label="活动详情" url={`${window.location.origin}/play?addr=${created}`} />
              <CopyRow label="抽奖现场" url={`${window.location.origin}/gather?addr=${created}`} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              留在本页
            </Button>
            <Button
              onClick={() => {
                if (created) window.location.href = `/play?addr=${created}`;
              }}
            >
              进入活动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
