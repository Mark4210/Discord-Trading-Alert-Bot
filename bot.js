import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fetch from "node-fetch";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

// ─── Load .env (ESM-safe) ─────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

// ─── Yahoo Finance v3 ─────────────────────────────────────────────────────────
const { default: yahooFinance } = await import("yahoo-finance2");

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_URL   = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DROP_THRESHOLD        = parseFloat(process.env.DROP_THRESHOLD || "-5.0");
const POLL_INTERVAL_MS      = parseInt(process.env.POLL_INTERVAL_SECONDS || "60") * 1000;
const ALERT_COOLDOWN_MS     = 60 * 60 * 1000; // 1 hour between repeat alerts
const BOT_START_TIME        = Date.now();

// ─── Instruments ──────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  { label: "S&P 500",    symbol: "^GSPC" },
  { label: "Nasdaq 100", symbol: "^IXIC" },
  { label: "Dow Jones",  symbol: "^DJI"  },
];

const lastAlerted = {};

// ─── Validate env ─────────────────────────────────────────────────────────────
if (!DISCORD_WEBHOOK_URL) {
  console.error("❌ DISCORD_WEBHOOK_URL is not set in .env — exiting.");
  process.exit(1);
}
if (!DISCORD_BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is not set in .env — exiting.");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCurrency(value) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function formatPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function tvChartUrl(symbol) {
  const map = {
    "^GSPC": "SP:SPX",
    "^IXIC": "NASDAQ:COMP",
    "^DJI":  "DJ:DJI",
  };
  const tv = map[symbol] || symbol;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
}

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

function isMarketHours() {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const etDay = now.getUTCDay();
  if (etDay === 0 || etDay === 6) return false;
  const totalMinutes = etHour * 60 + etMinute;
  return totalMinutes >= 570 && totalMinutes <= 960;
}

// ─── Fetch prices for all instruments ─────────────────────────────────────────
async function fetchAllPrices() {
  const results = [];
  for (const { label, symbol } of INSTRUMENTS) {
    try {
      const quote = await yahooFinance.quote(symbol);
      results.push({
        label,
        symbol,
        currentPrice:  quote.regularMarketPrice,
        openPrice:     quote.regularMarketOpen,
        changePercent: quote.regularMarketChangePercent,
        ok: true,
      });
    } catch (err) {
      results.push({ label, symbol, ok: false, error: err.message });
    }
  }
  return results;
}

