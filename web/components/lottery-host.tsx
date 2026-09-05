"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, concat, toHex, hexToBytes } from "viem";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { shortAddress } from "@/lib/lottery";
import { AppNav } from "@/components/app-nav";
import { useLotteryAddr, useLotterySnapshot } from "@/lib/lottery-hooks";

/// 签名 digest：keccak256(abi.encodePacked(participant, lottery, expiry))
function buildDigest(participant: `0x${string}`, lottery: `0x${string}`, expiry: bigint) {
  const packed = concat([
    hexToBytes(participant), // address 20 字节（encodePacked 不 pad）
    hexToBytes(lottery),
    toHex(expiry, { size: 32 }),
  ]);
  return keccak256(packed);
}

export function LotteryHost() {
  const addr = useLotteryAddr();
  const { data: snap } = useLotterySnapshot(addr);

  const [issuerKey, setIssuerKey] = useState("");
  const [participant, setParticipant] = useState("");
  // 默认今日 23:59:59：依赖本地时区与当前时间，须挂载后再置值（SSR 首帧渲染空串，避免 hydration mismatch）
  const [expiry, setExpiry] = useState("");
  useEffect(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    setExpiry(Math.floor(d.getTime() / 1000).toString());
  }, []);
  const [issued, setIssued] = useState<{
    participant: string;
    sig: `0x${string}`;
    expiry: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const account = useMemo(() => {
    if (/^0x[0-9a-fA-F]{64}$/.test(issuerKey.trim())) {
      try {
        return privateKeyToAccount(issuerKey.trim() as `0x${string}`);
      } catch {
        return null;
      }
    }
    return null;
  }, [issuerKey]);

  const issuerOnChain = snap?.issuer;
  const keyMatches =
    account && issuerOnChain
      ? account.address.toLowerCase() === issuerOnChain.toLowerCase()
      : null;

  const sign = useCallback(async () => {
    setError(null);
    if (!addr) {
      setError("合约地址未就绪");
      return;
    }
    if (!account) {
      setError("请输入合法的 issuer 私钥");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(participant.trim())) {
      setError("参与者地址格式错误");
      return;
    }
    const expiryNum = Number(expiry);
    if (!expiryNum || expiryNum < Math.floor(Date.now() / 1000)) {
      setError("有效期须为未来时间");
      return;
    }
    if (keyMatches === false) {
      setError(`私钥与链上 issuer 不符（链上 ${shortAddress(issuerOnChain!)}）`);
      return;
    }
    try {
      const digest = buildDigest(
        participant.trim().toLowerCase() as `0x${string}`,
        addr.toLowerCase() as `0x${string}`,
        BigInt(expiryNum),
      );
      // EIP-191 个人签名（对应合约 MessageHashUtils.toEthSignedMessageHash）
      const signature = (await account.signMessage({
        message: { raw: digest },
      })) as `0x${string}`;
      // 合约期望 sig = abi.encodePacked(uint256(expiry), ecdsa(65))
      const sig = concat([toHex(BigInt(expiryNum), { size: 32 }), hexToBytes(signature)]) as `0x${string}`;
      setIssued({ participant: participant.trim(), sig, expiry: expiryNum });
    } catch (e) {
      setError(`签名失败：${(e as Error).message}`);
    }
  }, [account, participant, expiry, keyMatches, issuerOnChain, addr]);

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
  const qrValue = issued
    ? `${APP_URL}/gather?addr=${addr}&sig=${issued.sig}`
    : "";

  // 缺 ?addr=：明确提示（签名 digest 绑定合约地址，必须有活动上下文）
  if (!addr) {
    return (
      <div className="flex flex-col flex-1 min-h-screen">
        <AppNav title="签发工具" right={<Badge variant="secondary">私钥仅存浏览器内存，关页即焚</Badge>} />
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 flex flex-col gap-6">
          <Card>
            <CardContent className="py-4 flex flex-col gap-3 text-sm">
              <div className="font-medium">缺少活动参数</div>
              <div className="text-muted-foreground">
                签名绑定活动合约地址，请使用带 <code className="font-mono">?addr=合约地址</code> 的链接进入。
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
      <AppNav title="签发工具" right={<Badge variant="secondary">私钥仅存浏览器内存，关页即焚</Badge>} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 flex flex-col gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">签发配置</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              本期活动合约：{addr ? shortAddress(addr) : "…"} · 链上 issuer：{" "}
              {issuerOnChain && issuerOnChain !== "0x0000000000000000000000000000000000000000"
                ? shortAddress(issuerOnChain)
                : "线上无许可模式（无需签发）"}
            </div>
            <label className="text-sm font-medium" htmlFor="issuer-key">
              Issuer 私钥（工作人员临时密钥）
            </label>
            <Input
              id="issuer-key"
              type="password"
              placeholder="0x…（演示密钥见 contracts/.env 的 ISSUER_PRIVATE_KEY）"
              value={issuerKey}
              onChange={(e) => setIssuerKey(e.target.value)}
            />
            {account && (
              <div className="text-xs">
                派生地址 {shortAddress(account.address)}{" "}
                {keyMatches ? (
                  <Badge>与链上 issuer 匹配 ✓</Badge>
                ) : (
                  <Badge variant="destructive">不匹配</Badge>
                )}
              </div>
            )}
            <Separator />
            <label className="text-sm font-medium" htmlFor="participant">
              参与者地址
            </label>
            <Input
              id="participant"
              placeholder="0x…"
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
            />
            <label className="text-sm font-medium" htmlFor="expiry">
              签名有效期（Unix 秒，默认今日 23:59:59）
            </label>
            <Input
              id="expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            {error && <div className="text-sm text-red-500">{error}</div>}
            <Button disabled={!account} onClick={sign}>
              本地签名并生成二维码
            </Button>
          </CardContent>
        </Card>

        {issued && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">参与者注册二维码</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <div className="border rounded-lg p-4 bg-white">
                <QRCodeSVG value={qrValue} size={220} />
              </div>
              <div className="text-sm text-muted-foreground text-center">
                参与者扫码 → 打开集熵页 → 连接钱包 → 凭此签名注册（押金托管）
              </div>
              <div className="text-xs text-muted-foreground break-all max-w-lg">
                签名（97 字节）：<span className="font-mono">{issued.sig}</span>
              </div>
              <Button
                variant="outline"
                onClick={() => navigator.clipboard?.writeText(qrValue)}
              >
                复制注册链接
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
