"use client";

import { Badge } from "@/components/ui/badge";
import { ConnectWallet } from "@/components/connect-wallet";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <span className="text-lg font-bold">Monad Blitz</span>
        <ConnectWallet />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 flex flex-col items-center gap-6 text-center">
        <Badge variant="secondary">Monad testnet · chain 10143</Badge>
        <h1 className="text-4xl font-bold tracking-tight">
          链上可信抽奖平台
        </h1>
        <p className="max-w-xl text-muted-foreground">
          智能合约托管押金 + Pyth Entropy 可验证随机数，开发中（13:00 起）。
          参与页、集熵页（/gather）、签发工具页（/host）即将上线。
        </p>
      </main>
      <footer className="px-6 py-4 text-center text-sm text-muted-foreground border-t">
        Monad Blitz · Escrow + VRF Lottery
      </footer>
    </div>
  );
}
