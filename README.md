# US Market Events Calendar

A small web service that lists scheduled events that move US stocks, including Fed meetings, inflation and jobs data, mega-cap earnings, elections, options expirations and market holidays. Each event comes with its **potential market impact**: why it matters, the typical size of the reaction, what happens if it surprises up or down, which assets and sectors are most exposed, and what to watch.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# open http://localhost:8000
```

Tests: `pip install -r requirements-dev.txt && pytest`

## Deploy publicly (Render)

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, select the repo. Render reads `render.yaml` and builds the `Dockerfile`.
3. The public URL is `https://market-calendar-xxxx.onrender.com`.

The public copy runs with `MC_READ_ONLY=1`, so visitors can browse but not add or delete events. The Dockerfile works on any container host (Fly.io, Railway, Cloud Run).

## Features

- **Month and list views.** Each day is tinted by a risk score built from its events' importance. The **week ahead** strip summarizes what matters in the next 7 days.
- **Impact panel for every event**: what it is, why it moves markets, typical reaction, scenarios, assets affected, sensitive sectors, and what to watch.
- **Cross-market impact**: for every event, how sensitive **Gold, Bitcoin, US stocks, Japan (Nikkei · JPY) and China (CSI 300 · Hang Seng · CNH)** are, and which way they usually move.
- **English / 中文**: switch language in the header. Every event, impact profile and note is translated. The site follows the browser language by default; `?lang=zh` forces Chinese.
- **Live K-lines** at `/markets`: candlestick charts for **Web3** (BTC, ETH, SOL, BNB, XRP, DOGE), **Gold** (COMEX futures, PAXG, silver) and **US stocks** (S&P 500, Nasdaq, Dow, SPY, QQQ, NVDA, AAPL, TSLA, or any ticker you type). Choose 1m / 5m / 15m / 1H / 1D. Past high-impact events for each market are drawn on the chart, and the next ones are listed below it. Candle colors can be green-up (US convention) or red-up (Chinese convention).
- **Context notes**: flags data released during the Fed's pre-meeting blackout, days with several high-impact events, and releases that happen while the market is closed.
- **Custom events**: add your own events (e.g. a stock you hold reporting earnings) and reuse a built-in impact template.
- **Calendar export**: `/api/calendar.ics` works with Google, Apple and Outlook calendars.
- Deep links: `/?event=fomc-2026-10-28`

## Live market data

| Panel | Source | Freshness |
|---|---|---|
| Web3, PAXG | Binance public market data, streamed by the browser over WebSocket | Real-time |
| Gold & silver futures | Yahoo Finance via `/api/kline` | Refreshed every 10s; the free feed is delayed ~10 min |
| US stocks & indices | Yahoo Finance via `/api/kline` | Refreshed every 10s; near real-time in market hours |

`/api/kline` validates symbols and caches responses for 8s, so many viewers share one upstream request. If Binance is blocked in a viewer's region, crypto falls back to Yahoo.

## Data accuracy

| Marker | Source |
|---|---|
| ✓ confirmed | Official FOMC schedule (`app/data/fomc.json`), NYSE holiday/early-close rules, OpEx (3rd Friday), ISM (1st/3rd business day), weekly claims, election day |
| ~ estimated | CPI, PPI, jobs, PCE, GDP, retail sales, JOLTS, UMich, earnings windows, refunding, Jackson Hole: dated from each release's usual pattern |

Check estimated dates against the official calendars (BLS, BEA, Census). To add a new year's FOMC schedule, add it to `app/data/fomc.json`; the UI warns when a year is missing.

Typical-move figures are rough post-2020 historical tendencies. **They are not forecasts or investment advice.**

## API

| Endpoint | Description |
|---|---|
| `GET /api/events?start=&end=&importance=high&category=Inflation&lang=zh` | Events and per-day risk (`lang` = `en` or `zh` on all read endpoints) |
| `GET /api/week?start=` | 7-day outlook (medium/high only) |
| `GET /api/event-types` | All impact profiles |
| `POST /api/custom-events` | `{date, title, time_et?, importance?, template?, description?, impact_notes?}` |
| `DELETE /api/custom-events/{id}` | Remove a custom event |
| `GET /api/kline?symbol=GC=F&interval=5m` | OHLC candles (`1m`, `5m`, `15m`, `1h`, `1d`) |
| `GET /api/calendar.ics?importance=high&importance=medium` | iCalendar feed |

Interactive docs are at `/docs`.

## Layout

```
app/dates.py      NYSE holidays, early closes, business-day rules
app/impact.py     Impact profiles (the knowledge base, edit to tune)
app/impact_zh.py  Chinese text for the impact profiles
app/markets.py    Per-event impact on Gold / BTC / US / Japan / China (EN + 中文)
app/quotes.py     Yahoo Finance candle proxy with caching
app/events.py     Event generation, cross-event annotations, risk score
app/main.py       FastAPI routes
static/           Frontend (vanilla JS, no build step)
```

## Ideas for next steps

- Pull consensus forecasts and actual prints from a data provider (e.g. Trading Economics or FRED) to show the surprise after each release.
- Fetch per-company earnings dates from an earnings API instead of seasonal windows.
- Add LLM-written commentary on each upcoming event based on current market conditions.
