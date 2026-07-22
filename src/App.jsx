import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  JsonRpcSigner,
  formatEther,
  isAddress,
  parseEther,
} from "ethers";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useConnectorClient } from "wagmi";
import {
  ARC_TESTNET,
  CONFIRM_WINDOW,
  ESCROW_ABI,
  ESCROW_ADDRESS,
  EXPLORER,
  STATUS,
} from "./contract.js";

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmtAmount = (wei) => {
  const n = Number(formatEther(wei));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
const fmtDate = (sec) =>
  new Date(Number(sec) * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 公共 RPC 会限流(429)。撞上就退避重试,别把错误直接甩给用户。
async function withRetry(fn, tries = 4) {
  let wait = 600;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message ?? e);
      const rateLimited = msg.includes("429") || /rate.?limit|too many/i.test(msg);
      if (!rateLimited || i === tries - 1) throw e;
      await sleep(wait);
      wait *= 2;
    }
  }
}

function countdown(secondsLeft) {
  if (secondsLeft <= 0) return "Deadline passed";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function defaultDeadline() {
  const d = new Date(Date.now() + 7 * 86400 * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// 只读 provider:直连 Arc 官方 RPC。读链不需要钱包,也和"连的是哪个钱包"解耦。
const readProvider = new JsonRpcProvider(
  ARC_TESTNET.rpcUrls[0],
  { chainId: ARC_TESTNET.chainIdDec, name: ARC_TESTNET.chainName },
  { staticNetwork: true }
);

// 把 wagmi 的连接客户端转成 ethers 的 signer,这样合约写操作继续用 ethers。
function useEthersSigner() {
  const { data: client } = useConnectorClient();
  return useMemo(() => {
    if (!client) return null;
    const { account, chain, transport } = client;
    const network = { chainId: chain.id, name: chain.name };
    const provider = new BrowserProvider(transport, network);
    return new JsonRpcSigner(provider, account.address);
  }, [client]);
}

export default function App() {
  const { address, isConnected, chain } = useAccount();
  const signer = useEthersSigner();

  const account = address ?? null;
  const chainOk = isConnected && chain?.id === ARC_TESTNET.chainIdDec;

  const [balance, setBalance] = useState(null);
  const [escrows, setEscrows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [memo, setMemo] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // 读账本:从 nextId-1 往前遍历,只留跟当前账户有关的
  const loadEscrows = useCallback(async (addr) => {
    if (!addr) return;
    setLoading(true);
    try {
      const c = new Contract(ESCROW_ADDRESS, ESCROW_ABI, readProvider);
      const total = Number(await withRetry(() => c.nextId()));
      const me = addr.toLowerCase();
      const rows = [];
      for (let i = total - 1; i >= 0; i--) {
        const e = await withRetry(() => c.escrows(i));
        if (e.payer.toLowerCase() === me || e.payee.toLowerCase() === me) {
          rows.push({
            id: i,
            payer: e.payer,
            payee: e.payee,
            amount: e.amount,
            deadline: Number(e.deadline),
            deliveredAt: Number(e.deliveredAt),
            memo: e.memo,
            status: Number(e.status),
          });
          setEscrows([...rows]); // 边读边显示
        }
      }
      setEscrows(rows);
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBalance = useCallback(async (addr) => {
    try {
      setBalance(await withRetry(() => readProvider.getBalance(addr)));
    } catch {
      /* 余额读不到不影响主流程 */
    }
  }, []);

  const refreshAll = useCallback(
    async (addr) => {
      await refreshBalance(addr);
      await loadEscrows(addr);
    },
    [refreshBalance, loadEscrows]
  );

  // 账户 / 网络状态由 wagmi 驱动。连上且网络正确就加载,否则清空。
  useEffect(() => {
    setErr("");
    setOk(null);
    if (account && chainOk) {
      refreshAll(account);
    } else {
      setEscrows([]);
      setBalance(null);
    }
  }, [account, chainOk, refreshAll]);

  const formError = useMemo(() => {
    if (!payee && !amount) return null;
    if (payee && !isAddress(payee)) return "Payee must be a valid 0x address.";
    if (payee && account && payee.toLowerCase() === account.toLowerCase())
      return "Payee must be different from your own address.";
    if (amount && !(Number(amount) > 0)) return "Amount must be greater than 0.";
    return null;
  }, [payee, amount, account]);

  const canSubmit =
    account && chainOk && signer && !busy && payee && amount && deadline && !formError;

  async function withTx(label, fn) {
    setErr("");
    setOk(null);
    setBusy(true);
    try {
      const tx = await fn();
      const receipt = await tx.wait();
      setOk({ text: label, hash: receipt.hash });
      await refreshAll(account);
    } catch (e) {
      setErr(readableError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCreate(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const ts = Math.floor(new Date(deadline).getTime() / 1000);
    if (!ts || ts <= Math.floor(Date.now() / 1000)) {
      setErr("Deadline must be in the future.");
      return;
    }
    await withTx("Escrow created — USDC is now locked.", async () => {
      const c = new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      return c.createEscrow(payee, ts, memo, { value: parseEther(amount) });
    });
    setPayee("");
    setAmount("");
    setMemo("");
    setDeadline(defaultDeadline());
  }

  const onRelease = (id) =>
    withTx("Released — USDC sent to the payee.", async () =>
      new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer).release(id)
    );

  const onMarkDelivered = (id) =>
    withTx("Marked as delivered — the confirmation window has started.", async () =>
      new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer).markDelivered(id)
    );

  const onClaim = (id) =>
    withTx("Claimed — USDC released to you.", async () =>
      new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer).claim(id)
    );

  const onRefund = (id) =>
    withTx("Refunded — USDC returned to you.", async () =>
      new Contract(ESCROW_ADDRESS, ESCROW_ABI, signer).refund(id)
    );

  const locked = escrows
    .filter((e) => e.status === 0)
    .reduce((sum, e) => sum + e.amount, 0n);

  // 余额太少就把领水指引顶到显眼处;够用时收成一行小字
  const lowBalance = balance !== null && balance < parseEther("0.5");

  // 一键把 Arc 测试网加进钱包(钱包里没有这条网络时有用)
  const addArcNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_TESTNET.chainIdHex,
            chainName: ARC_TESTNET.chainName,
            nativeCurrency: ARC_TESTNET.nativeCurrency,
            rpcUrls: ARC_TESTNET.rpcUrls,
            blockExplorerUrls: ARC_TESTNET.blockExplorerUrls,
          },
        ],
      });
    } catch (e) {
      setErr(readableError(e));
    }
  }, []);

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">ArcEscrow</span>
          <span className="brand-sub">Conditional settlement · Arc</span>
        </div>
        <div className="topbar-right">
          {account && chainOk && (
            <button
              className="btn btn-ghost"
              style={{ width: "auto" }}
              onClick={() => refreshAll(account)}
              disabled={loading || busy}
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
          )}
          <ConnectButton
            showBalance={{ smallScreen: false, largeScreen: true }}
            chainStatus="icon"
            accountStatus="address"
          />
        </div>
      </header>

      <section className="masthead">
        <div>
          <h1>
            Money that <em>waits</em> for the work.
          </h1>
          <p>
            Lock USDC into a contract on Arc. It pays out the moment you confirm delivery —
            or comes back to you when the deadline passes. No intermediary ever holds it.
          </p>
        </div>
        <div className="attest">
          <div className="attest-row">
            <span className="attest-k">Contract</span>
            <a
              href={`${EXPLORER}/address/${ESCROW_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(ESCROW_ADDRESS)}
            </a>
          </div>
          <div className="attest-row">
            <span className="attest-k">Network</span>
            <span>Arc Testnet · {ARC_TESTNET.chainIdDec}</span>
          </div>
          <div className="attest-row">
            <span className="attest-k">Gas &amp; settlement</span>
            <span>USDC (native)</span>
          </div>
          <div className="attest-row">
            <span className="attest-k">Your locked value</span>
            <span>{fmtAmount(locked)} USDC</span>
          </div>
        </div>
      </section>

      <Faucet
        connected={!!account && chainOk}
        lowBalance={lowBalance}
        onAddNetwork={addArcNetwork}
      />

      {err && (
        <div className="note note-err" role="alert">
          {err}
        </div>
      )}
      {ok && (
        <div className="note note-ok">
          {ok.text}{" "}
          <a href={`${EXPLORER}/tx/${ok.hash}`} target="_blank" rel="noreferrer">
            View on ArcScan →
          </a>
        </div>
      )}

      <div className="cols">
        <form className="panel" onSubmit={onCreate}>
          <h2>New escrow</h2>

          <div className="field">
            <label htmlFor="payee">Pay to</label>
            <input
              id="payee"
              placeholder="0x…"
              value={payee}
              onChange={(e) => setPayee(e.target.value.trim())}
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="amount">Amount</label>
            <input
              id="amount"
              type="number"
              step="0.000001"
              min="0"
              placeholder="25.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="field-hint">USDC — locked in the contract until settled.</div>
          </div>

          <div className="field">
            <label htmlFor="deadline">Refundable after</label>
            <input
              id="deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <div className="field-hint">Past this point you can take the funds back.</div>
          </div>

          <div className="field">
            <label htmlFor="memo">Reference</label>
            <input
              id="memo"
              placeholder="Invoice #204 — Q3 design"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={80}
            />
            <div className="field-hint">Written onchain, for reconciliation.</div>
          </div>

          {formError && <div className="note note-err">{formError}</div>}

          <button className="btn" type="submit" disabled={!canSubmit}>
            {busy ? "Confirming…" : "Lock USDC"}
          </button>

          {!account && (
            <div className="field-hint" style={{ marginTop: 10, textAlign: "center" }}>
              Connect a wallet to create an escrow.
            </div>
          )}
          {account && !chainOk && (
            <div className="field-hint" style={{ marginTop: 10, textAlign: "center" }}>
              Switch to Arc Testnet to continue.
            </div>
          )}
        </form>

        <section className="ledger">
          <div className="ledger-head">
            <h2>Ledger</h2>
            <span className="count">
              {loading
                ? "Reading chain…"
                : `${escrows.length} record${escrows.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {!account ? (
            <div className="empty">
              <h3>Nothing to show yet</h3>
              <p>Connect your wallet to see escrows you've sent or received.</p>
            </div>
          ) : escrows.length === 0 && !loading ? (
            <div className="empty">
              <h3>Your ledger is empty</h3>
              <p>Lock your first payment and it will appear here as a slip.</p>
            </div>
          ) : (
            <div className="slips">
              {escrows.map((e) => (
                <Slip
                  key={e.id}
                  e={e}
                  now={now}
                  account={account}
                  busy={busy}
                  onRelease={onRelease}
                  onMarkDelivered={onMarkDelivered}
                  onClaim={onClaim}
                  onRefund={onRefund}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="foot">
        <span>ArcEscrow — built on Arc, settled in USDC</span>
        <a href={`${EXPLORER}/address/${ESCROW_ADDRESS}`} target="_blank" rel="noreferrer">
          {ESCROW_ADDRESS}
        </a>
      </footer>
    </div>
  );
}

function Faucet({ connected, lowBalance, onAddNetwork }) {
  // 没连钱包、或余额偏低时展开;否则收成一行不占地方
  const [open, setOpen] = useState(false);
  const expanded = open || lowBalance || !connected;

  if (!expanded) {
    return (
      <div className="faucet-slim">
        <button className="faucet-link" onClick={() => setOpen(true)}>
          Need testnet USDC?
        </button>
      </div>
    );
  }

  return (
    <section className="faucet">
      <div className="faucet-head">
        <div>
          <h2>Need testnet USDC?</h2>
          <p>
            {lowBalance && connected
              ? "Your balance is running low. Top up from Circle's faucet — it's free."
              : "Arc runs on testnet USDC. Grab some free — it takes about a minute."}
          </p>
        </div>
        {!lowBalance && connected && (
          <button className="faucet-close" onClick={() => setOpen(false)} title="Hide">
            ×
          </button>
        )}
      </div>

      <ol className="faucet-steps">
        <li>
          <span className="faucet-num">1</span>
          <div>
            <strong>Add Arc Testnet to your wallet</strong>
            <p>Chain 5042002 · USDC is the native gas token.</p>
            <button className="btn btn-ghost faucet-btn" onClick={onAddNetwork}>
              Add network
            </button>
          </div>
        </li>
        <li>
          <span className="faucet-num">2</span>
          <div>
            <strong>Claim free USDC</strong>
            <p>Circle's official faucet. Pick Arc Testnet, paste your address.</p>
            <a
              className="btn faucet-btn"
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
            >
              Open Circle faucet →
            </a>
          </div>
        </li>
        <li>
          <span className="faucet-num">3</span>
          <div>
            <strong>Come back and lock a payment</strong>
            <p>The faucet tops you up every couple of hours if you need more.</p>
          </div>
        </li>
      </ol>
    </section>
  );
}

function Slip({ e, now, account, busy, onRelease, onMarkDelivered, onClaim, onRefund }) {
  const st = STATUS[e.status];
  const isPayer = e.payer.toLowerCase() === account.toLowerCase();
  const isPayee = e.payee.toLowerCase() === account.toLowerCase();

  const deadlinePassed = now >= e.deadline;
  const claimAt = e.deliveredAt ? e.deliveredAt + CONFIRM_WINDOW : 0;
  const claimOpen = e.status === 1 && claimAt > 0 && now >= claimAt;

  // 计时条:Locked 显示到 deadline 的时间;Delivered 显示确认期倒计时
  let timer = null;
  if (e.status === 0) {
    const secondsLeft = e.deadline - now;
    const windowSec = 30 * 86400;
    const pct = Math.max(0, Math.min(100, ((windowSec - secondsLeft) / windowSec) * 100));
    timer = {
      label: deadlinePassed ? "Refund window" : "Refundable after",
      value: deadlinePassed ? "Open — payer may refund" : countdown(secondsLeft),
      pct,
      due: deadlinePassed,
    };
  } else if (e.status === 1) {
    const secondsLeft = claimAt - now;
    const pct = Math.max(
      0,
      Math.min(100, ((CONFIRM_WINDOW - secondsLeft) / CONFIRM_WINDOW) * 100)
    );
    timer = {
      label: claimOpen ? "Confirmation window" : "Payee can claim in",
      value: claimOpen ? "Passed — payee may claim" : countdown(secondsLeft),
      pct,
      due: claimOpen,
    };
  }

  return (
    <article className={`slip is-${st.key}`}>
      <div className="slip-top">
        <div>
          <div className="slip-id">Escrow #{String(e.id).padStart(4, "0")}</div>
          <div className={`slip-memo${e.memo ? "" : " is-empty"}`}>
            {e.memo || "No reference"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="slip-amt">
            {fmtAmount(e.amount)}
            <span>USDC</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <span className={`stamp stamp-${st.key}`}>{st.label}</span>
          </div>
        </div>
      </div>

      <div className="slip-grid">
        <div>
          <div className="cell-k">Payer</div>
          <div className="cell-v">
            {short(e.payer)}
            {isPayer && <span className="role">You</span>}
          </div>
        </div>
        <div>
          <div className="cell-k">Payee</div>
          <div className="cell-v">
            {short(e.payee)}
            {isPayee && <span className="role">You</span>}
          </div>
        </div>
        <div>
          <div className="cell-k">Refundable after</div>
          <div className="cell-v">{fmtDate(e.deadline)}</div>
        </div>
      </div>

      {timer && (
        <div className="timer">
          <div className="timer-top">
            <span className="timer-label">{timer.label}</span>
            <span className={`timer-val${timer.due ? " is-due" : ""}`}>{timer.value}</span>
          </div>
          <div className="track">
            <div
              className={`track-fill${timer.due ? " is-due" : ""}`}
              style={{ width: `${timer.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* 付款方视角:Locked / Delivered 都能放款;到期且未被锁定时可退款 */}
      {isPayer && (e.status === 0 || e.status === 1) && (
        <div className="slip-actions">
          <button className="btn" disabled={busy} onClick={() => onRelease(e.id)}>
            Release to payee
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !deadlinePassed || claimOpen}
            onClick={() => onRefund(e.id)}
            title={
              claimOpen
                ? "Payee has met the delivery window and can claim — refund is locked"
                : deadlinePassed
                ? ""
                : "Available once the deadline passes"
            }
          >
            Refund
          </button>
        </div>
      )}

      {/* 收款方视角:Locked 可标记交付;确认期过后可领款 */}
      {isPayee && e.status === 0 && (
        <div className="slip-actions">
          <button className="btn" disabled={busy} onClick={() => onMarkDelivered(e.id)}>
            Mark delivered
          </button>
        </div>
      )}
      {isPayee && e.status === 1 && (
        <div className="slip-actions">
          <button
            className="btn"
            disabled={busy || !claimOpen}
            onClick={() => onClaim(e.id)}
            title={claimOpen ? "" : "Available once the 3-day window passes"}
          >
            Claim funds
          </button>
        </div>
      )}
    </article>
  );
}

function readableError(e) {
  if (e?.code === 4001 || e?.code === "ACTION_REJECTED")
    return "You rejected the request in your wallet.";
  const msg = String(e?.message ?? "");
  if (msg.includes("429") || /rate.?limit|too many/i.test(msg))
    return "The public Arc RPC is rate limiting us. Wait a few seconds and hit Refresh.";
  const reason = e?.reason || e?.info?.error?.message || e?.shortMessage || e?.message;
  if (!reason) return "Something went wrong. Try again.";
  return reason.length > 160 ? `${reason.slice(0, 160)}…` : reason;
}
