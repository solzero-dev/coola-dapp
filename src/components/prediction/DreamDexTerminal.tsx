import { useEffect, useMemo, useRef, useState } from "react";
import type { BinarySide } from "@somnia-chain/markets-sdk";
import type {
  Candle,
  DreamDexPublicConfig,
} from "../../../packages/prediction-core/market-data";
import {
  DreamDexBrowser,
  type DreamDexBrowserWallet,
  orderTerms,
} from "../../../packages/adapters/dreamdex/browser";
import { eventBinding } from "../../../packages/adapters/dreamdex/config";
import { apiUrl as apiEndpoint } from '../../../packages/sdk/api-url';
import { dreamDexNetwork } from "../../../packages/adapters/dreamdex/event-reader";
import { ConfirmedPriceChart } from "./ConfirmedPriceChart";
import { formatUnitsExact, parseUnitsExact, priceLabel } from "./amounts";
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession';
import { dynamicEvmProvider } from './dynamicEvmProvider';
type Snapshot = Awaited<ReturnType<DreamDexBrowser["snapshot"]>>;
export function DreamDexTerminal({
  deployments,
  eventId,
  subjectId,
  chainId,
  initialOutcome = 0,
  evmWallet,
  creationApiUrl,
}: {
  deployments: DreamDexPublicConfig[];
  eventId?: string;
  subjectId?: string;
  chainId?: '5031' | '50312';
  initialOutcome?: 0 | 1;
  evmWallet: DynamicEvmWalletPort | null;
  creationApiUrl?: string;
}) {
  const [chain, setChain] = useState(deployments[0]?.chainId ?? "50312"),
    [id, setId] = useState("");
  const config = chainId ? deployments.find(c => c.chainId === chainId) : deployments.find((c) => c.chainId === chain) ?? deployments[0];
  const [created, setCreated] = useState<DreamDexPublicConfig['markets']>([]);
  const [pastGames, setPastGames] = useState(false);
  const allMarkets = [...(config?.markets ?? []), ...(config?.chainId === '50312' ? created.filter(m => !config.markets.some(c => c.marketId === m.marketId)) : [])];
  const pastMarkets = allMarkets.filter(m => m.eventId !== eventId && m.tradingLocksAt <= Date.now() && (!subjectId || m.subjectId === subjectId));
  const markets =
      pastGames ? pastMarkets : allMarkets.filter((m) => (!eventId || m.eventId === eventId) && (!subjectId || m.subjectId === subjectId)),
    market = markets.find((m) => m.marketId === id) ?? markets[0];
  return (
    <>
      {eventId && (pastMarkets.length > 0 || pastGames) && <button type="button" aria-pressed={pastGames} onClick={() => { setPastGames(value => !value); setId(''); }}>
        {pastGames ? 'Return to current game' : 'Past game positions & settlement'}
      </button>}
      <div className="pt-toolbar">
        {config && !chainId && (
          <label>
            Somnia deployment
            <select
              value={config.chainId}
              onChange={(e) => {
                setChain(e.target.value as typeof chain);
                setId("");
              }}
            >
              {deployments.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {market && (
          <label>
            Event contract
            <select
              value={market.marketId}
              onChange={(e) => setId(e.target.value)}
            >
              {markets.map((m) => (
                <option key={m.marketId} value={m.marketId}>
                  {m.label}{pastGames ? ` · ${new Date(m.tradingLocksAt).toLocaleString()}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!config ? (
        <div className="pt-empty">
          <h3>{chainId === '50312' ? 'Testnet · tUSDC' : 'Mainnet · USDso'} configuration missing</h3>
          <p>
            Configure Somnia Event Contracts to load this network’s markets.
          </p>
        </div>
      ) : !market ? (
        <div className="pt-empty">
          <h3>No DreamDEX event linked{eventId ? " to this match" : ""}</h3>
          <p>
            Create the game’s oracle question and register its confirmed
            event-contract ID.
          </p>
          {!pastGames && config.chainId === '50312' && config.demoCreation && creationApiUrl && eventId && subjectId?.startsWith('genesis-') && <OpenGameQuestion key={`${eventId}:${subjectId}`} apiUrl={creationApiUrl} eventId={eventId} agentId={subjectId} onCreated={m => setCreated(previous => [...previous.filter(p => p.marketId !== m.marketId), m])}/>}
        </div>
      ) : (
        <DreamEvent
          key={`${config.chainId}:${market.marketId}`}
          config={config}
          market={market}
          initialOutcome={initialOutcome}
          evmWallet={evmWallet}
          creationApiUrl={creationApiUrl}
        />
      )}
    </>
  );
}
function OpenGameQuestion({ apiUrl, eventId, agentId, onCreated }: { apiUrl: string; eventId: string; agentId: string; onCreated: (m: DreamDexPublicConfig['markets'][number]) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('Opening this game question on Shannon…');
    try {
      const response = await fetch(apiEndpoint(apiUrl, '/dreamdex/game-markets'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, agentId }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? 'Creation did not complete.');
      if (result.market?.eventId !== eventId || result.market?.subjectId !== agentId) throw Error('The confirmed question does not match this selection.');
      if (alive.current) { onCreated(result.market); setMessage(`Event created: ${result.hash}`); }
    } catch (e) { if (alive.current) setMessage(e instanceof Error ? e.message : 'Creation did not complete. Refresh before retrying.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <><p>The demo operator pays to open this agent’s YES/NO game question. Then connect your Dynamic wallet to trade with test tokens in a separate transaction.</p><button className="pt-primary" disabled={busy} onClick={() => void create()}>{busy ? 'Opening game question…' : 'Open this game question · sponsored'}</button>{message && <p role="status">{message}</p>}</>;
}
function DreamEvent({
  config,
  market,
  initialOutcome,
  evmWallet,
  creationApiUrl,
}: {
  config: DreamDexPublicConfig;
  market: DreamDexPublicConfig["markets"][number];
  initialOutcome: 0 | 1;
  evmWallet: DynamicEvmWalletPort | null;
  creationApiUrl?: string;
}) {
  const adapter = useMemo(
    () => new DreamDexBrowser(config, eventBinding(config, market)),
    [config, market],
  );
  useEffect(
    () => () => {
      void adapter.close();
    },
    [adapter],
  );
  const [wallet, setWallet] = useState<DreamDexBrowserWallet | null>(null),
    walletRef = useRef<DreamDexBrowserWallet | null>(null);
  walletRef.current = wallet;
  useEffect(() => () => wallet?.dispose(), [wallet]);
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [outcome, setOutcome] = useState<0 | 1>(initialOutcome),
    [side, setSide] = useState<"BUY" | "SELL">("BUY"),
    [kind, setKind] = useState<0 | 2 | 3>(2),
    [price, setPrice] = useState("50"),
    [quantity, setQuantity] = useState("10"),
    [amount, setAmount] = useState("10");
  const [candles, setCandles] = useState<Candle[]>([]),
    [historyError, setHistoryError] = useState("");
  useEffect(() => { setOutcome(initialOutcome); setReview(null); }, [initialOutcome]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [review, setReview] = useState<{
    side: BinarySide;
    outcomePrice: bigint;
    quantity: bigint;
    orderType: 0 | 2 | 3;
  } | null>(null);
  const alive = useRef(true),
    pending = useRef(false);
  const connectionGeneration = useRef(0);
  useEffect(() => {
    alive.current = true;
    connectionGeneration.current++;
    walletRef.current?.dispose();
    setWallet(null);
    setReview(null);
    return () => {
      alive.current = false;
      connectionGeneration.current++;
      walletRef.current?.dispose();
    };
  }, [evmWallet]);
  useEffect(() => {
    let current = true,
      loading = false;
    setData(null);
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await adapter.snapshot(wallet?.owner);
        if (current) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (current) {
          setError(e instanceof Error ? e.message : "Event data unavailable");
          setReview(null);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [adapter, wallet, refresh]);
  useEffect(() => {
    let current = true,
      loading = false;
    setCandles([]);
    setHistoryLoading(true);
    setHistoryError("");
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await adapter.candles(outcome);
        if (current) {
          setCandles(next);
          setHistoryError("");
        }
      } catch (e) {
        if (current)
          setHistoryError(
            e instanceof Error ? e.message : "Event chart unavailable",
          );
      } finally {
        loading = false;
        if (current) setHistoryLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [adapter, outcome, refresh]);
  useEffect(() => setReview(null), [outcome, side, kind, price, quantity]);
  const run = async (fn: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await fn();
      if (alive.current) {
        setMessage(result);
        setReview(null);
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      if (alive.current)
        setMessage(e instanceof Error ? e.message : "Operation did not finish");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const connect = () =>
    void run(async () => {
      if (!evmWallet) throw new Error('Use the Dynamic wallet control above to connect an EVM wallet.');
      const generation = connectionGeneration.current;
      const provider = await dynamicEvmProvider(evmWallet, config.chainId);
      const next = await adapter.connect(provider);
      if (!alive.current || generation !== connectionGeneration.current) {
        next.dispose();
        return "";
      }
      setWallet(next);
      return `Connected ${next.owner}`;
    });
  const network = dreamDexNetwork(config.chainId),
    decimals = network.collateralDecimals,
    scale = 10n ** BigInt(decimals),
    symbol = network.collateralSymbol;
  const format = (n: bigint) => formatUnitsExact(n, decimals, 6),
    priceText = (n: bigint) => priceLabel((n * 1000000n) / scale);
  const closed =
    !data ||
    data.market.status !== 1 ||
    data.now < market.tradingStartsAt ||
    data.now >= market.tradingLocksAt;
  const unavailable = !wallet || !data || !!error || busy;
  const bids = outcome === 0 ? data?.book?.yesBids : data?.book?.noBids,
    asks = outcome === 0 ? data?.book?.yesAsks : data?.book?.noAsks;
  const fee = (n: bigint) => `${Number(n) / 100000}%`;
  return (
    <fieldset
      className="pt-session"
      disabled={busy}
      aria-label="DreamDEX event trading"
    >
      <div className="pt-toolbar">
        <span>
          {network.chain.name} · {symbol} · Event Contracts
        </span>
        <button onClick={connect} disabled={busy}>
          {wallet
            ? `${wallet.owner.slice(0, 6)}…${wallet.owner.slice(-4)}`
            : "Connect Somnia wallet"}
        </button>
      </div>
      <p className="pt-market-status">
        {error
          ? "Event data unavailable"
          : !data
            ? "Loading event…"
            : data.market.isVoided
              ? "Voided"
              : data.market.isResolved
                ? `Resolved · ${data.market.winningOutcome === 0 ? 'YES' : 'NO'} wins`
                : closed
                  ? "Closed to trading"
                  : "Trading open"}{" "}
        · Cutoff {new Date(market.tradingLocksAt).toLocaleString()}
      </p>
      {error && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
      <div className="pt-outcomes" aria-label="Event outcome">
        {(["YES", "NO"] as const).map((label, i) => (
          <button
            key={label}
            aria-pressed={outcome === i}
            onClick={() => setOutcome(i as 0 | 1)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pt-grid">
        <section className="pt-market">
          {historyLoading ? (
            <p className="pt-empty pt-chart-empty" role="status">
              Loading event trades…
            </p>
          ) : historyError ? (
            <p className="pt-empty" role="alert">
              Event chart unavailable: {historyError}
            </p>
          ) : (
            <ConfirmedPriceChart
              candles={candles}
              label={`${outcome === 0 ? "YES" : "NO"} · Somnia`}
              sourceLabel="indexed trades"
            />
          )}
          <p className="pt-muted">
            Latest 100 indexed fills for this event only.
          </p>
          <h2>Order book</h2>
          <div className="pt-book-scroll">
            <table className="pt-book">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Shares</th>
                </tr>
              </thead>
              <tbody>
                {asks
                  ?.slice()
                  .reverse()
                  .map((level) => (
                    <tr className="pt-ask" key={`a${level.price}`}>
                      <td>Ask</td>
                      <td>{priceText(level.price)}</td>
                      <td>{format(level.quantity)}</td>
                    </tr>
                  ))}
                {bids?.map((level) => (
                  <tr className="pt-bid" key={`b${level.price}`}>
                    <td>Bid</td>
                    <td>{priceText(level.price)}</td>
                    <td>{format(level.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && !bids?.length && !asks?.length && (
            <p className="pt-empty">No available orders for this event.</p>
          )}
          <h3>{closed ? 'Your orders to recover' : 'Your open orders'}</h3>
          {!wallet ? (
            <p>Connect a wallet to see orders.</p>
          ) : data?.orders.length ? (
            data.orders.map(
              (o) =>
                o && (
                  <div className="pt-order" key={o.orderId.toString()}>
                    <span>
                      #{o.orderId.toString()} · {format(o.quantityRemaining)}{" "}
                      shares · YES price {priceText(o.price)}
                    </span>
                    <button
                      disabled={unavailable}
                      onClick={() =>
                        void run(
                          async () =>
                            `Cancellation confirmed: ${await wallet.cancel(o.orderId)}`,
                        )
                      }
                    >
                      {closed ? 'Recover escrow' : 'Cancel'}
                    </button>
                  </div>
                ),
            )
          ) : (
            <p>No open orders.</p>
          )}
        </section>
        <aside className="pt-ticket">
          <h2>Trade {outcome === 0 ? "YES" : "NO"}</h2>
          <div className="pt-side">
            {(["BUY", "SELL"] as const).map((s) => (
              <button
                key={s}
                aria-pressed={side === s}
                onClick={() => setSide(s)}
              >
                {s === "BUY" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (unavailable || closed || !data?.pool)
                  throw new Error("Connect a wallet and refresh an open event");
                const outcomePrice = parseUnitsExact(price, decimals - 2),
                  q = parseUnitsExact(quantity, decimals),
                  s = `${side}_${outcome === 0 ? "YES" : "NO"}` as BinarySide;
                orderTerms(s, outcomePrice, q, decimals, data.pool.grid);
                if (
                  side === "BUY" &&
                  (q * outcomePrice + scale - 1n) / scale >
                    (data.balances?.[0] ?? 0n)
                )
                  throw new Error(`Not enough ${symbol} collateral`);
                if (side === "SELL" && q > (data.balances?.[outcome + 1] ?? 0n))
                  throw new Error("Not enough wallet outcome tokens");
                setReview({
                  side: s,
                  outcomePrice,
                  quantity: q,
                  orderType: kind,
                });
                setMessage("");
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "Invalid order");
              }
            }}
          >
            <label>
              Order type
              <select
                value={kind}
                onChange={(e) => setKind(Number(e.target.value) as 0 | 2 | 3)}
              >
                <option value="2">Immediate · cancel unfilled</option>
                <option value="0">Limit</option>
                <option value="3">Post only</option>
              </select>
            </label>
            <label>
              Shares
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              {side === "BUY" ? "Maximum" : "Minimum"} outcome price · cents
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            {(side === 'BUY' ? asks?.[0] : bids?.[0]) && <button type="button" onClick={() => {
              const best = side === 'BUY' ? asks![0]! : bids![0]!;
              setPrice(formatUnitsExact(best.price * 100n, decimals, 4));
            }}>Use best {side === 'BUY' ? 'ask' : 'bid'}</button>}
            {data?.pool && (
              <p>
                Maker fee {fee(data.pool.params.makerFeeBpsTimes1k)} · taker fee{" "}
                {fee(data.pool.params.takerFeeBpsTimes1k)} · settlement fee{" "}
                {fee(data.pool.params.settlementFeeBpsTimes1k)}.
              </p>
            )}
            <p>No additional frontend builder fee is configured.</p>
            <button className={`pt-primary ${side === 'SELL' ? 'pt-sell' : ''}`} disabled={unavailable || closed}>
              Review order
            </button>
          </form>
          {review && (
            <div className="pt-review">
              <h3>Review {review.side.replace("_", " ").toLowerCase()}</h3>
              <p>
                {format(review.quantity)} shares at{" "}
                {priceText(review.outcomePrice)}.{" "}
                {review.orderType === 2
                  ? "Unfilled shares cancel immediately."
                  : "Order expires at the event cutoff."}
              </p>
              <p>
                Your wallet may request collateral or outcome-token approval
                before placing the order.
              </p>
              <button
                className={`pt-primary ${review.side.startsWith('SELL') ? 'pt-sell' : ''}`}
                disabled={unavailable || closed}
                onClick={() =>
                  void run(
                    async () =>
                      `Trade confirmed: ${await wallet!.order(review)}`,
                  )
                }
              >
                Sign & submit
              </button>
              <button onClick={() => setReview(null)}>Dismiss</button>
            </div>
          )}
          {message && (
            <p className="pt-feedback" role="status">
              {message}
            </p>
          )}
          <h3>Wallet balances</h3>
          {config.chainId === '50312' && config.demoCreation && creationApiUrl && <button disabled={!wallet || busy} onClick={() => void run(async () => {
            const response = await fetch(apiEndpoint(creationApiUrl, '/dreamdex/faucet'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: wallet!.owner }) });
            const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Test funding unavailable.'); return result.message;
          })}>Get demo test tokens & gas</button>}
          <dl className="pt-totals">
            {[symbol, "YES", "NO"].map((label, i) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{data?.balances ? format(data.balances[i]!) : "—"}</dd>
              </div>
            ))}
          </dl>
          <details className="pt-collateral">
            <summary>Complete sets & settlement</summary>
            <p>
              One {symbol} backs one YES and one NO. Create sets to fund
              sell-side inventory; merging returns collateral. Redeem uses the
              permanent event ID, including after its pool is reused.
            </p>
            <label>
              Amount
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <div>
              {(["mint", "merge", "redeem"] as const).map((action) => (
                <button
                  key={action}
                  disabled={
                    unavailable ||
                    (action === "mint" && closed) ||
                    (action === "redeem" &&
                      !data?.market.isResolved &&
                      !data?.market.isVoided)
                  }
                  onClick={() =>
                    void run(
                      async () =>
                        `${action} confirmed: ${await wallet!.sets(action, parseUnitsExact(amount, decimals), outcome)}`,
                    )
                  }
                >
                  {action === "mint"
                    ? "Create sets"
                    : action === "merge"
                      ? "Merge sets"
                      : `Redeem ${outcome === 0 ? "YES" : "NO"}`}
                </button>
              ))}
            </div>
            <p>
              Void policy:{" "}
              {market.voidPolicy === 0
                ? "uniform payout"
                : "closing-book snapshot payout"}
              . Protocol settlement fees may reduce payouts.
            </p>
          </details>
          <p className="pt-muted">
            Game outcomes are resolved by the configured oracle. Automated
            trading agents are a separate integration.
          </p>
        </aside>
      </div>
    </fieldset>
  );
}
