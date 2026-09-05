"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicClient } from "viem";
import { useConnection, usePublicClient } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { abi, CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/contract";

type NftItem = {
  tokenId: bigint;
  name: string;
  description: string;
  image: string;
};

const MAX_TOKENS_TO_SCAN = 200;

export function MyNfts({ isConnected }: { isConnected: boolean }) {
  const { address } = useConnection();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const [items, setItems] = useState<NftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || !publicClient) return;
    setLoading(true);
    setError(null);
    try {
      const totalSupply = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi,
        functionName: "totalSupply",
      })) as bigint;

      const scanTo =
        totalSupply > BigInt(MAX_TOKENS_TO_SCAN)
          ? BigInt(MAX_TOKENS_TO_SCAN)
          : totalSupply;

      const owned: bigint[] = [];
      const owners = await Promise.all(
        Array.from({ length: Number(scanTo) }, (_, i) =>
          publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi,
            functionName: "ownerOf",
            args: [BigInt(i + 1)],
          })
        )
      );
      owners.forEach((owner, i) => {
        if (owner.toLowerCase() === address.toLowerCase())
          owned.push(BigInt(i + 1));
      });

      const metas = await Promise.all(
        owned.map(async (tokenId) => {
          const tokenUri = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi,
            functionName: "tokenURI",
            args: [tokenId],
          })) as string;
          const res = await fetch(tokenUri);
          if (!res.ok) throw new Error(`Metadata fetch failed for #${tokenId}`);
          const json = (await res.json()) as {
            name?: string;
            description?: string;
            image?: string;
          };
          return {
            tokenId,
            name: json.name ?? `Monad Blitz #${tokenId}`,
            description: json.description ?? "",
            image: json.image ?? "",
          };
        })
      );
      setItems(metas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load NFTs");
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>My NFTs</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent>
        {!isConnected && (
          <p className="text-sm text-muted-foreground">
            Connect your wallet to see your NFTs.
          </p>
        )}
        {isConnected && error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {isConnected && !error && items.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            You don&apos;t own any Monad Blitz NFTs yet.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <a
              key={item.tokenId.toString()}
              href={`${EXPLORER_URL}/token/${CONTRACT_ADDRESS}?a=${item.tokenId}`}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-lg border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.name}
                className="aspect-square w-full object-cover transition group-hover:scale-105"
              />
              <div className="p-2 text-sm font-medium">{item.name}</div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
