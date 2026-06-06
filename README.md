# Etherscan MCP Server

> An MCP server for [Etherscan](https://etherscan.io) — connect any MCP-compatible client to the Ethereum blockchain explorer.

[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## What is this?

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives AI assistants and agents access to Etherscan's Ethereum blockchain explorer API — ETH balances, ERC-20 token balances, transaction history, contract ABIs, and gas prices — through natural language.

Use it with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, **Continue**, or any MCP-compatible client to inspect wallets, audit contracts, and analyze on-chain activity.

## Why use this?

- **No API key required** — works out of the box with Etherscan's free tier (limited to ~1 call/5s without a key)
- **Optional API key support** — set `ETHERSCAN_API_KEY` for 5 calls/sec and full results
- **8 built-in tools** — covers the most common on-chain queries
- **Clean markdown output** — results read naturally in chat
- **Rate-limited automatically** — respects free tier limits, retries on 429

## Tools

| Tool | Description |
|------|-------------|
| `get_eth_balance` | Get native ETH balance for an address |
| `get_token_balances` | Get all ERC-20 token balances for an address |
| `get_transaction` | Get full details for a transaction by hash |
| `get_transactions_by_address` | Get normal (external) transactions for an address |
| `get_erc20_transfers` | Get ERC-20 token transfer events for an address |
| `get_internal_transactions` | Get internal (contract-called) transactions for an address |
| `get_contract_abi` | Get the ABI for a verified smart contract |
| `get_gas_price` | Get current gas price oracle (slow/standard/fast in Gwei) |

## Quick Start

### 1. Install

```bash
npm install -g etherscan-mcp-server
```

Or run directly with npx:

```bash
npx -y etherscan-mcp-server
```

### 2. Configure your MCP client

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "etherscan": {
      "command": "npx",
      "args": ["-y", "etherscan-mcp-server"]
    }
  }
}
```

Or with global install:

```json
{
  "mcpServers": {
    "etherscan": {
      "command": "etherscan-mcp-server"
    }
  }
}
```

### 3. Use it

Ask your AI assistant things like:

- "What's the ETH balance of vitalik.eth's address `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`?"
- "Show me the ERC-20 token balances for that address"
- "Get details for transaction `0x...`"
- "List the last 20 normal transactions for this address"
- "Show me all USDT transfers to this wallet"
- "Fetch the ABI for the USDC contract `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`"
- "What are current gas prices on Ethereum mainnet?"

## Example Output

### `get_eth_balance`

```
ETH Balance for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

247.3821 ETH
```

### `get_gas_price`

```
⛽ Etherscan Gas Price Oracle

- Safe Low (🐢): 12.50 Gwei
- Standard (🚗): 15.20 Gwei
- Fast (🚀): 18.90 Gwei

- Last Block: 19850000
- Gas Used Ratio: 0.512
- Suggested Base Fee: 13.40 Gwei

*Estimated tx cost for 21,000 gas: 🐢 0.000263 ETH | 🚀 0.000397 ETH*
```

### `get_transactions_by_address`

```
Normal Transactions for 0xd8dA...6045 (20 results, page 1)

- ✅ ↗ OUT 0.5 ETH · transfer — block 19,850,123 — 2026-06-05 — gas: 15.20 Gwei — hash: 0x4f8a2b9c3d1e5f7a...
- ✅ ↙ IN 1.2 ETH · transfer — block 19,849,876 — 2026-06-05 — gas: 14.80 Gwei — hash: 0x9c1d4e7f2a8b6c3d...
- ❌ ↗ OUT 0.0 ETH · swapExactTokensForETH — block 19,849,500 — 2026-06-05 — gas: 22.10 Gwei — hash: 0x2b7c9e1f4a3d8b5c...
```

### `get_contract_abi`

```
Contract ABI for 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48

- Functions: 28
- Events: 13
- Constructors: 1
- Fallback/Receive: 0

### Functions (showing first 25)
  - `name()` → string (view)
  - `symbol()` → string (view)
  - `decimals()` → uint8 (view)
  - `totalSupply()` → uint256 (view)
  - `balanceOf(address)` → uint256 (view)
  - `transfer(address,uint256)` → bool (nonpayable)
  - `approve(address,uint256)` → bool (nonpayable)
  - `transferFrom(address,address,uint256)` → bool (nonpayable)
  ...
```

## Requirements

- Node.js 18+
- Etherscan API key (recommended) — get a free one at [etherscan.io/apis](https://etherscan.io/apis)

## Rate Limits

The server automatically rate-limits requests to ~4 calls/second to stay within Etherscan's free tier (5 calls/sec). Without an API key, Etherscan limits you to 1 call/5 seconds.

To use a higher limit, sign up for a free Etherscan API key and set the `ETHERSCAN_API_KEY` environment variable:

```json
{
  "mcpServers": {
    "etherscan": {
      "command": "etherscan-mcp-server",
      "env": {
        "ETHERSCAN_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Development

```bash
git clone https://github.com/nova/etherscan-mcp-server.git
cd etherscan-mcp-server
npm install
npm run build
npm start
```

## License

MIT
