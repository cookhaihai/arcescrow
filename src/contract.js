// ArcEscrow V2(带乙方保障)部署在 Arc Testnet 上的地址
export const ESCROW_ADDRESS = "0xcAE9504a48f5807B558757AeEb21C5D9B7fc8f86";

// Arc Testnet 网络参数(USDC 是原生 gas 币)
export const ARC_TESTNET = {
  chainIdDec: 5042002,
  chainIdHex: "0x4cef52",
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

export const EXPLORER = ARC_TESTNET.blockExplorerUrls[0];

// 前端用得到的 ABI 部分
export const ESCROW_ABI = [
  "function nextId() view returns (uint256)",
  "function CONFIRM_WINDOW() view returns (uint256)",
  "function escrows(uint256) view returns (address payer, address payee, uint256 amount, uint256 deadline, uint256 deliveredAt, string memo, uint8 status)",
  "function createEscrow(address payee, uint256 deadline, string memo) payable returns (uint256)",
  "function markDelivered(uint256 id)",
  "function release(uint256 id)",
  "function claim(uint256 id)",
  "function refund(uint256 id)",
  "function claimableAt(uint256 id) view returns (uint256)",
  "event EscrowCreated(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint256 deadline, string memo)",
  "event Delivered(uint256 indexed id, uint256 deliveredAt)",
  "event Released(uint256 indexed id, address indexed payee, uint256 amount, string mode)",
  "event Refunded(uint256 indexed id, address indexed payer, uint256 amount)",
];

// 4 个状态(与合约 enum 对应)
export const STATUS = {
  0: { key: "locked", label: "Locked" },
  1: { key: "delivered", label: "Delivered" },
  2: { key: "released", label: "Released" },
  3: { key: "refunded", label: "Refunded" },
};

// 确认期(秒),前端兜底用,实际以合约 CONFIRM_WINDOW 为准
export const CONFIRM_WINDOW = 3 * 24 * 60 * 60;
