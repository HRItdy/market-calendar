"""Cross-market impact of each event type: Gold, Bitcoin, US stocks, Japan, China.

Each entry is (sensitivity, English, Chinese). Sensitivity is how strongly that market
usually reacts to the event (high / medium / low). The texts describe the *conditional*
reaction, since most events can surprise in either direction. Asian markets react in
their next session for events released during US hours.
"""
from __future__ import annotations

MARKET_KEYS = ("gold", "btc", "us", "japan", "china")

MARKET_NAMES = {
    "en": {"gold": "Gold", "btc": "Bitcoin (BTC)", "us": "US stocks", "japan": "Japan (Nikkei · JPY)", "china": "China (CSI 300 · Hang Seng · CNH)"},
    "zh": {"gold": "黄金", "btc": "比特币 (BTC)", "us": "美股", "japan": "日本 (日经225 · 日元)", "china": "中国 (沪深300 · 恒生 · 离岸人民币)"},
}

M = {
    "fomc": {
        "gold": ("high",
                 "Moves inversely to real yields and the dollar. Dovish guidance → gold rallies, while a hawkish tilt → gold falls 1–2%.",
                 "与实际利率和美元反向。鸽派指引 → 黄金上涨；鹰派倾向 → 黄金可能下跌1–2%。"),
        "btc": ("high",
                "Trades as a high-beta liquidity asset. Dovish → BTC often +3–6%; hawkish → sharp drop, and it reacts instantly because it trades 24/7.",
                "作为高贝塔的流动性资产交易。鸽派 → BTC常涨3–6%；鹰派 → 急跌，且因24/7交易会第一时间反应。"),
        "us": ("high",
               "The biggest scheduled driver. Nasdaq and small caps swing most; the press conference sets the direction into the close.",
               "最重要的定期驱动事件。纳指和小盘股波动最大，新闻发布会决定收盘方向。"),
        "japan": ("high",
                  "Reacts at the next Tokyo open. Hawkish Fed → USD/JPY up (weaker yen) → exporters supported. Dovish Fed → yen strengthens, which can hit the Nikkei and trigger carry-trade unwinds.",
                  "东京下一交易时段反应。美联储鹰派 → 美元/日元走高（日元走弱）→ 利好出口股；鸽派 → 日元走强，可能拖累日经并引发套息交易平仓。"),
        "china": ("medium",
                  "Fed easing → weaker dollar → more room for PBOC easing and inflows to Hong Kong (HIBOR follows US rates via the HKD peg). Hang Seng is more sensitive than A-shares, which are mostly driven by domestic policy.",
                  "美联储宽松 → 美元走弱 → 中国央行宽松空间加大，资金流入港股（港元联系汇率使HIBOR跟随美国利率）。恒指比A股更敏感，A股主要受国内政策驱动。"),
    },
    "fomc_minutes": {
        "gold": ("low", "Small moves via yields; matters only if the minutes surprise on the rate path.", "通过利率小幅影响；仅当纪要对利率路径有意外时才明显。"),
        "btc": ("low", "Usually a minor intraday reaction.", "通常仅日内小幅波动。"),
        "us": ("medium", "Modest; larger if the minutes contradict the chair's press-conference message.", "影响温和；若与主席发布会口径矛盾则波动加大。"),
        "japan": ("low", "Mild USD/JPY move; Nikkei reacts next session only to a clear hawkish/dovish shift.", "美元/日元小幅波动；仅在明显鹰/鸽转向时日经次日反应。"),
        "china": ("low", "Limited direct impact.", "直接影响有限。"),
    },
    "cpi": {
        "gold": ("high", "Hot CPI → higher yields and a stronger dollar → gold down. Cool CPI → gold up. Gold usually moves 1–2% on a big surprise.", "CPI高于预期 → 利率与美元走强 → 黄金下跌；低于预期 → 黄金上涨。大幅意外时常波动1–2%。"),
        "btc": ("high", "Very sensitive: cool print → rate-cut hopes → BTC rallies; hot print → risk-off selling. Reacts at 8:30 ET before stocks open.", "非常敏感：数据偏冷 → 降息预期升温 → BTC上涨；偏热 → 避险抛售。美东8:30即反应，早于美股开盘。"),
        "us": ("high", "One of the biggest monthly movers. Growth stocks and small caps react most to core CPI surprises.", "每月最重要的波动来源之一。成长股和小盘股对核心CPI意外最敏感。"),
        "japan": ("medium", "Hot CPI → USD/JPY up (yen weaker) → exporters gain, but a US equity sell-off can drag the Nikkei. Cool CPI → yen strengthens.", "CPI偏热 → 美元/日元上涨（日元走弱）→ 利好出口股，但美股下跌可能拖累日经；偏冷 → 日元走强。"),
        "china": ("medium", "Cool US inflation → weaker dollar → supportive for CNH and Hong Kong tech. Hot inflation → tighter global liquidity weighs on Hang Seng.", "美国通胀降温 → 美元走弱 → 利好离岸人民币和港股科技；通胀偏热 → 全球流动性收紧，压制恒指。"),
    },
    "ppi": {
        "gold": ("low", "Minor; moves with yields if PPI shifts the core PCE estimate.", "影响较小；若改变核心PCE预测则随利率波动。"),
        "btc": ("medium", "Can extend the CPI reaction when inflation is the market's main focus.", "当市场聚焦通胀时，可能延续CPI的反应。"),
        "us": ("medium", "Usually ±0.2–0.6%; larger if CPI was ambiguous.", "通常±0.2–0.6%；若CPI信号模糊则更大。"),
        "japan": ("low", "Small USD/JPY effect.", "对美元/日元影响小。"),
        "china": ("low", "Limited impact.", "影响有限。"),
    },
    "pce": {
        "gold": ("medium", "Core PCE above forecast → yields up, gold down; below → gold up. Usually smaller than CPI.", "核心PCE高于预期 → 利率上升、黄金下跌；低于预期 → 黄金上涨。通常小于CPI的影响。"),
        "btc": ("medium", "Confirms or challenges the rate-cut path; moderate reaction.", "确认或挑战降息路径；反应中等。"),
        "us": ("high", "The Fed's target gauge. Reaction is usually moderate because CPI and PPI pre-signal it.", "美联储目标通胀指标。因CPI/PPI已提前透露，反应通常温和。"),
        "japan": ("low", "Modest USD/JPY move.", "美元/日元温和波动。"),
        "china": ("low", "Limited impact through the dollar.", "通过美元间接影响，有限。"),
    },
    "nfp": {
        "gold": ("high", "Strong jobs → yields and dollar up → gold falls. Weak jobs → gold rallies on rate-cut bets and safe-haven demand.", "就业强劲 → 利率与美元上涨 → 黄金下跌；就业疲弱 → 降息预期与避险需求推高黄金。"),
        "btc": ("high", "Goldilocks report → BTC rallies with risk assets. A very weak report can cause a risk-off sell-off first.", "“金发姑娘”式数据 → BTC随风险资产上涨；极弱数据可能先引发避险抛售。"),
        "us": ("high", "Market-wide mover. Good news can be bad news if it pushes rate cuts further out.", "影响整体市场。若推迟降息，好消息也可能是坏消息。"),
        "japan": ("high", "Very sensitive through USD/JPY. A weak report can spark yen strength and carry-trade unwinds (e.g., the weak July 2024 report helped trigger the Nikkei's −12.4% day on Aug 5, 2024).", "通过美元/日元高度敏感。弱数据可能导致日元走强和套息平仓（如2024年7月弱非农促成了2024年8月5日日经暴跌12.4%）。"),
        "china": ("medium", "Weak US jobs → Fed easing bets → weaker dollar → supportive for Hong Kong stocks and CNH, unless global recession fears dominate.", "美国就业疲弱 → 美联储宽松预期 → 美元走弱 → 利好港股和人民币，除非全球衰退担忧占主导。"),
    },
    "claims": {
        "gold": ("low", "Minor unless claims spike.", "除非申领人数激增，否则影响小。"),
        "btc": ("low", "Minor.", "影响小。"),
        "us": ("low", "Negligible unless claims break above ~260k.", "除非突破约26万，否则影响可忽略。"),
        "japan": ("low", "Minor.", "影响小。"),
        "china": ("low", "Minor.", "影响小。"),
    },
    "jolts": {
        "gold": ("low", "Small yield-driven move.", "受利率驱动的小幅波动。"),
        "btc": ("low", "Small reaction.", "反应较小。"),
        "us": ("medium", "More important in a jobs-report week.", "在非农周更重要。"),
        "japan": ("low", "Small USD/JPY effect.", "对美元/日元影响小。"),
        "china": ("low", "Limited impact.", "影响有限。"),
    },
    "ism_mfg": {
        "gold": ("low", "Weak reading → lower yields → mild gold support.", "数据疲弱 → 利率下行 → 小幅支撑黄金。"),
        "btc": ("low", "Minor; follows broad risk sentiment.", "影响小；跟随整体风险情绪。"),
        "us": ("medium", "Cyclicals and industrials react most, especially around the 50 line.", "周期股和工业股反应最大，尤其在50荣枯线附近。"),
        "japan": ("medium", "Global manufacturing proxy; Japanese exporters, autos and machinery are sensitive.", "全球制造业风向标；日本出口、汽车和机械股敏感。"),
        "china": ("medium", "Read alongside China's own PMI; weak US demand hurts Chinese exporters and commodity-linked stocks.", "与中国PMI结合解读；美国需求疲弱不利于中国出口企业和大宗商品相关股。"),
    },
    "ism_svc": {
        "gold": ("low", "Hot prices paid → yields up → gold softer.", "价格分项偏热 → 利率上升 → 黄金走软。"),
        "btc": ("low", "Minor.", "影响小。"),
        "us": ("medium", "Services are about 70% of the economy; below 50 is a recession signal.", "服务业约占经济70%；低于50为衰退信号。"),
        "japan": ("low", "Mild USD/JPY effect.", "对美元/日元影响温和。"),
        "china": ("low", "Limited impact.", "影响有限。"),
    },
    "retail": {
        "gold": ("low", "Strong spending → yields up → mild gold pressure.", "消费强劲 → 利率上升 → 黄金小幅承压。"),
        "btc": ("low", "Minor.", "影响小。"),
        "us": ("medium", "Retailers and consumer discretionary react most.", "零售与可选消费板块反应最大。"),
        "japan": ("low", "Minor; matters for exporters to the US (autos, electronics).", "影响小；对美出口商（汽车、电子）有一定影响。"),
        "china": ("medium", "US consumer demand matters for Chinese exporters and e-commerce names selling to the US.", "美国消费需求影响中国出口企业及面向美国的跨境电商。"),
    },
    "gdp": {
        "gold": ("low", "Negative print → recession fears → gold supported.", "负增长 → 衰退担忧 → 支撑黄金。"),
        "btc": ("low", "Minor; follows risk sentiment.", "影响小；跟随风险情绪。"),
        "us": ("medium", "Usually overshadowed by same-week earnings unless there's a big miss.", "除非大幅不及预期，通常被同周财报掩盖。"),
        "japan": ("low", "Minor.", "影响小。"),
        "china": ("low", "Minor; a US slowdown is negative for Chinese exports.", "影响小；美国放缓对中国出口不利。"),
    },
    "umich": {
        "gold": ("low", "A jump in inflation expectations can lift gold as an inflation hedge.", "通胀预期跳升可能推高黄金的抗通胀需求。"),
        "btc": ("low", "Minor.", "影响小。"),
        "us": ("low", "Small unless inflation expectations jump.", "除非通胀预期跳升，否则影响小。"),
        "japan": ("low", "Minor.", "影响小。"),
        "china": ("low", "Minor.", "影响小。"),
    },
    "opex": {
        "gold": ("low", "No direct link.", "无直接关联。"),
        "btc": ("low", "Indirect; IBIT/ETF options expire too, and Deribit monthly expiry is usually the last Friday.", "间接影响；比特币ETF期权同日到期，Deribit月度交割通常在月末周五。"),
        "us": ("medium", "Pinning near big strikes; volatility can expand after dealer hedges roll off.", "价格易被大额行权价“钉住”；做市商对冲到期后波动可能放大。"),
        "japan": ("low", "Minor; Japan's own SQ (options settlement) is the second Friday.", "影响小；日本自身的SQ结算在每月第二个周五。"),
        "china": ("low", "No direct link.", "无直接关联。"),
    },
    "earnings_banks": {
        "gold": ("low", "Credit-stress signals could add safe-haven demand.", "若显示信贷压力，可能增加避险需求。"),
        "btc": ("low", "Minor.", "影响小。"),
        "us": ("medium", "Financials react most; CEO macro commentary sets the season's tone.", "金融股反应最大；CEO对宏观的表态定调整个财报季。"),
        "japan": ("low", "Japanese megabanks track US bank sentiment and US yields.", "日本大型银行股跟随美国银行情绪和美债利率。"),
        "china": ("low", "Limited direct impact.", "直接影响有限。"),
    },
    "earnings_megacap": {
        "gold": ("low", "No direct link.", "无直接关联。"),
        "btc": ("medium", "BTC is correlated with the Nasdaq; a big tech sell-off often drags crypto.", "BTC与纳指相关；科技股大跌常拖累加密货币。"),
        "us": ("high", "About a quarter of S&P 500 weight; drives the whole index and the AI trade.", "约占标普500四分之一权重；驱动指数与AI主题。"),
        "japan": ("high", "AI capex guidance moves Japanese chip-equipment and AI names (Tokyo Electron, Advantest, SoftBank Group), which are heavy in the Nikkei.", "AI资本开支指引影响日本半导体设备和AI相关股（东京电子、爱德万、软银集团），这些在日经中权重较大。"),
        "china": ("medium", "Moves Hong Kong tech sentiment (Tencent, Alibaba) and the AI theme; cloud and capex trends are read across to Chinese hyperscalers.", "影响港股科技情绪（腾讯、阿里）和AI主题；云业务与资本开支趋势会被类比至中国云厂商。"),
    },
    "earnings_nvda": {
        "gold": ("low", "No direct link.", "无直接关联。"),
        "btc": ("medium", "Moves with Nasdaq risk sentiment; AI-related crypto tokens and miners (AI data-center hosts) react more.", "随纳指风险情绪波动；AI相关代币及转型AI数据中心的矿企反应更大。"),
        "us": ("high", "Semiconductors and the Nasdaq often move ±1–2% the next day.", "次日半导体和纳指常波动±1–2%。"),
        "japan": ("high", "Strong read-across to Advantest, Tokyo Electron, SoftBank Group and other AI-supply-chain names.", "对爱德万、东京电子、软银集团等AI供应链公司传导效应强。"),
        "china": ("medium", "China and export-control commentary moves Chinese AI-chip names (e.g., SMIC, Cambricon). Strong AI demand lifts the Asian supply chain.", "关于中国市场及出口管制的表态影响中国AI芯片股（如中芯国际、寒武纪）；AI需求强劲带动亚洲供应链。"),
    },
    "jackson_hole": {
        "gold": ("high", "A pivot signal can trigger a big gold rally; a hawkish framework pushes it lower.", "转向信号可能引发黄金大涨；鹰派框架则压低金价。"),
        "btc": ("high", "Big liquidity event for crypto; dovish speeches have triggered sharp BTC rallies.", "加密市场的重大流动性事件；鸽派讲话曾引发BTC大涨。"),
        "us": ("high", "S&P 500 ±1–3% on the speech day.", "讲话当日标普500波动±1–3%。"),
        "japan": ("high", "Large USD/JPY move; the BOJ governor often attends, so watch for policy-divergence signals.", "美元/日元大幅波动；日本央行行长常出席，关注政策分化信号。"),
        "china": ("medium", "A shift in the Fed path affects the dollar, CNH and Hong Kong liquidity.", "美联储路径变化影响美元、人民币和香港流动性。"),
    },
    "refunding": {
        "gold": ("low", "Higher long-end yields are a mild headwind; fiscal-deficit worries can support gold over time.", "长端利率上升形成小幅阻力；财政赤字担忧长期利好黄金。"),
        "btc": ("low", "Minor; Treasury liquidity (TGA) changes matter more over weeks.", "影响小；财政部现金账户（TGA）变化在数周维度更重要。"),
        "us": ("medium", "Through 10-year yields and term premium.", "通过10年期利率和期限溢价传导。"),
        "japan": ("medium", "US long-end yields move JGBs and USD/JPY; Japanese investors are the largest foreign holders of Treasuries.", "美债长端利率影响日债和美元/日元；日本是美债最大海外持有者。"),
        "china": ("low", "Limited direct impact.", "直接影响有限。"),
    },
    "election": {
        "gold": ("medium", "Uncertainty or a contested result supports gold; a clear result can see safe-haven demand fade.", "不确定或结果争议支撑黄金；结果明朗后避险需求可能减退。"),
        "btc": ("high", "Very sensitive to crypto-regulation outlook (e.g., BTC rose ~45% in the month after the Nov 2024 election).", "对加密监管前景高度敏感（如2024年11月大选后一个月BTC上涨约45%）。"),
        "us": ("high", "Sector rotation by policy winners/losers; relief rally if the outcome is clear.", "按政策受益/受损进行板块轮动；结果明确时出现释放性上涨。"),
        "japan": ("medium", "Trade and tariff policy affects Japanese autos and exporters; USD/JPY reacts to fiscal outlook.", "贸易与关税政策影响日本汽车与出口股；美元/日元反映财政前景。"),
        "china": ("high", "Tariff, export-control and technology-restriction expectations drive Chinese and Hong Kong stocks and the yuan.", "关税、出口管制和科技限制预期驱动A股、港股和人民币。"),
    },
    "russell_recon": {
        "gold": ("low", "No direct link.", "无直接关联。"),
        "btc": ("low", "Crypto-related small caps can see large index flows.", "加密相关小盘股可能有较大指数资金流动。"),
        "us": ("low", "Big closing-auction volume, little index direction.", "收盘集合竞价成交量巨大，指数方向性有限。"),
        "japan": ("low", "No direct link.", "无直接关联。"),
        "china": ("low", "No direct link.", "无直接关联。"),
    },
    "quarter_end": {
        "gold": ("low", "Possible portfolio rebalancing flows.", "可能有组合再平衡资金流动。"),
        "btc": ("low", "Quarterly futures/options expiry on Deribit and CME around the last Friday adds volatility.", "Deribit和CME季度合约在月末周五前后到期，增加波动。"),
        "us": ("medium", "Pension rebalancing flows; direction depends on quarter-to-date performance.", "养老金再平衡资金流；方向取决于季度内表现。"),
        "japan": ("medium", "Japan's fiscal year ends in March; March and September quarter-ends bring large repatriation and rebalancing flows.", "日本财年3月结束；3月和9月季末常有大规模资金回流和再平衡。"),
        "china": ("low", "Quarter-end liquidity in China's interbank market can tighten.", "中国银行间市场季末流动性可能趋紧。"),
    },
    "holiday": {
        "gold": ("low", "Trades with thin liquidity.", "流动性稀薄地交易。"),
        "btc": ("low", "Keeps trading 24/7, often with thin liquidity and exaggerated moves.", "继续24/7交易，流动性薄、波动可能放大。"),
        "us": ("low", "US cash market closed.", "美股现货市场休市。"),
        "japan": ("low", "Tokyo trades normally (unless also a Japanese holiday) but with lower volume without US direction.", "东京正常交易（除非同为日本假日），缺乏美股指引时成交较淡。"),
        "china": ("low", "Mainland and Hong Kong trade normally unless on their own holiday; Stock Connect may be limited.", "除各自假日外，A股和港股正常交易；互联互通可能受限。"),
    },
    "early_close": {
        "gold": ("low", "Thin liquidity.", "流动性稀薄。"),
        "btc": ("low", "Thin liquidity.", "流动性稀薄。"),
        "us": ("low", "Half-day session, low volume.", "半日交易，成交清淡。"),
        "japan": ("low", "No direct effect.", "无直接影响。"),
        "china": ("low", "No direct effect.", "无直接影响。"),
    },
}
M["fomc_sep"] = M["fomc"]
M["quad_witching"] = M["opex"]


def markets_for(event_type: str, lang: str) -> list[dict]:
    entries = M.get(event_type)
    if not entries:
        return []
    idx = 1 if lang == "en" else 2
    return [{"key": k, "name": MARKET_NAMES[lang][k], "level": entries[k][0], "text": entries[k][idx]}
            for k in MARKET_KEYS]
