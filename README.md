# 📉 Yahoo Finance → Discord Alert Bot

A **100% free**, zero-signup Node.js bot that monitors S&P 500, Nasdaq, and Dow Jones every 60 seconds using **Yahoo Finance** and fires a rich Discord embed alert when any instrument drops 5%+ from its daily open.

No TradingView subscription. No API keys. No credit card.

---

## 🏗️ How It Works

```
Yahoo Finance (free, unofficial)
        │
        │  Polls every 60 seconds
        ▼
  Node.js Bot  ──► calculates % change from open
        │
        │  If drop >= threshold → POST Discord Webhook
        ▼
  Discord Channel 🔔
```

- Runs **only during US market hours** (9:30 AM – 4:00 PM ET, Mon–Fri)
- **1-hour cooldown** per instrument to avoid spam
- Configurable threshold and poll interval via `.env`

---

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Discord server where you have **Manage Webhooks** permission

That's it. No other accounts needed.

---

## 🚀 Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
DROP_THRESHOLD=-5.0
POLL_INTERVAL_SECONDS=60
```

**Getting your Discord Webhook URL:**
1. Open Discord → right-click your channel → **Edit Channel**
2. **Integrations** → **Webhooks** → **New Webhook**
3. Name it (e.g. "Market Alerts"), select the channel, click **Copy Webhook URL**
4. Paste it into `.env`

### 3. Run

```bash
npm start
```

You'll see output like:

```
🚀 TradingView Discord Alert Bot started
   Instruments : S&P 500, Nasdaq 100, Dow Jones
   Threshold   : -5% drop from open
   Poll every  : 60s
   Cooldown    : 60 min between alerts

🔄 Polling 3 instruments... (Fri, 08 May 2026 14:00:00 GMT)
[S&P 500]    Price: $5,204.34 | Change: -1.23%
[Nasdaq 100] Price: $18,102.55 | Change: -2.10%
[Dow Jones]  Price: $39,010.22 | Change: -0.88%
```

---

## ☁️ Deploy to Railway (Free — runs 24/7)

1. Push your project to a **GitHub repo**
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo
4. Go to **Variables** tab → add your `.env` values
5. Railway runs `npm start` automatically — done!

> Railway's free tier gives 500 hours/month — enough to run this bot continuously.

## ☁️ Deploy to Render (Free)

1. Push to GitHub
2. [render.com](https://render.com) → **New Web Service** → connect repo
3. **Build Command:** `npm install`
4. **Start Command:** `node bot.js`
5. Add env vars in the dashboard

> ⚠️ Render's free tier **spins down after inactivity**. Use Railway for always-on behaviour.

---

## ⚙️ Customisation

### Add or remove instruments

Edit the `INSTRUMENTS` array in `bot.js`:

```js
const INSTRUMENTS = [
  { label: "S&P 500",    symbol: "^GSPC" },
  { label: "Nasdaq 100", symbol: "^IXIC" },
  { label: "Dow Jones",  symbol: "^DJI"  },
  { label: "Apple",      symbol: "AAPL"  },  // ← add any stock
  { label: "Bitcoin",    symbol: "BTC-USD" }, // ← crypto too
  { label: "AEX",        symbol: "^AEX"  },  // ← Amsterdam index
];
```

Yahoo Finance symbol examples:

| Market         | Symbol     |
|----------------|------------|
| S&P 500        | `^GSPC`    |
| Nasdaq Comp    | `^IXIC`    |
| Dow Jones      | `^DJI`     |
| AEX (NL)       | `^AEX`     |
| DAX (DE)       | `^GDAXI`   |
| FTSE 100 (UK)  | `^FTSE`    |
| Bitcoin        | `BTC-USD`  |
| Ethereum       | `ETH-USD`  |
| Gold           | `GC=F`     |
| Crude Oil      | `CL=F`     |
| Apple          | `AAPL`     |
| Tesla          | `TSLA`     |

### Change the threshold

In `.env`:
```env
DROP_THRESHOLD=-3.0   # alert on 3% drop
DROP_THRESHOLD=-10.0  # only alert on 10% crash
```

### Change poll frequency

```env
POLL_INTERVAL_SECONDS=30   # check every 30 seconds
POLL_INTERVAL_SECONDS=300  # check every 5 minutes
```

### Change cooldown

Edit `ALERT_COOLDOWN_MS` in `bot.js`:
```js
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour (default)
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
```

---

## 📨 Example Discord Alert

```
🚨 FLASH DROP ALERT — S&P 500
S&P 500 has dropped 5.23% from today's open.
Review your positions and manage risk accordingly.

📛 Instrument    📉 Change Today    💵 Current Price
  S&P 500          -5.23%             $4,820.50

🔓 Today's Open  📊 Drop from Open
  $5,088.50        $268.00

🕐 Time (UTC): Fri, 08 May 2026 15:30:00 GMT
📈 Chart: View on TradingView ↗
```

---

## 📁 Project Structure

```
yf-discord-bot/
├── bot.js          # Main bot — polling logic + Discord sender
├── package.json    # Dependencies & scripts
├── .env.example    # Config template
├── .env            # Your secrets (never commit!)
├── .gitignore
└── README.md
```

---

## ❓ FAQ

**Does this cost anything?**
No. Yahoo Finance's data is free and unofficial. Discord webhooks are free.

**How delayed is the data?**
Yahoo Finance has a ~15 min delay for some indices on the free tier, but typically returns real-time or near-real-time data for major US indices via the quote endpoint.

**Will it alert me outside market hours?**
No — the bot skips polling outside 9:30 AM–4:00 PM ET, Mon–Fri automatically.

**Can I add European indices?**
Yes! Add them to the `INSTRUMENTS` array. The market hours check is US-centric — you may want to remove or extend it if you're monitoring non-US markets.

---

## 📄 License

MIT
