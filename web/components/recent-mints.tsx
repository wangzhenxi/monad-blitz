"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useConfig, usePublicClient } from "wagmi";
import { watchContractEvent } from "wagmi/actions";
import { monadTestnet } from "wagmi/chains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortAddress } from "@/components/connect-wallet";
import { abi, CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/contract";

type MintEvent = {
  tokenId: bigint;
  to: string;
  txHash: string | null;
  price?: string;
};

export function RecentMints() {
  const config = useConfig();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const [mints, setMints] = useState<MintEvent[]>([]);

  useEffect(() => {
    if (!publicClient) return;
    let unwatch: (() => void) | undefined;
    let cancelled = false;

    async function run() {
      const latest = await publicClient.getBlockNumber();
      const fromBlock = latest > 5000n ? latest - 5000n : 0n;
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: {
          type: "event",
          name: "Transfer",
          inputs: [
            { name: "from", type: "address", indexed: true },
            { name: "to", type: "address", indexed: true },
            { name: "tokenId", type: "uint256", indexed: true },
          ],
        },
        args: { from: null },
        fromBlock,
      });
      const mintEvents: MintEvent[] = logs
        .filter((log) => log.args.from === "0x0000000000000000000000000000000000000000")
        .map((log) => ({
          tokenId: log.args.tokenId!,
          to: log.args.to!,
          txHash: log.transactionHash ?? null,
        }))
        .reverse()
        .slice(0, 12);
      if (!cancelled) setMints(mintEvents);

      unwatch = watchContractEvent(config, {
        address: CONTRACT_ADDRESS,
        abi,
        eventName: "Transfer",
        onLogs: (newLogs) => {
          const fresh = newLogs
            .filter((log) => log.args.from === "0x0000000000000000000000000000000000000000")
            .map((log) => ({
              tokenId: log.args.tokenId!,
              to: log.args.to!,
              txHash: log.transactionHash ?? null,
            }));
          if (fresh.length > 0) {
            setMints((prev) => [...fresh.reverse(), ...prev].slice(0, 12));
          }
        },
      });
    }

    void run();
    return () => {
      cancelled = true;
      unwatch?.();
    };
  }, [config, publicClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent mints</CardTitle>
      </CardHeader>
      <CardContent>
        {mints.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No mints yet — be the first!
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {mints.map((mint) => (
            <li key={`${mint.txHash}-${mint.tokenId}`} className="flex items-center justify-between text-sm">
              <a
                className="font-medium underline"
                href={`${EXPLORER_URL}/token/${CONTRACT_ADDRESS}?a=${mint.tokenId}`}
                target="_blank"
                rel="noreferrer"
              >
                Monad Blitz #{mint.tokenId}
              </a>
              <span className="text-muted-foreground">
                minted to{" "}
                <a
                  className="underline"
                  href={`${EXPLORER_URL}/address/${mint.to}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(mint.to)}
                </a>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
