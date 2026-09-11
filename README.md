# SOLZ Prediction Market

Prediction-market frontend and execution services for SOLZ matches. The repository contains the React/Astro web app, its server routes, a standalone Bun prediction API, DreamDEX event-market integration, and custom EVM event contracts.

## Repository map

- `src/` — Astro host, React UI, and same-origin server endpoints.
- `apps/api/` — standalone prediction REST/WebSocket API with SQLite persistence.
- `apps/chain-worker/` — chain submission and reconciliation worker.
- `apps/dreamdex/` — DreamDEX game-event creation, faucet, inspection, and smoke tooling.
- `contracts/evm/` — custom event execution contracts, ABIs, deployment data, and an isolated local-chain launcher.
- `packages/` — chain adapters, SDK, matching, telemetry, risk, and shared domain logic.

DreamDEX and the custom EVM contracts are separate execution paths:

- **DreamDEX** uses deployed DreamDEX Event Contracts on Somnia Shannon testnet (chain ID `50312`). Creating a market or using the faucet submits testnet transactions and requires a funded sponsor key.
- **Custom EVM execution** deploys this repository's contracts to a fresh local Ganache chain. It uses test funds only and needs no wallet key.

## Prerequisites

- [Bun](https://bun.sh/) 1.2 or newer.
- Node.js 22.12 or newer (used by Solidity scripts).
- A Dynamic-supported browser wallet for wallet interactions.
- Optional: PostgreSQL for the built-in serverless DreamDEX route.

Install dependencies:

```sh
bun install
bun install --cwd contracts/evm
```

## Quick start: homepage and profile

Start the web app and its built-in server routes:

```sh
bun run dev
```

Open:

- [http://127.0.0.1:4321/](http://127.0.0.1:4321/) — SOLZ matches and DreamDEX markets.
- [http://127.0.0.1:4321/profile](http://127.0.0.1:4321/profile) — connected-wallet DreamDEX orders and positions.

`bun run dev` starts Astro and the endpoint bindings in `src/pages/api/`. It does **not** automatically start the stateful prediction API on port `8788`; use an integrated mode below when you need execution.

## Environment

```sh
cp .env.example .env
```

| Variable | Purpose | Required |
| --- | --- | --- |
| `VITE_DYNAMIC_ENVIRONMENT_ID` | Dynamic wallet connection | Wallet flows only |
| `PUBLIC_ARENA_MARKET_SOURCES` | Home sources such as `SIMULATION,SOMNIA` | No |
| `DATABASE_URL` | PostgreSQL for the built-in `/api/dreamdex` route | Built-in DreamDEX writes |
| `PVT_KEY` | DreamDEX sponsor wallet | DreamDEX writes |
| `SOLZ_GAME_API_ORIGIN` | Authoritative SOLZ match/roster service | No; a hosted default exists |
| `DREAMDEX_OPERATOR_ID` | DreamDEX operator ID | No; defaults to `22` |
| `DREAMDEX_VENUE_ID` | DreamDEX venue ID | No; defaults to the Shannon demo venue |
| `PREDICTION_API_ORIGIN` | Upstream for Astro's `/api/prediction` proxy | No in development; defaults to port `8788` |
| `PUBLIC_DREAMDEX_GAME_API_URL` | Browser-facing standalone DreamDEX service | Standalone DreamDEX mode only |

Never expose `PVT_KEY` through a `PUBLIC_` or `VITE_` variable. Replace the placeholder Dynamic ID in `.env.example` with a real environment ID to test wallet login.

## Complete local event-contract execution

This mode exercises the custom EVM contracts, matcher, API, and chain worker together. It creates a loopback Ganache chain, deploys the contracts, creates a three-outcome market, funds test accounts, seeds the order book, starts the API, and runs settlement/reconciliation.

Terminal 1:

```sh
bun run dev:prediction-local
```

Defaults:

- JSON-RPC: `http://127.0.0.1:8545`
- Prediction API: `http://127.0.0.1:8788`
- Chain ID: `31337`
- Generated data/configuration: `.data/prediction-local-*`

Terminal 2:

```sh
PREDICTION_VENUES_JSON="$(cat .data/prediction-local-XXXXXX/venues.json)" \
PREDICTION_AUTH_AUDIENCE=http://127.0.0.1:8788 \
bun run dev
```

Replace `prediction-local-XXXXXX` with the generated directory printed by Terminal 1. `PREDICTION_VENUES_JSON` lets Astro's built-in `/api/prediction/config` route expose the safe browser configuration, while the remaining `/api/prediction/*` requests are proxied to the local API.

Open [http://127.0.0.1:4321/](http://127.0.0.1:4321/) to browse the configured markets, then use [http://127.0.0.1:4321/profile](http://127.0.0.1:4321/profile) for wallet positions. Keep both processes running. `Ctrl+C` stops the launcher; its chain is ephemeral and all balances are test funds.

To use different ports:

```sh
PREDICTION_LOCAL_RPC_PORT=9545 PREDICTION_LOCAL_API_PORT=9788 bun run dev:prediction-local
PREDICTION_API_ORIGIN=http://127.0.0.1:9788 \
PREDICTION_AUTH_AUDIENCE=http://127.0.0.1:9788 \
PREDICTION_VENUES_JSON="$(cat .data/prediction-local-XXXXXX/venues.json)" \
bun run dev
```

## DreamDEX Event Contracts

DreamDEX runs against Somnia Shannon testnet, not Ganache. The sponsor must have Shannon test SOMI and test collateral. The standalone service also checks that the sponsor owns the halted demo recorded in `apps/dreamdex/demo-deployment.json`.

Create the ignored environment file used by the script:

```sh
printf 'PVT_KEY=0xYOUR_PRIVATE_KEY\n' > contracts/evm/.env
```

Do not commit it or use a mainnet-funded key.

Terminal 1:

```sh
bun run dev:dreamdex-game
```

The service listens at `http://127.0.0.1:8789`, persists state in `.data/dreamdex-games.sqlite`, reads the current roster from `SOLZ_GAME_API_ORIGIN`, and exposes:

- `GET /config`
- `POST /dreamdex/game-markets`
- `POST /dreamdex/faucet`

Terminal 2:

```sh
PUBLIC_DREAMDEX_GAME_API_URL=http://127.0.0.1:8789 bun run dev
```

Open [http://127.0.0.1:4321/](http://127.0.0.1:4321/), connect a Somnia-compatible EVM wallet, select the current match and an agent, then create or trade its question. Creation and faucet calls are durable, idempotent testnet operations—not simulations.

Optional service settings:

```sh
DREAMDEX_GAME_PORT=8789
DREAMDEX_GAME_DATABASE=.data/dreamdex-games.sqlite
DREAMDEX_GAME_ORIGINS=http://127.0.0.1:4321,http://localhost:4321
SOLZ_GAME_API_ORIGIN=https://your-game-service.example
```

Inspect a confirmed DreamDEX binding without creating or resolving it:

```sh
bun run inspect:dreamdex path/to/config.json
```

`apps/dreamdex/frontend.example.json` shows the network configuration shape. Inspection additionally needs a confirmed `binding` with the match ID, DreamDEX market ID, oracle question ID, trading timestamps, and void policy.

## Standalone prediction API

For backend development without the all-in-one Ganache launcher:

```sh
bun run dev:prediction-api
```

It listens on `127.0.0.1:8788` and stores state in `.data/prediction.sqlite`. With no venue configuration it provides health/discovery but rejects live chain orders.

Server-only configuration:

- `PREDICTION_VENUES_FILE` — JSON array file for custom EVM venues.
- `PREDICTION_DREAMDEX_FILE` — JSON array file for public DreamDEX networks.
- `PREDICTION_DATABASE_PATH` — SQLite path.
- `PREDICTION_HOST` and `PREDICTION_PORT` — bind address and port.
- `PREDICTION_AUTH_AUDIENCE` — wallet-request authentication audience.
- `PREDICTION_ALLOWED_ORIGINS` — comma-separated browser origins.
- `PREDICTION_TELEMETRY_SECRET` and `PREDICTION_CONTROL_TOKEN` — optional authenticated service inputs.

Run worker responsibilities separately when needed:

```sh
bun run dev:prediction-worker
bun run dev:prediction-telemetry
bun run dev:hermes
```

REST reads require explicit `venue` and `chainId` parameters. Routes include `/config`, `/markets`, `/markets/:id/orderbook`, `/markets/:id/trades`, `/users/:account/orders`, `/users/:account/balance`, and `/matches/:id/telemetry`. WebSocket feeds are at `/markets/:id` and `/matches/:id`; use `after` to resume the durable sequence.

## Build and test contracts

Compile Solidity and refresh the checked-in ABIs:

```sh
bun run --cwd contracts/evm build
```

Run EVM integration tests:

```sh
bun run test:evm
```

Local-chain tests are not a security audit or public deployment.

## Project validation

```sh
bun run check
bun run test
bun run test:prediction
bun run test:evm
```

Additional targeted scripts are listed in `package.json`.

## Runtime boundaries

- The authoritative SOLZ service owns roster, combat, match timing, and winner state. Prediction services consume it; they do not mutate gameplay.
- Server secrets never enter React props.
- DreamDEX records remain separate from the custom EVM matcher and contracts.
- The local EVM launcher uses generated accounts and never reads user keys.
- Production still requires configured RPCs, funded operators/relayers, deployment verification, monitoring, and a security review.

See `ARCHITECTURE.md` for detailed application and service boundaries.

## Hackathon links and evidence

- **Homepage:** [solz.fun](https://solz.fun/)
- **Demo video:** Pending upload

**Somnia Shannon testnet — deployed**

- **DreamDEX event market:** [12 market-creation transactions](https://shannon-explorer.somnia.network/tx/0x023f93f46d5afac33d91bf05cdb86e941d777c4ad48b12adb15cd0e23b01035f) · first market `0x0000000000000000000000000000000000000000000000000000000000019d06`
- **DreamDEX binary pool:** First binary pool `0x0000000000000000000000000000000000000000000000000000000000019d06` (`YES` / `NO`); [next UI market creation](https://shannon-explorer.somnia.network/tx/0x09bbf84a87da5a2c6b2d81ebbcaa99372155e3be38b8bbe670f81c69175dc692)
- **SOLZ result registry:** [DreamDEX OracleHub/module](https://shannon-explorer.somnia.network/address/0x3ecC694Cef705358864a646142ac17A90E29e388) · result source [SOLZ match log](https://solz-elysia-production.up.railway.app/api/v1/agent-arena/matches/29cc967b-3fb6-4caa-8abb-f0d8f8085bea/logs)
- **Market collateral:** [tUSDC](https://shannon-explorer.somnia.network/address/0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E) · 6 decimals · Somnia chain ID `50312`

**Transaction evidence — Somnia Shannon testnet**

- **Market creation:** [first creation receipt](https://shannon-explorer.somnia.network/tx/0x023f93f46d5afac33d91bf05cdb86e941d777c4ad48b12adb15cd0e23b01035f) · 12 total markets
- **Executed trade:** [buy YES](https://shannon-explorer.somnia.network/tx/0xfa0965d910639562200f5a7229405abb39ae2748367a604d0e591515c30346b8) · [sell YES](https://shannon-explorer.somnia.network/tx/0x8b8d2daa2d842e61690f7e23120c19b1ff8507aa768ad54fb0188590d0936189)
- **Match resolution:** [oracle settlement](https://shannon-explorer.somnia.network/tx/0xf77af04c9225330ff85e8ecc4aa22f9c1f5a13063496285b9ef5de83581a6240) · `SCHWEPPES` won; all 12 markets resolved on-chain
- **Winner redemption:** [redemption](https://shannon-explorer.somnia.network/tx/0x50447915b1ed78a7667f580efc15b49d02a895b33d9866b866a3bfb8167ada59) · `1.000000 tUSDC` received
