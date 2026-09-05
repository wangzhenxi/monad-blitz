"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortAddress } from "@/components/connect-wallet";
import { CONTRACT_ADDRESS, EXPLORER_URL } from "@/lib/contract";

type MintEvent = {
  tokenId: bigint;
  to: string;
  txHash: string | null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// Monad public RPC limits eth_getLogs to a 100-block range; 400ms blocks
// means each chunk covers ~40 seconds of history.
const CHUNK_SIZE = 100n;
const MAX_CHUNKS = 10n; // ~6.7 minutes of lookback
const POLL_INTERVAL_MS = 4_000;

export function RecentMints() {
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const [mints, setMints] = useState<MintEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function fetchRecentMints() {
      const latest = await publicClient.getBlockNumber();
      const end = latest;
      const start =
        end > CHUNK_SIZE * MAX_CHUNKS ? end - CHUNK_SIZE * MAX_CHUNKS : 0n;

      const results: MintEvent[] = [];
      // Fetch in 100-block chunks (RPC range limit).
      for (let to = end; to > start; to -= CHUNK_SIZE) {
        const from = to > start + CHUNK_SIZE ? to - CHUNK_SIZE + 1n : start;
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
          args: { from: ZERO_ADDRESS },
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          results.push({
            tokenId: log.args.tokenId!,
            to: log.args.to!,
            txHash: log.transactionHash ?? null,
          });
        }
      }
      if (!cancelled) {
        // Newest first (higher block = newer).
        setMints(
          results
            .sort((a, b) => (a.tokenId > b.tokenId ? -1 : 1))
            .slice(0, 12)
        );
      }
    }

    // The public RPC has no WebSocket support and its HTTP event-filter
    // polling logs spurious range errors, so poll manually in chunks.
    const initial = fetchRecentMints().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load mints");
      }
    });
    void initial;

    const interval = setInterval(() => {
      fetchRecentMints().catch(() => {
        // Transient RPC errors are ignored; the next poll will retry.
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent mints</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {mints.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            No mints yet — be the first!
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {mints.map((mint) => (
            <li
              key={`${mint.txHash}-${mint.tokenId}`}
              className="flex items-center justify-between text-sm"
            >
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
