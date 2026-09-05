"use client";

import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ConnectWallet } from "@/components/connect-wallet";
import { MintCard } from "@/components/mint-card";
import { MyNfts } from "@/components/my-nfts";
import { RecentMints } from "@/components/recent-mints";
import { abi, CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/contract";

export default function Home() {
  const { isConnected } = useAccount();

  const { data: totalSupply } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "totalSupply",
  });
  const { data: maxSupply } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "MAX_SUPPLY",
  });
  const { data: mintPrice } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "MINT_PRICE",
  });

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <span className="text-lg font-bold">Monad Blitz</span>
        <ConnectWallet />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 flex flex-col gap-8">
        <section className="flex flex-col items-center gap-3 text-center">
          <Badge variant="secondary">Monad testnet · chain 10143</Badge>
          <h1 className="text-4xl font-bold tracking-tight">Monad Blitz NFT</h1>
          <p className="max-w-xl text-muted-foreground">
            Fixed-price public mint on Monad — 400ms blocks and receipts in the
            same call via <code>eth_sendRawTransactionSync</code>.
          </p>
        </section>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-around gap-6 py-6">
            <div className="text-center">
              <div className="text-2xl font-bold">
                {totalSupply !== undefined && maxSupply !== undefined
                  ? `${totalSupply}/${maxSupply}`
                  : "—"}
              </div>
              <div className="text-sm text-muted-foreground">Minted</div>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div className="text-center">
              <div className="text-2xl font-bold">
                {mintPrice !== undefined
                  ? `${formatEther(mintPrice)} MON`
                  : "—"}
              </div>
              <div className="text-sm text-muted-foreground">Price</div>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <Button variant="outline" asChild>
              <a
                href={`${EXPLORER_URL}/token/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Monadscan
              </a>
            </Button>
          </CardContent>
        </Card>

        <MintCard isConnected={isConnected} />
        <MyNfts isConnected={isConnected} />
        <RecentMints />
      </main>
      <footer className="px-6 py-4 text-center text-sm text-muted-foreground border-t">
        Built with MONSKILLS · BlitzNFT on Monad testnet
      </footer>
    </div>
  );
}
