import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

// ⬇️⬇️⬇️  把下面这行引号里的内容,换成你从 cloud.reown.com 拿到的 Project ID  ⬇️⬇️⬇️
const PROJECT_ID = "af0cd1577d7ea2538782961419ae610f";
// ⬆️⬆️⬆️  只改这一处即可  ⬆️⬆️⬆️

// Arc 测试网(USDC 是原生 gas 币)
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: "ArcEscrow",
  projectId: import.meta.env.VITE_WC_PROJECT_ID || PROJECT_ID,
  chains: [arcTestnet],
  ssr: false,
});
