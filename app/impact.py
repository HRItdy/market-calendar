"""Impact profiles for each event type.

Each profile describes *how* an event tends to move US markets: how important it is,
the typical size of the reaction, which assets/sectors are most sensitive, and what
happens under each surprise scenario. Move sizes are rough historical tendencies
(post-2020 regime), not forecasts.
"""
from __future__ import annotations

from copy import deepcopy

# Weight used for the daily "risk score" (sum of weights of events that day).
IMPORTANCE_WEIGHT = {"high": 3, "medium": 2, "low": 1}

PROFILES: dict[str, dict] = {
    "fomc": {
        "category": "Monetary policy",
        "importance": "high",
        "summary": "Federal Reserve rate decision (statement 2:00 p.m. ET, chair press conference 2:30 p.m.).",
        "why": "Sets the federal funds rate, the anchor for every discount rate in the market. "
               "The guidance matters more than the decision itself, because the decision is "
               "usually fully priced in beforehand.",
        "typical_move": "S&P 500 often swings ±1–2% intraday during the press conference. "
                        "The close is usually within ±1%.",
        "assets": {
            "Equities": "Growth/long-duration stocks (Nasdaq) react most to the rate path.",
            "Treasuries": "2-year yield is the purest read of policy expectations.",
            "US dollar": "Hawkish → stronger USD; dovish → weaker.",
            "Gold": "Inverse to real yields; rallies on dovish surprises.",
        },
        "sectors": ["Technology", "Real estate", "Regional banks", "Small caps (Russell 2000)", "Homebuilders"],
        "scenarios": [
            {"case": "Hawkish surprise", "detail": "Higher-for-longer guidance or fewer cuts in the dots → yields up, Nasdaq and small caps sell off, USD rallies."},
            {"case": "As expected", "detail": "Volatility gets crushed after 2:30 p.m., and the prevailing trend usually resumes."},
            {"case": "Dovish surprise", "detail": "Earlier or more cuts signalled → broad rally led by small caps, REITs and unprofitable tech; curve steepens."},
        ],
        "watch": ["Statement wording changes vs. prior", "Dissents", "Press-conference tone on inflation vs. labor", "Balance-sheet (QT) remarks"],
    },
    "fomc_sep": {
        "inherits": "fomc",
        "summary": "Federal Reserve rate decision with Summary of Economic Projections (dot plot).",
        "typical_move": "Larger than a regular meeting. The dot plot can reprice the whole 12-month "
                        "path, and S&P 500 swings of ±1.5–2.5% intraday are common.",
        "watch_extra": ["Median 2-year-ahead dot vs. market pricing", "Longer-run neutral rate estimate", "Core PCE and unemployment projections"],
    },
    "fomc_minutes": {
        "category": "Monetary policy",
        "importance": "medium",
        "summary": "Minutes of the previous FOMC meeting (2:00 p.m. ET, three weeks after the decision).",
        "why": "Reveals the breadth of views behind the decision, such as how many members leaned "
               "hawkish or dovish and any balance-sheet discussion.",
        "typical_move": "Usually modest (±0.3–0.7%). Moves are larger only if the minutes contradict the chair's press-conference message.",
        "assets": {"Treasuries": "Front-end yields", "Equities": "Rate-sensitive growth names"},
        "sectors": ["Technology", "Financials"],
        "scenarios": [
            {"case": "More hawkish than presser", "detail": "Yields tick up and equities fade into the close."},
            {"case": "More dovish than presser", "detail": "Mild relief rally in duration-sensitive assets."},
        ],
        "watch": ["'Many' vs. 'some' participants language", "Discussion of QT pace", "Risk-balance assessment"],
    },
    "cpi": {
        "category": "Inflation",
        "importance": "high",
        "summary": "Consumer Price Index (BLS, 8:30 a.m. ET).",
        "why": "The headline inflation print that most directly shifts Fed expectations. Core CPI "
               "month-over-month is the number traders react to.",
        "typical_move": "S&P 500 ±0.5–1.5% when core misses consensus by 0.1pp or more. "
                        "Index futures react within seconds of 8:30.",
        "assets": {
            "Treasuries": "2-year yield moves 5–15 bp on a 0.1pp core surprise.",
            "Equities": "Rate-sensitive growth stocks are most affected.",
            "US dollar": "Hot print → USD up.",
        },
        "sectors": ["Technology", "Real estate", "Consumer discretionary", "Small caps"],
        "scenarios": [
            {"case": "Hotter than expected", "detail": "Rate-cut odds fall → yields up, equities down (Nasdaq and small caps hit hardest), USD up."},
            {"case": "In line", "detail": "Relief; implied volatility collapses and stocks often drift higher."},
            {"case": "Cooler than expected", "detail": "Rate-cut odds rise → broad rally, yields fall, USD weakens, and gold rises."},
        ],
        "watch": ["Core CPI m/m (vs. 0.2% ≈ target-consistent)", "Shelter / owners' equivalent rent", "Core services ex-housing ('supercore')", "Goods prices and tariff pass-through"],
    },
    "ppi": {
        "category": "Inflation",
        "importance": "medium",
        "summary": "Producer Price Index (BLS, 8:30 a.m. ET).",
        "why": "Pipeline inflation. Its components such as airfares and portfolio management feed "
               "directly into the core PCE estimate.",
        "typical_move": "Usually ±0.2–0.6%. Larger if CPI was ambiguous.",
        "assets": {"Treasuries": "Front-end yields", "Equities": "Margin-sensitive sectors"},
        "sectors": ["Industrials", "Materials", "Consumer staples"],
        "scenarios": [
            {"case": "Hot", "detail": "Margin and inflation worries weigh on stocks; yields up."},
            {"case": "Cool", "detail": "Reinforces disinflation narrative; supportive for equities."},
        ],
        "watch": ["Final demand ex food & energy", "PCE-relevant components"],
    },
    "pce": {
        "category": "Inflation",
        "importance": "high",
        "summary": "Personal Income & Outlays incl. PCE price index (BEA, 8:30 a.m. ET).",
        "why": "Core PCE is the Fed's *official* inflation target measure. It is often "
               "well forecast after CPI/PPI, so surprises are rarer but still matter.",
        "typical_move": "±0.3–0.8% typically, because the print is largely pre-computed by economists after CPI and PPI.",
        "assets": {"Treasuries": "Front-end yields", "US dollar": "Modest"},
        "sectors": ["Consumer discretionary", "Technology"],
        "scenarios": [
            {"case": "Core above nowcast", "detail": "Hawkish repricing; yields up, equities soft."},
            {"case": "Core at/below nowcast", "detail": "Confirms Fed path; mildly bullish."},
        ],
        "watch": ["Core PCE m/m and y/y", "Real personal spending", "Savings rate"],
    },
    "nfp": {
        "category": "Labor market",
        "importance": "high",
        "summary": "Employment Situation / Nonfarm Payrolls (BLS, 8:30 a.m. ET).",
        "why": "The Fed's dual mandate includes maximum employment. Payrolls, the unemployment "
               "rate and wages drive both growth and rate expectations.",
        "typical_move": "S&P 500 ±0.5–1.5%. 10-year yield moves of 10+ bp are common on big misses.",
        "assets": {
            "Treasuries": "Largest single-day yield mover of the month.",
            "US dollar": "Strong report → USD up.",
            "Equities": "Reaction depends on regime (good news can be bad news when inflation is the worry).",
        },
        "sectors": ["Financials", "Consumer discretionary", "Small caps", "Industrials"],
        "scenarios": [
            {"case": "Strong jobs + hot wages", "detail": "Fewer cuts priced → yields up, growth stocks down, USD up."},
            {"case": "Goldilocks (solid jobs, cool wages)", "detail": "Best case for equities: broad rally."},
            {"case": "Weak jobs / unemployment jumps", "detail": "Cuts priced in, but recession fears can dominate: defensives outperform and cyclicals fall."},
        ],
        "watch": ["Headline payrolls vs. consensus", "Unemployment rate (Sahm-rule risk)", "Average hourly earnings m/m", "Revisions to prior 2 months"],
    },
    "claims": {
        "category": "Labor market",
        "importance": "low",
        "summary": "Weekly initial jobless claims (DOL, 8:30 a.m. ET).",
        "why": "The highest-frequency labor indicator. It matters more when the labor market is the market's focus.",
        "typical_move": "Usually negligible (<0.3%). A jump above ~260k can spook markets.",
        "assets": {"Treasuries": "Front-end yields"},
        "sectors": ["Consumer discretionary"],
        "scenarios": [
            {"case": "Spike higher", "detail": "Raises layoff fears; yields fall, defensives outperform."},
            {"case": "Stays low", "detail": "Little reaction; confirms resilient labor market."},
        ],
        "watch": ["4-week moving average", "Continuing claims trend"],
    },
    "jolts": {
        "category": "Labor market",
        "importance": "medium",
        "summary": "Job Openings and Labor Turnover Survey (BLS, 10:00 a.m. ET).",
        "why": "Labor demand vs. supply. Openings and the quits rate signal wage pressure.",
        "typical_move": "±0.2–0.6%. Matters more in a jobs-report week.",
        "assets": {"Treasuries": "Front-end yields"},
        "sectors": ["Staffing", "Consumer discretionary"],
        "scenarios": [
            {"case": "Openings jump", "detail": "Tight labor market → hawkish lean."},
            {"case": "Openings/quits fall", "detail": "Cooling labor market → yields down."},
        ],
        "watch": ["Openings level", "Quits rate", "Openings-per-unemployed ratio"],
    },
    "ism_mfg": {
        "category": "Growth",
        "importance": "medium",
        "summary": "ISM Manufacturing PMI (10:00 a.m. ET, first business day).",
        "why": "First read on the month's economy. 50 is the expansion/contraction line, and "
               "the prices-paid sub-index feeds inflation views.",
        "typical_move": "±0.3–0.8%. Larger when the index crosses 50.",
        "assets": {"Equities": "Cyclicals", "Commodities": "Industrial metals, oil"},
        "sectors": ["Industrials", "Materials", "Energy", "Transports"],
        "scenarios": [
            {"case": "Above 50 / beat", "detail": "Cyclicals and small caps outperform; yields up."},
            {"case": "Deep contraction", "detail": "Growth scare; defensives and Treasuries rally."},
        ],
        "watch": ["New orders", "Prices paid", "Employment sub-index"],
    },
    "ism_svc": {
        "category": "Growth",
        "importance": "medium",
        "summary": "ISM Services PMI (10:00 a.m. ET, third business day).",
        "why": "Services are about 70% of the US economy. Services prices are the stickiest part of inflation.",
        "typical_move": "±0.3–0.8%.",
        "assets": {"Treasuries": "Yields react to prices-paid", "Equities": "Broad"},
        "sectors": ["Consumer discretionary", "Financials"],
        "scenarios": [
            {"case": "Strong / hot prices", "detail": "Hawkish; yields up."},
            {"case": "Below 50", "detail": "Recession signal; defensives outperform."},
        ],
        "watch": ["Business activity", "Prices paid", "Employment"],
    },
    "retail": {
        "category": "Growth",
        "importance": "medium",
        "summary": "Advance Retail Sales (Census, 8:30 a.m. ET).",
        "why": "Consumer spending drives about 68% of GDP. The 'control group' feeds directly into GDP estimates.",
        "typical_move": "±0.3–0.8%.",
        "assets": {"Equities": "Consumer stocks", "Treasuries": "Growth expectations"},
        "sectors": ["Consumer discretionary", "Retailers (XRT)", "Consumer staples"],
        "scenarios": [
            {"case": "Strong beat", "detail": "Retailers rally; yields up on growth."},
            {"case": "Miss", "detail": "Consumer-slowdown fears; discretionary underperforms."},
        ],
        "watch": ["Control group", "Ex-autos & gas", "Prior-month revisions"],
    },
    "gdp": {
        "category": "Growth",
        "importance": "medium",
        "summary": "GDP advance estimate (BEA, 8:30 a.m. ET).",
        "why": "Broadest measure of growth. It is backward-looking, but a big miss shifts the recession narrative.",
        "typical_move": "±0.3–0.8%. Often overshadowed by same-week earnings.",
        "assets": {"Treasuries": "Growth expectations", "US dollar": "Relative growth"},
        "sectors": ["Cyclicals", "Small caps"],
        "scenarios": [
            {"case": "Strong", "detail": "Soft-landing narrative; cyclicals up."},
            {"case": "Negative print", "detail": "Recession fears; Treasuries rally, defensives lead."},
        ],
        "watch": ["Real final sales to private domestic purchasers", "Core PCE prices (quarterly)", "Inventories/net exports distortions"],
    },
    "umich": {
        "category": "Sentiment",
        "importance": "low",
        "summary": "University of Michigan Consumer Sentiment, preliminary (10:00 a.m. ET).",
        "why": "Inflation expectations sub-index is watched closely by the Fed.",
        "typical_move": "Usually small (<0.4%). Larger if 1-yr/5-yr inflation expectations jump.",
        "assets": {"Treasuries": "Breakevens"},
        "sectors": ["Consumer discretionary"],
        "scenarios": [
            {"case": "Inflation expectations jump", "detail": "Hawkish read; yields up."},
            {"case": "Sentiment collapses", "detail": "Spending-slowdown worries."},
        ],
        "watch": ["1-year and 5–10-year inflation expectations"],
    },
    "opex": {
        "category": "Market structure",
        "importance": "low",
        "summary": "Monthly equity options expiration (third Friday).",
        "why": "Large dealer hedges roll off, which can 'unpin' the market and change "
               "volatility dynamics into the following week.",
        "typical_move": "Elevated volume and intraday 'pinning' near big strikes. Direction is not predictable.",
        "assets": {"Equities": "Index & single-stock options-heavy names", "Volatility": "VIX"},
        "sectors": ["Mega-cap tech", "High-options-volume names"],
        "scenarios": [
            {"case": "Large gamma roll-off", "detail": "Volatility can expand the following week."},
        ],
        "watch": ["Open interest at key S&P strikes", "0DTE flows"],
    },
    "quad_witching": {
        "inherits": "opex",
        "importance": "medium",
        "summary": "Quarterly 'quad witching': stock and index options and futures all expire, plus S&P index rebalance.",
        "typical_move": "Among the highest-volume days of the year, with large closing-auction imbalances.",
        "watch_extra": ["S&P 500 quarterly rebalance flows", "Closing auction imbalance at 3:50 p.m."],
    },
    "earnings_banks": {
        "category": "Earnings",
        "importance": "medium",
        "summary": "Earnings season kickoff: big banks report (JPM, WFC, C, BAC, GS, MS that week).",
        "why": "Bank results and commentary on credit quality, loan growth and consumer health "
               "set the tone for the whole season.",
        "typical_move": "Sector moves of ±2–4%. The index reacts to the macro commentary.",
        "assets": {"Equities": "Financials (XLF, KBE)"},
        "sectors": ["Financials", "Regional banks"],
        "scenarios": [
            {"case": "Strong NII & benign credit", "detail": "Financials and cyclicals rally."},
            {"case": "Rising provisions / charge-offs", "detail": "Credit-cycle fears; broad risk-off."},
        ],
        "watch": ["Net interest income guidance", "Credit-loss provisions", "Investment banking fees", "CEO macro commentary"],
    },
    "earnings_megacap": {
        "category": "Earnings",
        "importance": "high",
        "summary": "Mega-cap tech earnings week (MSFT, GOOGL, META, AMZN, AAPL typically report).",
        "why": "These 5 companies are roughly 25% of S&P 500 weight. AI capex guidance drives the "
               "whole AI/semiconductor complex.",
        "typical_move": "Individual stocks move ±5–10%, and the Nasdaq 100 often moves ±1–2% on the heaviest night.",
        "assets": {"Equities": "Nasdaq 100, S&P 500 (cap-weighted)"},
        "sectors": ["Technology", "Communication services", "Semiconductors", "Utilities/power (AI capex)"],
        "scenarios": [
            {"case": "Capex raised + cloud beats", "detail": "AI trade extends; semis and power names rally."},
            {"case": "Capex cut or cloud miss", "detail": "AI-trade unwind; Nasdaq underperforms Dow/equal-weight."},
        ],
        "watch": ["Cloud growth (Azure, AWS, GCP)", "Capex guidance", "AI monetization commentary", "Ad revenue trends"],
    },
    "earnings_nvda": {
        "category": "Earnings",
        "importance": "high",
        "summary": "NVIDIA earnings (after the close).",
        "why": "The bellwether for AI demand and the largest or second-largest company in the S&P 500. "
               "Options typically imply about a ±6–9% move.",
        "typical_move": "NVDA ±6–9%. Semiconductors (SOXX) and the Nasdaq often move ±1–2% the next day.",
        "assets": {"Equities": "Semiconductors, AI infrastructure, Nasdaq"},
        "sectors": ["Semiconductors", "Data-center hardware", "Power & utilities"],
        "scenarios": [
            {"case": "Beat & raise above whisper", "detail": "AI complex rallies; broad market follows."},
            {"case": "Merely in-line guide", "detail": "Often sells off on high expectations; semis lag."},
        ],
        "watch": ["Data-center revenue", "Gross-margin guidance", "Supply/China commentary"],
    },
    "jackson_hole": {
        "category": "Monetary policy",
        "importance": "high",
        "summary": "Jackson Hole Economic Symposium: Fed chair keynote.",
        "why": "Historically used to signal major policy pivots (2022 'pain' speech, 2024 'time has come').",
        "typical_move": "S&P 500 ±1–3% on the speech day (−3.4% on Aug 26, 2022).",
        "assets": {"Treasuries": "Whole curve", "US dollar": "Broad", "Equities": "Broad"},
        "sectors": ["Technology", "Small caps", "Real estate"],
        "scenarios": [
            {"case": "Hawkish framework", "detail": "Sharp equity sell-off; yields and USD up."},
            {"case": "Pivot signal", "detail": "Broad rally; curve steepens."},
        ],
        "watch": ["Policy-framework changes", "Labor vs. inflation emphasis"],
    },
    "refunding": {
        "category": "Fiscal / Treasury",
        "importance": "medium",
        "summary": "Treasury Quarterly Refunding announcement (8:30 a.m. ET).",
        "why": "Sets coupon auction sizes. Heavier long-end issuance can push term premium and 10-year yields higher.",
        "typical_move": "Usually modest. Occasionally a major driver (e.g., Nov 2023 rally on lighter long-end supply).",
        "assets": {"Treasuries": "10-year & 30-year yields, term premium"},
        "sectors": ["Real estate", "Utilities", "Long-duration growth"],
        "scenarios": [
            {"case": "Larger coupon sizes", "detail": "Long-end yields up; equities pressured."},
            {"case": "Tilt to bills", "detail": "Long-end relief rally."},
        ],
        "watch": ["Coupon size guidance", "Buyback program", "Bill share of issuance"],
    },
    "election": {
        "category": "Politics",
        "importance": "high",
        "summary": "US federal election day. Results arrive overnight, so the main reaction is at the next session's open.",
        "why": "Control of Congress and the White House shapes tax, tariff, regulation and spending policy. "
               "Markets dislike uncertainty more than any particular outcome, so a clear result usually brings relief.",
        "typical_move": "VIX tends to rise into the vote and fall afterwards. S&P 500 moves of ±1–2.5% the day after are "
                        "common (+2.5% Nov 6, 2024). Historically stocks have rallied in the 12 months after midterms.",
        "assets": {
            "Equities": "Policy-sensitive sectors move most; small caps react to domestic-policy expectations.",
            "Treasuries": "Deficit expectations drive the long end (unified government → more fiscal → higher yields).",
            "US dollar": "Tariff/fiscal outlook.",
            "Volatility": "VIX term structure 'kink' around election date unwinds.",
        },
        "sectors": ["Healthcare / pharma (drug pricing)", "Energy & clean energy", "Defense", "Banks (regulation)", "Small caps"],
        "scenarios": [
            {"case": "Divided government", "detail": "Gridlock limits new fiscal/regulatory changes; historically benign for equities and bonds."},
            {"case": "Unified government (sweep)", "detail": "Bigger policy swings priced fast; winners/losers by sector, long-end yields can rise on fiscal expansion."},
            {"case": "Contested / delayed result", "detail": "Volatility stays elevated; risk-off until resolved."},
        ],
        "watch": ["Senate & House control", "Call timing for key races", "Futures overnight", "Post-election VIX crush"],
    },
    "russell_recon": {
        "category": "Market structure",
        "importance": "low",
        "summary": "FTSE Russell annual reconstitution (effective after the close).",
        "why": "Tens of billions of dollars of index rebalancing are executed in the closing auction.",
        "typical_move": "Record closing-auction volume. Little index direction, but large single-stock moves.",
        "assets": {"Equities": "Small caps (IWM)"},
        "sectors": ["Small caps"],
        "scenarios": [{"case": "Heavy imbalance", "detail": "Sharp moves in small-cap names near 4:00 p.m."}],
        "watch": ["Closing imbalance data"],
    },
    "quarter_end": {
        "category": "Market structure",
        "importance": "low",
        "summary": "Quarter-end: pension rebalancing and window dressing.",
        "why": "Pensions rebalance between stocks and bonds after large moves in either. Funding markets can tighten.",
        "typical_move": "Late-day flows can be sizable. Direction depends on quarter-to-date performance (big equity rally → net selling).",
        "assets": {"Equities": "Broad", "Funding": "Repo / SOFR"},
        "sectors": ["Broad"],
        "scenarios": [{"case": "Equities strongly outperformed bonds", "detail": "Expect pension selling of equities into quarter-end."}],
        "watch": ["Pension rebalance estimates", "Repo rates"],
    },
    "holiday": {
        "category": "Market hours",
        "importance": "low",
        "summary": "NYSE / Nasdaq closed.",
        "why": "No US cash equity trading. Bond market may also be closed or close early.",
        "typical_move": "N/A. Liquidity is thin around holidays and moves can be exaggerated.",
        "assets": {}, "sectors": [], "scenarios": [], "watch": [],
    },
    "early_close": {
        "category": "Market hours",
        "importance": "low",
        "summary": "Early close: equities stop trading at 1:00 p.m. ET.",
        "why": "Thin holiday liquidity.",
        "typical_move": "Typically low volume. There is a seasonal upward bias around holidays.",
        "assets": {}, "sectors": [], "scenarios": [], "watch": [],
    },
    "custom": {
        "category": "Custom",
        "importance": "medium",
        "summary": "User-defined event.",
        "why": "", "typical_move": "", "assets": {}, "sectors": [], "scenarios": [], "watch": [],
    },
}


def profile(event_type: str) -> dict:
    """Resolve a profile, applying single-level inheritance."""
    p = deepcopy(PROFILES.get(event_type, PROFILES["custom"]))
    parent = p.pop("inherits", None)
    if parent:
        base = deepcopy(PROFILES[parent])
        extra = p.pop("watch_extra", [])
        base.update(p)
        base["watch"] = base.get("watch", []) + extra
        p = base
    return p
