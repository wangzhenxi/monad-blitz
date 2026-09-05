import type { Address } from "viem";

/// Lottery.sol 最小交互 ABI（手写，对齐 contracts/src/Lottery.sol）
export const lotteryAbi = [
  // ---- 写操作 ----
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [{ name: "sig", type: "bytes" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitEntropy",
    stateMutability: "nonpayable",
    inputs: [{ name: "e", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fundPrizePool",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "draw",
    stateMutability: "payable",
    inputs: [{ name: "userSeed", type: "bytes32" }],
    outputs: [],
  },
  { type: "function", name: "claimDeposit", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimPrize", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // ---- 视图 ----
  { type: "function", name: "issuer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "depositAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "drawTime", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "entropyTimeout", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "winnerCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "prizePoolAvailable", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "prizePoolReceived", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "prizePerWinner", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalDepositsRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "entropyFeePaid", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "drawRequestedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "participants",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "participantsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "winnersList",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "registered",
    stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "depositClaimed",
    stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isWinner",
    stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "prizeClaimed",
    stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "entropyRoot", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "entropyCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // ---- 事件 ----
  {
    type: "event",
    name: "Registered",
    inputs: [{ name: "participant", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "EntropySubmitted",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "entropy", type: "bytes32", indexed: false },
      { name: "index", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PrizePoolFunded",
    inputs: [
      { name: "sponsor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DrawRequested",
    inputs: [
      { name: "sequenceNumber", type: "uint64", indexed: true },
      { name: "userSeed", type: "bytes32", indexed: false },
      { name: "entropyRoot", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WinnersSelected",
    inputs: [
      { name: "winners", type: "address[]", indexed: false },
      { name: "randomNumber", type: "bytes32", indexed: false },
      { name: "userSeed", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositClaimed",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PrizeClaimed",
    inputs: [
      { name: "winner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/// Pyth Entropy V2 入口（读实时请求费用）
export const entropyAbi = [
  {
    type: "function",
    name: "getFeeV2",
    stateMutability: "view",
    inputs: [
      { name: "provider", type: "address" },
      { name: "gasLimit", type: "uint32" },
    ],
    outputs: [{ type: "uint128" }],
  },
] as const;

export const ENTROPY_ADDRESS =
  (process.env.NEXT_PUBLIC_ENTROPY_ADDRESS as Address | undefined) ??
  "0x825c0390f379C631f3Cf11A82a37D20BddF93c07";
export const ENTROPY_PROVIDER =
  (process.env.NEXT_PUBLIC_ENTROPY_PROVIDER as Address | undefined) ??
  "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";
/// 回调 gasLimit（与合约 CALLBACK_GAS_LIMIT 一致，仅用于费估算展示）
export const CALLBACK_GAS_LIMIT = 250_000;

export const STATUS_LABEL = ["Open 报名中", "Drawing 开奖中", "Drawn 已开奖"] as const;

/// 活动上下文解析：仅认 URL ?addr=（无 addr 的活动页显示选择提示，不再回落 env 地址——
/// 静默回落会让无参数链接显示到错误的活动数据）
export function getLotteryAddress(): Address | undefined {
  if (typeof window !== "undefined") {
    const addr = new URLSearchParams(window.location.search).get("addr");
    if (addr?.startsWith("0x") && addr.length === 42) return addr as Address;
  }
  return undefined;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/// 统一展示精度：固定 3 位小数（wei → MON）
export function formatMON(wei: bigint | undefined | null, digits = 3) {
  if (wei === undefined || wei === null) return "—";
  const v = Number(wei) / 1e18;
  return v.toFixed(digits);
}

export function formatCountdown(seconds: number) {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/// 时间戳展示（秒）：当天只显 HH:mm，跨天补日期 MM-DD HH:mm（仅客户端异步数据使用，无 SSR 水合问题）
export function formatTs(ts: number) {
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/// viem/wagmi 错误信息提取（shortMessage 优先）
export function errMsg(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return err.shortMessage ?? err.message ?? "未知错误";
}

/// LotteryFactory.sol 最小交互 ABI（对齐 contracts/src/LotteryFactory.sol）
export const factoryAbi = [
  {
    type: "function",
    name: "createLottery",
    stateMutability: "nonpayable",
    inputs: [
      { name: "issuer", type: "address" },
      { name: "entropy", type: "address" },
      { name: "provider", type: "address" },
      { name: "drawTime", type: "uint256" },
      { name: "depositAmount", type: "uint256" },
      { name: "entropyTimeout", type: "uint256" },
      { name: "winnerCount", type: "uint256" },
    ],
    outputs: [{ name: "lotteryAddr", type: "address" }],
  },
  {
    type: "function",
    name: "registerExisting",
    stateMutability: "nonpayable",
    inputs: [{ name: "lotteryAddr", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getLotteries",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "creatorOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "LotteryCreated",
    inputs: [
      { name: "lottery", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "created", type: "bool", indexed: false },
    ],
  },
] as const;

/// 工厂合约地址（链上活动注册表）
export const FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_FACTORY_ADDRESS as Address | undefined) ??
  "0x10f4f8b3a02aad5e410b8222e025eca3f0f1f69f";
