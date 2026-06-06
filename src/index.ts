#!/usr/bin/env node
/**
 * Etherscan MCP Server
 *
 * Connect AI assistants to Etherscan's free Ethereum blockchain explorer API.
 * Query ETH balances, ERC-20 token balances, transactions, contract ABIs,
 * and gas prices through the Model Context Protocol.
 *
 * Works with Claude Desktop, Cursor, Windsurf, Cline, and any MCP client.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ETHERSCAN_BASE = "https://api.etherscan.io/api";
const API_KEY = process.env.ETHERSCAN_API_KEY || "YourApiKeyToken";

// Rate limiter: Etherscan free tier = 5 calls/sec
let lastCall = 0;
const MIN_INTERVAL = 250; // ~4 calls/sec, safe for free tier (5/sec)

async function rateLimitedFetch(params: Record<string, string>): Promise<any> {
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastCall);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCall = Date.now();

  const url = new URL(ETHERSCAN_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, v);
  }
  url.searchParams.append("apikey", API_KEY);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise((r) => setTimeout(r, 5000));
    const retry = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!retry.ok) {
      throw new Error(`Etherscan API error: ${retry.status} ${retry.statusText}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    throw new Error(`Etherscan API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Etherscan returns wei (10^18) for ETH values. Convert to ETH.
function weiToEth(weiStr: string | number, decimals: number = 18): string {
  const wei = BigInt(weiStr || "0");
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = wei / divisor;
  const remainder = wei % divisor;
  if (remainder === BigInt(0)) {
    return whole.toString();
  }
  const remainderStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return remainderStr ? `${whole}.${remainderStr}` : whole.toString();
}

function gweiToGwei(gweiStr: string): string {
  if (!gweiStr) return "N/A";
  const n = parseFloat(gweiStr);
  if (Number.isNaN(n)) return gweiStr;
  return n.toFixed(2);
}

// Create server
const server = new McpServer({
  name: "etherscan",
  version: "1.0.0",
});

// ── Tool: get_eth_balance ──
server.tool(
  "get_eth_balance",
  "Get the native ETH balance for an Ethereum address (in ETH, not wei)",
  {
    address: z.string().describe("Ethereum address (0x...) to check balance for"),
  },
  async ({ address }) => {
    try {
      const data = await rateLimitedFetch({
        module: "account",
        action: "balance",
        address,
        tag: "latest",
      });
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const balanceEth = weiToEth(data.result);
      return {
        content: [{
          type: "text" as const,
          text: `**ETH Balance for \`${address}\`**\n\n**${balanceEth} ETH**`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_token_balances ──
server.tool(
  "get_token_balances",
  "Get ERC-20 token balances for an Ethereum address (token name, symbol, contract, amount). Requires an Etherscan API key for best results.",
  {
    address: z.string().describe("Ethereum address (0x...) to check token balances for"),
    page: z.string().optional().default("1").describe("Page number for pagination (default 1)"),
    offset: z.string().optional().default("100").describe("Number of results per page (default 100, max ~10000 with API key)"),
  },
  async ({ address, page, offset }) => {
    try {
      const data = await rateLimitedFetch({
        module: "account",
        action: "addresstokenbalance",
        address,
        page,
        offset,
      });
      if (data.status === "0") {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${data.message} — ${data.result}\n\nNote: \`addresstokenbalance\` typically requires an Etherscan API key. Set the \`ETHERSCAN_API_KEY\` env var to use it. As a fallback, use \`get_erc20_transfers\` to inspect recent ERC-20 activity for the address.`,
          }],
        };
      }
      const tokens = data.result || [];
      if (tokens.length === 0) {
        return { content: [{ type: "text" as const, text: `No ERC-20 token balances found for \`${address}\`.` }] };
      }
      const lines = tokens.map((t: any) => {
        const decimals = parseInt(t.TokenDecimal || "18", 10);
        const amount = weiToEth(t.TokenQuantity || "0", decimals);
        return `- **${t.TokenName || "Unknown"} (${t.TokenSymbol || "?"})** — Balance: ${amount} — Contract: \`${t.TokenAddress}\``;
      });
      return {
        content: [{
          type: "text" as const,
          text: `**ERC-20 Token Balances for \`${address}\`** (${tokens.length} tokens)\n\n${lines.join("\n")}`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_transaction ──
server.tool(
  "get_transaction",
  "Get full details for a single transaction by its hash (from, to, value, gas, input data, status)",
  {
    txhash: z.string().describe("Transaction hash (0x...) to look up"),
  },
  async ({ txhash }) => {
    try {
      const data = await rateLimitedFetch({
        module: "proxy",
        action: "eth_getTransactionByHash",
        txhash,
      });
      const tx = data.result;
      if (!tx) {
        return { content: [{ type: "text" as const, text: `No transaction found for hash \`${txhash}\`.` }] };
      }
      const valueEth = weiToEth(tx.value || "0");
      const gasGwei = tx.gasPrice ? weiToEth(tx.gasPrice, 9) : "N/A";
      const lines = [
        `**Transaction \`${tx.hash}\`**`,
        "",
        `- **Block:** ${tx.blockNumber || "pending"}`,
        `- **From:** \`${tx.from}\``,
        `- **To:** \`${tx.to || "(contract creation)"}\``,
        `- **Value:** ${valueEth} ETH`,
        `- **Gas Limit:** ${parseInt(tx.gas || "0").toLocaleString()}`,
        `- **Gas Price:** ${gasGwei} Gwei`,
        `- **Nonce:** ${tx.nonce}`,
        `- **Transaction Index:** ${tx.transactionIndex || "N/A"}`,
      ];
      if (tx.input && tx.input !== "0x") {
        const inputPreview = tx.input.length > 66 ? `${tx.input.slice(0, 66)}…(${tx.input.length / 2 - 1} bytes)` : tx.input;
        lines.push(`- **Input Data:** \`${inputPreview}\``);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_transactions_by_address ──
server.tool(
  "get_transactions_by_address",
  "Get the normal (external) transactions for an Ethereum address, newest first. Includes value, gas, from/to, method.",
  {
    address: z.string().describe("Ethereum address (0x...) to fetch transactions for"),
    startblock: z.string().optional().default("0").describe("Starting block number (default 0)"),
    endblock: z.string().optional().default("99999999").describe("Ending block number (default latest)"),
    page: z.string().optional().default("1").describe("Page number (default 1)"),
    offset: z.string().optional().default("20").describe("Number of results per page (default 20, max 10000)"),
    sort: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort order (default desc — newest first)"),
  },
  async ({ address, startblock, endblock, page, offset, sort }) => {
    try {
      const data = await rateLimitedFetch({
        module: "account",
        action: "txlist",
        address,
        startblock,
        endblock,
        page,
        offset,
        sort,
      });
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const txs = data.result || [];
      if (txs.length === 0) {
        return { content: [{ type: "text" as const, text: `No transactions found for \`${address}\` in block range ${startblock}–${endblock}.` }] };
      }
      const lines = txs.map((tx: any) => {
        const valueEth = weiToEth(tx.value || "0");
        const gasGwei = weiToEth(tx.gasPrice || "0", 9);
        const direction = tx.from.toLowerCase() === address.toLowerCase() ? "↗ OUT" : "↙ IN";
        const statusIcon = tx.txreceipt_status === "1" ? "✅" : tx.txreceipt_status === "0" ? "❌" : "⏳";
        const method = tx.functionName ? ` · ${tx.functionName.split("(")[0]}` : "";
        const date = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString().split("T")[0] : "?";
        return `- ${statusIcon} ${direction} **${valueEth} ETH**${method} — block ${parseInt(tx.blockNumber).toLocaleString()} — ${date} — gas: ${gasGwei} Gwei — hash: \`${tx.hash.slice(0, 18)}…\``;
      });
      return {
        content: [{
          type: "text" as const,
          text: `**Normal Transactions for \`${address}\`** (${txs.length} results, page ${page})\n\n${lines.join("\n")}`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_erc20_transfers ──
server.tool(
  "get_erc20_transfers",
  "Get ERC-20 token transfer events for an Ethereum address (token transfers in/out)",
  {
    address: z.string().describe("Ethereum address (0x...) to fetch ERC-20 transfers for"),
    contractaddress: z.string().optional().describe("Optional: filter by a specific ERC-20 token contract address"),
    startblock: z.string().optional().default("0").describe("Starting block number (default 0)"),
    endblock: z.string().optional().default("99999999").describe("Ending block number (default latest)"),
    page: z.string().optional().default("1").describe("Page number (default 1)"),
    offset: z.string().optional().default("20").describe("Number of results per page (default 20, max 10000)"),
    sort: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort order (default desc — newest first)"),
  },
  async ({ address, contractaddress, startblock, endblock, page, offset, sort }) => {
    try {
      const params: Record<string, string> = {
        module: "account",
        action: "tokentx",
        address,
        startblock,
        endblock,
        page,
        offset,
        sort,
      };
      if (contractaddress) params.contractaddress = contractaddress;
      const data = await rateLimitedFetch(params);
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const txs = data.result || [];
      if (txs.length === 0) {
        return { content: [{ type: "text" as const, text: `No ERC-20 transfers found for \`${address}\` in block range ${startblock}–${endblock}.` }] };
      }
      const lines = txs.map((tx: any) => {
        const decimals = parseInt(tx.tokenDecimal || "18", 10);
        const amount = weiToEth(tx.value || "0", decimals);
        const direction = tx.from.toLowerCase() === address.toLowerCase() ? "↗ OUT" : "↙ IN";
        const date = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString().split("T")[0] : "?";
        return `- ${direction} **${amount} ${tx.tokenSymbol || "?"}** (\`${tx.tokenName || "Unknown"}\`) — block ${parseInt(tx.blockNumber).toLocaleString()} — ${date} — hash: \`${tx.hash.slice(0, 18)}…\``;
      });
      const filterNote = contractaddress ? ` (filtered to contract \`${contractaddress}\`)` : "";
      return {
        content: [{
          type: "text" as const,
          text: `**ERC-20 Transfers for \`${address}\`**${filterNote} (${txs.length} results, page ${page})\n\n${lines.join("\n")}`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_internal_transactions ──
server.tool(
  "get_internal_transactions",
  "Get internal transactions (contract calls) for an Ethereum address. These are transactions triggered by smart contracts, not direct EOA transfers.",
  {
    address: z.string().describe("Ethereum address (0x...) to fetch internal transactions for"),
    startblock: z.string().optional().default("0").describe("Starting block number (default 0)"),
    endblock: z.string().optional().default("99999999").describe("Ending block number (default latest)"),
    page: z.string().optional().default("1").describe("Page number (default 1)"),
    offset: z.string().optional().default("20").describe("Number of results per page (default 20, max 10000)"),
    sort: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort order (default desc — newest first)"),
  },
  async ({ address, startblock, endblock, page, offset, sort }) => {
    try {
      const data = await rateLimitedFetch({
        module: "account",
        action: "txlistinternal",
        address,
        startblock,
        endblock,
        page,
        offset,
        sort,
      });
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const txs = data.result || [];
      if (txs.length === 0) {
        return { content: [{ type: "text" as const, text: `No internal transactions found for \`${address}\` in block range ${startblock}–${endblock}.` }] };
      }
      const lines = txs.map((tx: any) => {
        const valueEth = weiToEth(tx.value || "0");
        const direction = tx.from.toLowerCase() === address.toLowerCase() ? "↗ OUT" : "↙ IN";
        const type = tx.type || "call";
        const date = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString().split("T")[0] : "?";
        return `- ${direction} **${valueEth} ETH** (${type}) — block ${parseInt(tx.blockNumber).toLocaleString()} — ${date} — hash: \`${tx.hash.slice(0, 18)}…\``;
      });
      return {
        content: [{
          type: "text" as const,
          text: `**Internal Transactions for \`${address}\`** (${txs.length} results, page ${page})\n\n${lines.join("\n")}`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_contract_abi ──
server.tool(
  "get_contract_abi",
  "Get the ABI (Application Binary Interface) for a verified smart contract. The ABI is a JSON array describing the contract's functions and events — required for calling contract methods.",
  {
    address: z.string().describe("Verified contract address (0x...) to fetch the ABI for"),
  },
  async ({ address }) => {
    try {
      const data = await rateLimitedFetch({
        module: "contract",
        action: "getabi",
        address,
      });
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const abiStr = data.result;
      if (!abiStr || abiStr === "Contract source code not verified") {
        return { content: [{ type: "text" as const, text: `Contract at \`${address}\` is not verified on Etherscan — ABI unavailable.` }] };
      }
      let abi: any[];
      try {
        abi = JSON.parse(abiStr);
      } catch {
        return { content: [{ type: "text" as const, text: `ABI received but failed to parse for \`${address}\`:\n\n\`\`\`\n${abiStr}\n\`\`\`` }] };
      }
      // Summarize: list functions, events, and constructors
      const functions = abi.filter((x: any) => x.type === "function");
      const events = abi.filter((x: any) => x.type === "event");
      const constructors = abi.filter((x: any) => x.type === "constructor");
      const fallbacks = abi.filter((x: any) => x.type === "fallback" || x.type === "receive");
      const summaryLines: string[] = [
        `**Contract ABI for \`${address}\`**`,
        "",
        `- **Functions:** ${functions.length}`,
        `- **Events:** ${events.length}`,
        `- **Constructors:** ${constructors.length}`,
        `- **Fallback/Receive:** ${fallbacks.length}`,
      ];
      if (functions.length > 0) {
        const fnList = functions.slice(0, 25).map((f: any) => {
          const inputs = (f.inputs || []).map((i: any) => `${i.type} ${i.name || ""}`.trim()).join(", ");
          const outputs = (f.outputs || []).map((o: any) => o.type).join(", ");
          return `  - \`${f.name || "?"}(${inputs})\` → ${outputs || "void"} (${(f.stateMutability || "nonpayable")})`;
        });
        summaryLines.push("", `### Functions${functions.length > 25 ? " (showing first 25)" : ""}`, ...fnList);
      }
      if (events.length > 0) {
        const evList = events.slice(0, 15).map((e: any) => {
          const inputs = (e.inputs || []).map((i: any) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name || ""}`.trim()).join(", ");
          return `  - \`event ${e.name || "?"}(${inputs})\``;
        });
        summaryLines.push("", `### Events${events.length > 15 ? " (showing first 15)" : ""}`, ...evList);
      }
      summaryLines.push("", `### Raw ABI (truncated to 2000 chars)`, `\`\`\`json`, abiStr.slice(0, 2000) + (abiStr.length > 2000 ? "…(truncated)" : ""), `\`\`\``);
      return { content: [{ type: "text" as const, text: summaryLines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_gas_price ──
server.tool(
  "get_gas_price",
  "Get the current gas price oracle from Etherscan — recommended gas prices for slow/standard/fast transaction speeds (in Gwei)",
  {},
  async () => {
    try {
      const data = await rateLimitedFetch({
        module: "gastracker",
        action: "gasoracle",
      });
      if (data.status === "0") {
        return { content: [{ type: "text" as const, text: `Error: ${data.message} — ${data.result}` }] };
      }
      const r = data.result || {};
      const lines = [
        "**⛽ Etherscan Gas Price Oracle**",
        "",
        `- **Safe Low (🐢):** ${gweiToGwei(r.SafeGasPrice)} Gwei`,
        `- **Standard (🚗):** ${gweiToGwei(r.ProposeGasPrice)} Gwei`,
        `- **Fast (🚀):** ${gweiToGwei(r.FastGasPrice)} Gwei`,
        "",
        `- **Last Block:** ${r.LastBlock || "N/A"}`,
        `- **Gas Used Ratio:** ${r.gasUsedRatio || "N/A"}`,
        `- **Suggested Base Fee:** ${r.suggestBaseFee ? gweiToGwei(r.suggestBaseFee) + " Gwei" : "N/A"}`,
      ];
      if (r.FastGasPrice) {
        const fast = parseFloat(r.FastGasPrice);
        const safe = parseFloat(r.SafeGasPrice);
        if (!Number.isNaN(fast) && !Number.isNaN(safe) && safe > 0) {
          const usdFast = (fast * 21000 / 1e9).toFixed(6);
          const usdSafe = (safe * 21000 / 1e9).toFixed(6);
          lines.push("", `*Estimated tx cost for 21,000 gas: 🐢 ${usdSafe} ETH | 🚀 ${usdFast} ETH*`);
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
