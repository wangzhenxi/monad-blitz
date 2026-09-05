"use client";

import { monadTestnet } from "wagmi/chains";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectWallet() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && address) {
    const wrongChain = chainId !== monadTestnet.id;
    return (
      <div className="flex items-center gap-2">
        {wrongChain && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => switchChain({ chainId: monadTestnet.id })}
          >
            Switch to Monad testnet
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          {shortAddress(address)}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      disabled={isPending}
      onClick={() => connect({ connector: connectors[0] })}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
