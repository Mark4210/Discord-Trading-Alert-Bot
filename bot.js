import yahooFinance from "yahoo-finance2";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1502272148037959801/aJn9vsIj5AMMRTPYlE3ET0wmftz6xC6bxbk6AHc23D-tyIsmWFS7tL364Dgf3hNvMhWS;
const DROP_THRESHOLD = parseFloat(process.env.DROP_THRESHOLD || "-5.0");
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_SECONDS || "60") * 1000;

// Instruments to monitor: { label, symbol }
const INSTRUMENTS = [
  { label: "S&P 500",      symbol: "^GSPC" },
  { label: "Nasdaq 100",   symbol: "^IXIC" },
  { label: "Dow Jones",    symbol: "^DJI"  },
];

// Cooldown: don't re-alert the same instrument within this window (ms)
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Track last alert time per symbol
const lastAlerted = {};

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

function tvChartUrl(symbol) {
  const map = {
    "^GSPC": "SP:SPX",
    "^IXIC": "NASDAQ:COMP",
    "^DJI":  "DJ:DJI",
  };
  const tv = map[symbol] || symbol;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
}

function isMarketHours() {
  const now = new Date();
  // US Eastern time offset (EST = UTC-5, EDT = UTC-4)
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const etDay = now.getUTCDay(); // 0=Sun, 6=Sat

  if (etDay === 0 || etDay === 6) return false; // weekend
  const totalMinutes = etHour * 60 + etMinute;
  return totalMinutes >= 570 && totalMinutes <= 960; // 9:30 AM – 4:00 PM ET
}

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

// ─── Discord Alert ────────────────────────────────────────────────────────────
async function sendDiscordAlert({ label, symbol, currentPrice, openPrice, changePercent }) {
  const chartUrl = tvChartUrl(symbol);
  const now = new Date();
  const dropAbs = Math.abs(changePercent).toFixed(2);

  const embed = {
    embeds: [
      {
        title: `🚨 FLASH DROP ALERT — ${label}`,
        description: `**${label}** has dropped **${dropAbs}%** from today's open.\nReview your positions and manage risk accordingly.`,
        color: 0xff2d2d,
        fields: [
          {
            name: "📛 Instrument",
            value: `\`${label}\``,
            inline: true,
          },
          {
            name: "📉 Change Today",
            value: `\`${formatPercent(changePercent)}\``,
            inline: true,
          },
          {
            name: "💵 Current Price",
            value: `\`${formatCurrency(currentPrice)}\``,
            inline: true,
          },
          {
            name: "🔓 Today's Open",
            value: `\`${formatCurrency(openPrice)}\``,
            inline: true,
          },
          {
            name: "📊 Drop from Open",
            value: `\`${formatCurrency(openPrice - currentPrice)}\``,
            inline: true,
          },
          {
            name: "🕐 Time (UTC)",
            value: `\`${now.toUTCString()}\``,
            inline: false,
          },
          {
            name: "📈 Chart",
            value: `[View on TradingView ↗](${chartUrl})`,
            inline: false,
          },
        ],
        footer: {
          text: "Yahoo Finance → Discord Alert Bot • Auto-refreshes every 60s",
          icon_url: "https://www.tradingview.com/favicon.ico",
        },
        timestamp: now.toISOString(),
      },
    ],
  };

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(embed),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord error: ${err}`);
  }
}

// ─── Check One Instrument ─────────────────────────────────────────────────────
async function checkInstrument({ label, symbol }) {
  const quote = await yahooFinance.quote(symbol);

  const currentPrice  = quote.regularMarketPrice;
  const openPrice     = quote.regularMarketOpen;
  const changePercent = quote.regularMarketChangePercent; // already as % e.g. -5.23

  if (currentPrice == null || openPrice == null || changePercent == null) {
    console.warn(`⚠️  [${label}] Incomplete data from Yahoo Finance`);
    return;
  }

  console.log(`[${label}] Price: ${formatCurrency(currentPrice)} | Change: ${formatPercent(changePercent)}`);

  // Check threshold
  if (changePercent <= DROP_THRESHOLD) {
    const now = Date.now();
    const lastAlert = lastAlerted[symbol] || 0;

    if (now - lastAlert < ALERT_COOLDOWN_MS) {
      const minutesLeft = Math.ceil((ALERT_COOLDOWN_MS - (now - lastAlert)) / 60000);
      console.log(`   ⏳ [${label}] Drop detected but in cooldown (${minutesLeft} min remaining)`);
      return;
    }

    console.log(`   🚨 [${label}] DROP ALERT TRIGGERED! ${formatPercent(changePercent)}`);
    await sendDiscordAlert({ label, symbol, currentPrice, openPrice, changePercent });
    lastAlerted[symbol] = now;
    console.log(`   ✅ [${label}] Discord alert sent`);
  }
}

// ─── Main Poll Loop ───────────────────────────────────────────────────────────
async function poll() {
  if (!isMarketHours()) {
    console.log(`💤 Market closed — skipping poll (${new Date().toUTCString()})`);
    return;
  }

  console.log(`\n🔄 Polling ${INSTRUMENTS.length} instruments... (${new Date().toUTCString()})`);

  for (const instrument of INSTRUMENTS) {
    try {
      await checkInstrument(instrument);
    } catch (err) {
      console.error(`❌ [${instrument.label}] Error: ${err.message}`);
    }
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
if (!DISCORD_WEBHOOK_URL) {
  console.error("❌ DISCORD_WEBHOOK_URL is not set in .env — exiting.");
  process.exit(1);
}

console.log("🚀 TradingView Discord Alert Bot started");
console.log(`   Instruments : ${INSTRUMENTS.map((i) => i.label).join(", ")}`);
console.log(`   Threshold   : ${DROP_THRESHOLD}% drop from open`);
console.log(`   Poll every  : ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Cooldown    : ${ALERT_COOLDOWN_MS / 60000} min between alerts`);
console.log("");

// Run immediately then on interval
poll();
setInterval(poll, POLL_INTERVAL_MS);
