import { http, createConfig } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

export const MONAD_TESTNET = monadTestnet;

export const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "ee21bfa0b7e219ce48913fe5d2edd05c";

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    injected(),
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true, // 现场观众手机扫码接入
    }),
  ],
  transports: {
    [monadTestnet.id]: http("https://testnet-rpc.monad.xyz"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