// ─── Discord Alert (drop alert via webhook) ───────────────────────────────────
async function sendDiscordAlert({ label, symbol, currentPrice, openPrice, changePercent }) {
  const chartUrl = tvChartUrl(symbol);
  const now = new Date();
  const dropAbs = Math.abs(changePercent).toFixed(2);

  const payload = {
    embeds: [
      {
        title: `🚨 FLASH DROP ALERT — ${label}`,
        description: `**${label}** has dropped **${dropAbs}%** from today's open.\nReview your positions and manage risk accordingly.`,
        color: 0xff2d2d,
        fields: [
          { name: "📛 Instrument",    value: `\`${label}\``,                                   inline: true  },
          { name: "📉 Change Today",  value: `\`${formatPercent(changePercent)}\``,             inline: true  },
          { name: "💵 Current Price", value: `\`${formatCurrency(currentPrice)}\``,             inline: true  },
          { name: "🔓 Today's Open",  value: `\`${formatCurrency(openPrice)}\``,                inline: true  },
          { name: "📊 Drop (USD)",    value: `\`${formatCurrency(openPrice - currentPrice)}\``, inline: true  },
          { name: "🕐 Time (UTC)",    value: `\`${now.toUTCString()}\``,                        inline: false },
          { name: "📈 Chart",         value: `[View on TradingView ↗](${chartUrl})`,            inline: false },
        ],
        footer: { text: "Yahoo Finance → Discord Alert Bot" },
        timestamp: now.toISOString(),
      },
    ],
  };

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Discord webhook error: ${await res.text()}`);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function poll() {
  if (!isMarketHours()) {
    console.log(`💤 Market closed — skipping poll (${new Date().toUTCString()})`);
    return;
  }

  console.log(`\n🔄 Polling ${INSTRUMENTS.length} instruments... (${new Date().toUTCString()})`);

  const prices = await fetchAllPrices();

  for (const data of prices) {
    if (!data.ok) {
      console.error(`❌ [${data.label}] ${data.error}`);
      continue;
    }

    const { label, symbol, currentPrice, openPrice, changePercent } = data;
    console.log(`[${label}] ${formatCurrency(currentPrice)} | ${formatPercent(changePercent)}`);

    if (changePercent <= DROP_THRESHOLD) {
      const now = Date.now();
      const lastAlert = lastAlerted[symbol] || 0;

      if (now - lastAlert < ALERT_COOLDOWN_MS) {
        const minutesLeft = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlert)) / 60000);
        console.log(`   ⏳ Cooldown active — ${minutesLeft} min remaining`);
        continue;
      }

      console.log(`   🚨 DROP ALERT! ${formatPercent(changePercent)}`);
      await sendDiscordAlert({ label, symbol, currentPrice, openPrice, changePercent });
      lastAlerted[symbol] = now;
      console.log(`   ✅ Discord alert sent`);
    }
  }
}

// ─── Discord Bot (commands) ───────────────────────────────────────────────────
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discordClient.once("ready", () => {
  console.log(`🤖 Discord bot logged in as ${discordClient.user.tag}`);
});

discordClient.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();

  // ── !status ────────────────────────────────────────────────────────────────
  if (content === "!status") {
    const uptime = formatUptime(Date.now() - BOT_START_TIME);
    const market = isMarketHours() ? "🟢 Open" : "🔴 Closed";

    const embed = new EmbedBuilder()
      .setTitle("🤖 Bot Status")
      .setColor(0x00cc66)
      .addFields(
        { name: "✅ Status",     value: "Online and running",                          inline: true  },
        { name: "⏱️ Uptime",     value: uptime,                                        inline: true  },
        { name: "📈 Market",     value: market,                                        inline: true  },
        { name: "🔁 Poll Every", value: `${POLL_INTERVAL_MS / 1000}s`,                 inline: true  },
        { name: "📉 Threshold",  value: `${DROP_THRESHOLD}%`,                          inline: true  },
        { name: "🛡️ Cooldown",   value: `${ALERT_COOLDOWN_MS / 60000} min`,            inline: true  },
        { name: "📊 Watching",   value: INSTRUMENTS.map((i) => i.label).join(", "),    inline: false },
      )
      .setFooter({ text: "Yahoo Finance → Discord Alert Bot" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }

  // ── !price ─────────────────────────────────────────────────────────────────
  if (content === "!price") {
    const thinking = await message.reply("⏳ Fetching prices...");
    const prices = await fetchAllPrices();
    const now = new Date();

    const fields = prices.map((data) => {
      if (!data.ok) {
        return { name: data.label, value: "❌ Error fetching data", inline: true };
      }
      const { label, symbol, currentPrice, openPrice, changePercent } = data;
      const arrow = changePercent >= 0 ? "🟢" : "🔴";
      return {
        name: `${arrow} ${label}`,
        value: [
          `**${formatCurrency(currentPrice)}**`,
          `Change: \`${formatPercent(changePercent)}\``,
          `Open:   \`${formatCurrency(openPrice)}\``,
          `[Chart ↗](${tvChartUrl(symbol)})`,
        ].join("\n"),
        inline: true,
      };
    });

    const embed = new EmbedBuilder()
      .setTitle(`📊 Current Prices — ${isMarketHours() ? "🟢 Market Open" : "🔴 Market Closed"}`)
      .setColor(0x1a73e8)
      .addFields(fields)
      .setFooter({ text: "Data via Yahoo Finance" })
      .setTimestamp(now);

    await thinking.edit({ content: "", embeds: [embed] });
    return;
  }

  // ── !help ──────────────────────────────────────────────────────────────────
  if (content === "!help") {
    const embed = new EmbedBuilder()
      .setTitle("📖 Available Commands")
      .setColor(0x5865f2)
      .addFields(
        { name: "!status", value: "Check if the bot is alive + uptime, market status, settings", inline: false },
        { name: "!price",  value: "Fetch live prices for all monitored instruments",             inline: false },
        { name: "!help",   value: "Show this message",                                           inline: false },
      )
      .setFooter({ text: "Yahoo Finance → Discord Alert Bot" });

    await message.reply({ embeds: [embed] });
  }
});

// ─── Start everything ─────────────────────────────────────────────────────────
console.log("🚀 Market Alert Bot starting...");
console.log(`   Instruments : ${INSTRUMENTS.map((i) => i.label).join(", ")}`);
console.log(`   Threshold   : ${DROP_THRESHOLD}% drop from open`);
console.log(`   Poll every  : ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Cooldown    : ${ALERT_COOLDOWN_MS / 60000} min between alerts`);
console.log("");

await discordClient.login(DISCORD_BOT_TOKEN);

poll();
setInterval(poll, POLL_INTERVAL_MS);
