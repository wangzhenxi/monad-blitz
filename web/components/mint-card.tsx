"use client";

import { useState } from "react";
import { encodeFunctionData, formatEther } from "viem";
import { usePublicClient, useReadContract, useWriteContractSync } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { abi, CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/contract";
import { monadTestnet } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";

export function MintCard({ isConnected }: { isConnected: boolean }) {
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });

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

  const { writeContractSyncAsync, isPending } = useWriteContractSync();

  const qty = BigInt(Math.max(1, Math.min(10, parseInt(quantity) || 1)));
  const cost = mintPrice ? mintPrice * qty : null;
  const soldOut =
    totalSupply !== undefined &&
    maxSupply !== undefined &&
    totalSupply >= maxSupply;

  async function handleMint() {
    setError(null);
    setTxHash(null);
    setStatus(null);
    if (!publicClient || !isConnected || cost === null) return;

    try {
      // Monad charges on gas_limit, not gas used — set a tight explicit
      // limit (estimate + at most 10% buffer) instead of a wallet fallback.
      const data = encodeFunctionData({
        abi,
        functionName: "mint",
        args: [qty],
      });
      const estimate = await publicClient.estimateGas({
        to: CONTRACT_ADDRESS,
        data,
        value: cost,
      });
      const gasLimit = estimate + estimate / 10n;

      const receipt = await writeContractSyncAsync({
        address: CONTRACT_ADDRESS,
        abi,
        functionName: "mint",
        args: [qty],
        value: cost,
        gas: gasLimit,
      });
      setTxHash(receipt?.transactionHash ?? null);
      setStatus("Minted!");
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mint Monad Blitz</CardTitle>
        <CardDescription>
          {mintPrice !== undefined
            ? `${formatEther(mintPrice)} MON per NFT`
            : "Loading price…"}
          {totalSupply !== undefined &&
            maxSupply !== undefined &&
            ` · ${totalSupply.toString()}/${maxSupply.toString()} minted`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={10}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-24"
            disabled={isPending || soldOut}
          />
          <span className="text-sm text-muted-foreground">
            {cost !== null
              ? `Total: ${formatEther(cost)} MON`
              : ""}
          </span>
        </div>
        <Button
          onClick={handleMint}
          disabled={!isConnected || isPending || soldOut}
        >
          {soldOut
            ? "Sold out"
            : !isConnected
              ? "Connect wallet to mint"
              : isPending
                ? "Minting…"
                : `Mint ${qty.toString()} NFT${qty > 1n ? "s" : ""}`}
        </Button>
        {status && <p className="text-sm text-green-600">{status}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {txHash && (
          <a
            className="text-sm underline"
            href={`${EXPLORER_URL}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction on Monadscan
          </a>
        )}
      </CardContent>
    </Card>
  );
}
