# AGW Scanner

Scan EVM wallet addresses to discover their associated [Abstract Global Wallets](https://abs.xyz) (AGWs) and check for ETH & token balances on Abstract Chain.

## Features

- Batch scan multiple EOA addresses at once
- Derives AGW addresses from the on-chain factory contract
- Checks deployment status of each AGW
- Fetches ETH, USDC, USDT, and WETH balances for deployed wallets
- Filter results by funded or deployed status
- Export results as JSON
- Concurrent scanning (4 wallets in parallel)

## Setup

```bash
npm install
```

Copy the example env file and configure your RPC endpoint:

```bash
cp .env.example .env
```

```env
VITE_ABSTRACT_RPC=https://api.mainnet.abs.xyz
```

## Usage

```bash
# Development server with hot reload
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## How It Works

1. Paste one or more EOA addresses (one per line)
2. The scanner derives each wallet's AGW address by hashing the EOA and calling `getAddressForSalt` on the AGW factory contract (`0xe86Bf72715dF28a0b7c3C8F596E7fE05a22A139c`)
3. Checks if the AGW contract is deployed on-chain
4. For deployed AGWs, fetches ETH and known token balances
5. Results are displayed with status badges and can be exported as JSON
