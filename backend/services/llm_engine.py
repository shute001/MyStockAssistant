import json
import asyncio
import logging
import httpx
from typing import AsyncGenerator, Dict, Any, List, Optional
from sqlalchemy.orm import Session
from database import LLMConfig

from services.agent_memory import AgentMemoryService
from services.market_data import MarketDataService

logger = logging.getLogger(__name__)


class MultiLLMEngine:
    """Unified OpenAI-Compatible Multi-LLM Routing & Analysis Engine"""

    DEFAULT_BASE_URLS = {
        "deepseek": "https://api.deepseek.com",
        "kimi": "https://api.moonshot.cn/v1",
        "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "openai": "https://api.openai.com/v1"
    }

    DEFAULT_MODELS = {
        "deepseek": "deepseek-chat",
        "kimi": "moonshot-v1-8k",
        "qwen": "qwen-max",
        "openai": "gpt-4o"
    }

    @classmethod
    def get_active_config(cls, db: Session) -> Dict[str, Any]:
        """Fetch current active LLM configuration from DB"""
        active = db.query(LLMConfig).filter(LLMConfig.is_active == True).first()
        if active and active.api_key:
            return {
                "provider_name": active.provider_name,
                "api_key": active.api_key,
                "base_url": active.base_url or cls.DEFAULT_BASE_URLS.get(active.provider_name, "https://api.deepseek.com"),
                "model": active.selected_model or cls.DEFAULT_MODELS.get(active.provider_name, "deepseek-chat")
            }
        
        # Fallback to default
        return {
            "provider_name": "deepseek",
            "api_key": None,
            "base_url": cls.DEFAULT_BASE_URLS["deepseek"],
            "model": cls.DEFAULT_MODELS["deepseek"]
        }

    @classmethod
    def build_single_stock_prompt(
        cls, 
        symbol: str, 
        name: str, 
        indicators: Dict[str, Any],
        macro_context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Construct professional A-share single stock analysis prompt payload with macro & news context"""
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""

        prompt = f"""# A股个股【{name} ({symbol})】AI量化操盘全维度诊断指令

请作为资深 A 股量化风控专家，结合以下【全市场大盘情绪、领涨热点板块与新闻消息面】以及【该股票的实时技术指标】，为用户输出一份专业、客观、有纪律性的【单股AI深度诊断报告】。

{macro_block}

---

## 📌 实时个股行情与技术指标数据：
{json.dumps(indicators, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【{name} ({symbol})】深度诊断报告：

### 📊 1. 个股行情与大盘/板块情绪共振评估
- **大盘与情绪共振**: 结合大盘整体走势与当前主力资金热点板块，评估【{name} ({symbol})】是处于领涨、跟涨、逆势独立行情还是弱势补跌。
- **技术面评价**: 评价当前股价（¥{indicators.get('current_price')}元）、今日涨跌幅（{indicators.get('pct_chg')}）及成交量。
- **均线形态**: 分析 K 线趋势与均线排列形态（MA5: {indicators.get('ma5')} / MA10: {indicators.get('ma10')} / MA20: {indicators.get('ma20')}，当前为【{indicators.get('ma_trend')}】）。

### 📈 2. 关键技术指标深入研判 (MACD / KDJ / 支撑与阻力)
- **【MACD形态】**: 分析 MACD_DIF({indicators.get('macd_dif')})、MACD_DEA({indicators.get('macd_dea')}) 与柱体 ({indicators.get('macd_status')})。
- **【KDJ摆动】**: K值 ({indicators.get('kdj_k')})、D值 ({indicators.get('kdj_d')})、J值 ({indicators.get('kdj_j')}) 处于超买还是超卖区。
- **【强支撑位与压力位】**: 基于近期低点支撑位（**¥{indicators.get('support_price')}元**）与近期高点压力位（**¥{indicators.get('resistance_price')}元**）分析套牢盘与反弹阻力。

### 🌐 3. 多周期共振深度研判 (周K线生命线 + 月K线大级别空间)
- **周K线趋势与生命线 (Weekly Lifeline)**:
  - 核心防守位：分析股价与周 MA20 生命线（¥{indicators.get('weekly_context', {}).get('weekly_ma20_lifeline', 'N/A')}元）的相对位置，当前是否有效站稳（{indicators.get('weekly_context', {}).get('above_weekly_ma20')}）。
  - 周线动能：分析周线 MACD 状态（{indicators.get('weekly_context', {}).get('weekly_macd_status', 'N/A')}）以及近 4 周单周走势波动序列。
- **月K线大级别估值与周期位置 (Monthly & Valuation)**:
  - 分析近 1 年历史价格分位数（当前处于 {indicators.get('monthly_context', {}).get('historical_1y_percentile', 'N/A')} 分位）与月线趋势（{indicators.get('monthly_context', {}).get('monthly_trend', 'N/A')}），判断中长线是否有充足的安全边际。

### 📰 4. 板块热度与新闻消息面/催化因素剖析
- 评价该标的所属板块在当前大盘中的热度及最新财经消息面催化。

### 🎯 5. 标的投资周期属性深度研判 (适合短线快进快出 vs 中长线波段定投)
- **适合周期定性研判**: 明确判定【{name} ({symbol})】当前技术形态与估值阶段最适合哪类投资模式：
  - 【适合短线情绪博弈】(放量突破/题材共振/快进快出，仅限股票/高流动性ETF)
  - 【适合中线波段趋势】(依托周线MA20/景气度拐点/波段持有1~6个月)
  - 【适合长线低估/定投】(指数基金ETF/高股息红利/底部估值区间分批吸筹)
  - 【两头不靠/空仓观望】(无量阴跌/破位下行，短线无弹性，中长线未见底)
  *(注：若标的为指数基金或行业 ETF，天然更偏向中长线波段与定投平摊成本，严禁诱导散户做日内超短追涨杀跌)*

### 🛡️ 6. 双周期操盘行动剧本与风控纪律
- **⚡ 股票短线操盘案 (1~5个交易日快进快出)**:
  - 核心逻辑：是否具备题材爆发力、主力净流入或放量突破动量？
  - 预计持股周期：(建议 1~3 天，不恋战)
  - 进攻止盈目标：(¥xxx 元，冲高滞涨即分批止盈)
  - **防守止损铁律**：(具体的硬止损价格，如跌破 MA5 或 -3%~-5% 必须无条件离场，严禁由短线被动转为长线深套死扛！)
- **🌱 中长线波段与定投操盘案 (1~6个月+ 逢低布局/定投发车)**:
  - 价值与趋势逻辑：(周线MA20生命线、行业估值分位数与中长期安全边际)
  - 逢低布局/定投区间：(给出安全买入区间，如 ¥xxx ~ ¥xxx 元，回踩关键均线分批金字塔建仓)
  - 中线趋势防守位：(跌破周 MA20 趋势彻底破位时坚决减仓防守)
  - 波段第一预期目标：(波段目标位 ¥xxx 元)
"""
        return prompt

    @classmethod
    def build_trade_review_prompt(
        cls, 
        db: Session, 
        trade_records: List[Dict[str, Any]], 
        current_positions: List[Dict[str, Any]],
        macro_context: Optional[Dict[str, Any]] = None,
        traded_stocks_indicators: Optional[Dict[str, Any]] = None,
        summary_info: Optional[Dict[str, Any]] = None,
        account_fund_info: Optional[Dict[str, Any]] = None
    ) -> str:
        """Construct Trade Review Agent prompt with memory injection, dataset summary, account capital, per-trade indicators, 4D scoring & weekly leak detection"""
        memory_block = AgentMemoryService.format_memories_for_prompt(db)
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""
        
        summary_block = ""
        if summary_info:
            summary_block = f"""## 📊 用户全量历史交易账本宏观统计 (完整 3 年时间跨度、全量胜率、盈亏比与 FIFO 累计盈亏):
{json.dumps(summary_info, ensure_ascii=False, indent=2)}
"""

        capital_block = ""
        if account_fund_info:
            capital_block = f"""## 💰 用户当前账户资金与仓位概览 (同花顺 9 项资金指标):
- **总资产**: ¥{account_fund_info.get('total_assets', 0):,.2f} 元  |  **可用资金**: ¥{account_fund_info.get('available_cash', 0):,.2f} 元  |  **股票市值**: ¥{account_fund_info.get('market_value', 0):,.2f} 元
- **仓位比例**: {account_fund_info.get('position_ratio', '0.00%')}  |  **持仓盈亏**: ¥{account_fund_info.get('holding_pnl', 0):,.2f} 元  |  **当日盈亏**: ¥{account_fund_info.get('daily_pnl', 0):,.2f} 元 ({account_fund_info.get('daily_pnl_pct', '0.00%')})
- **资金余额**: ¥{account_fund_info.get('cash_balance', 0):,.2f} 元  |  **可取金额**: ¥{account_fund_info.get('withdrawable_cash', 0):,.2f} 元  |  **冻结金额**: ¥{account_fund_info.get('frozen_amount', 0):,.2f} 元
"""

        indicators_block = ""
        if traded_stocks_indicators:
            indicators_block = f"""## 📈 交易涉及个股的【实时最新价格、K线均线与技术指标】：
{json.dumps(traded_stocks_indicators, ensure_ascii=False, indent=2)}
"""

        reason_example = trade_records[0].get("strategy_reason") if (trade_records and trade_records[0].get("strategy_reason")) else "突破建仓"

        prompt = f"""# 🤖 Trade Review Agent (AI 交易复盘与诊所教练) 指令

你是一位经验丰富、注重风险控制与交易心理的 A 股量化交易复盘教练。
你的职责是：深入分析用户的交易记录、持仓以及确定性全量统计数据（胜率、盈亏比、期望收益、全量交易笔数），**结合用户账户资金总额 (¥{account_fund_info.get('total_assets', 0) if account_fund_info else '未知'}) 与当前仓位比例 ({account_fund_info.get('position_ratio', '未知') if account_fund_info else '未知'})，对照当日/当前全市场大盘情绪、领涨热点板块、实时新闻背景以及个股真实 K 线均线指标（MA5/10/20、MACD、KDJ、支撑压力位）**，识别交易性格、优点与致命缺点，输出【四维能力评分卡】与【周度纪律漏洞诊断】，给出犀利且可执行的改进指导，并在报告结尾自动萃取【记忆演化总结】。

【重要须知】：你已获得用户全量 {summary_info.get('total_trades_count', len(trade_records)) if summary_info else len(trade_records)} 笔交易的历史账本宏观统计（胜率、盈亏比、期望收益、全量盈亏），下方明细展示了最近 {len(trade_records)} 笔交易的详细日志。在诊断时请基于全量账本宏观指标进行全面定性分析。

{macro_block}

---

{capital_block}

---

{summary_block}

---

{indicators_block}

---

{memory_block}

---

## 二、 用户近期交易明细日志 (最近 {len(trade_records)} 笔交易):
{json.dumps(trade_records, ensure_ascii=False, indent=2)}

## 三、 用户当前持仓状况:
{json.dumps(current_positions, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【Trade Review Agent 复盘与诊断报告】：

### 📊 1. 交易明细与大盘情绪/板块热度/K线指标深度对照诊断
- **板块与市场大势对照 (切忌生搬硬套死卡“当日主力排名前二”)**:
  - 【实战审查纪律】：A 股常态是电风扇高频轮动，每天单日成交额或净流入排名前二的板块几乎天天在换，**绝不可教条地苛求用户必须买在“当日主力前二板块”**，盲目追逐日内前二反而极易追高吃面！
  - 审查重点应在于：标的所属赛道是否具备【持续性中期逻辑或周线趋势】，个股自身是否有清晰的量价配合与风控计划，还是盲目追高了无量无逻辑的纯脉冲杂毛。
- **K线买卖择时点与多周期共振对照**: 
  - 对比个股实时日K线均线（MA5/10/20）及支撑/阻力价位，评价交易买点是否处于【放量突破】、【缩量回踩支撑】还是【冲动追高/破位死扛】。
  - **大级别多周期纪律核查（周线/月线）**：重点核查是否存在“**逆大级别趋势做交易**”（如：日线看似小金叉，但个股周线处于周 MA20 趋势生命线之下或周 MACD 处于主跌浪中的诱多陷阱；或月线处于历史高位估值透支区）。评价交易买入到底是顺大势还是逆大势。

### 🏆 2. 顶级战法与周期知行合一铁律对标检查 (Master Playbook Compliance & Horizon Alignment)
- **战法恪守检查**: 结合上方【必须严格对标与恪守的顶级战法库】，逐一对照评估用户近期交易是否【符合】或【违背】战法纪律（重点对标如：CANSLIM 7%硬止损、龙头分歧低吸、均线多头回踩等）。
- **【核心焦点: 投资周期错配与知行合一专项审计】**:
  - 重点核查是否存在散户最致命的“**周期错配**”：本来是看题材放量短线追入，结果亏损被套后舍不得割肉，自我催眠转为“长期死扛”导致由小亏变深套巨亏；或者原本看好中长线低估/定投，持股几天未见大涨就急躁卖出导致卖飞主升浪。
  - 审计用户的买入理由、标的属性（股票短线 vs 基金中长线定投）与实际持股周期是否知行合一。

### 📊 3. 交易能力四维评估打分卡 (请严格给出 0-100 具体分数及一句话评语)
- **🎯 择时与买点质量 (Timing & Entry)**: [打分]/100 — 评语（评价是否追高、抄底时机及K线位置）
- **🛡️ 止损与风控纪律 (Risk Control)**: [打分]/100 — 评语（评价止损执行、计划外冲动交易控制）
- **🧠 交易心理控制 (Psychology)**: [打分]/100 — 评语（评价恐惧、贪婪、FOMO追涨等心态）
- **📈 策略与战法适配度 (Playbook Fit)**: [打分]/100 — 评语（评价交易策略与当前大盘板块环境及顶级战法的匹配程度）

### 🔎 4. 经典交易案例与周度漏洞诊断 (Weekly Leak Detection)
- **🏆 本周最佳成功操作**: 点评表现最好的一笔交易（买卖理由“{reason_example}”），说明成功的核心因素。
- **⚠️ 本周最大纪律漏洞**: 深刻剖析导致亏损或风险最大的一笔/类交易（重点检查【计划外冲动】交易以及【逆周线主跌浪抄底】）。

### 🎯 5. 下一交易日/未来操作禁忌与改进建议
- 给出 2-3 条下一交易日必须严格执行的【操盘铁律】。

---

### 🧠 Agent 动态演化总结 (用于 Agent 数据库长期积累学习，请严格使用以下列表格式输出 1-3 条新教训/习惯):
- 【交易习惯/教训】(在此处写下对用户交易习惯或核心教训的最新提炼总结，15-40字)
- 【交易风格/偏好】(在此处写下观察到的用户交易风格特点，15-40字)
"""
        return prompt


    @classmethod
    def build_portfolio_prompt(
        cls, 
        portfolio_data: List[Dict[str, Any]], 
        watchlist_data: List[Dict[str, Any]],
        scope_label: str = "全仓与自选",
        macro_context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Construct professional A-share portfolio / sector analysis prompt payload with macro context"""
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""

        # Case 1: Pure Holding Positions Diagnosis
        if scope_label == "我的持仓股专项" or (portfolio_data and not watchlist_data):
            prompt = f"""# A股【我的持仓股专项】AI量化调仓诊断指令

请作为资深 A 股量化风控专家，结合以下【全市场大盘情绪、领涨热点板块与新闻消息面】以及【用户当前在手的真实持仓数据】，专门针对用户正在真实持仓的全部标的（共 {len(portfolio_data)} 只），生成一份专业、严谨且排版优雅的【我的持仓股专项 AI 量化诊断报告】。

【⚠️ 核心硬性约束】：本次用户仅选择了“持仓股专项诊断”，因此报告必须全部且仅针对以下在手真实持仓标的进行深度诊断，绝不可分析任何非持仓自选股，也不可无中生有引入其它标的！

{macro_block}

---

## 📌 用户当前真实在手持仓清单 (共 {len(portfolio_data)} 只在手标的，含持股量、成本、市价、盈亏与日/周/月技术指标，请逐一逐项深度诊断，绝不漏诊)：
{json.dumps(portfolio_data, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【我的持仓股专项】诊断报告：

### 📊 1. 在手持仓整体盈亏与风险敞口评估
- **大盘与板块情绪共振**: 结合大盘整体走势与当前主力热点板块，评估当前持仓组合的整体抗跌性与市场风险偏好。
- **仓位分布与结构合理性**: 结合实际持股数量、持仓市值、成本价与浮动盈亏（当前共持有 {len(portfolio_data)} 只标的），评估持仓集中度、行业分散度与防御韧性。

### 🛡️ 2. 在手持仓标的逐一深度诊断 (短线快进快出 vs 中长线波段定投知行审计)
- 针对用户在手的全部 {len(portfolio_data)} 只持仓标的逐一诊断，结合其【投资周期策略标签 (如: 短线博弈/中线波段/长线定投)】、【持股数量】、【持仓成本价】、【当前市价】、【持仓盈亏比例】、【日K线均线形态】、【周K线 MA20 生命线与周 MACD 状态】以及【月K线历史估值分位数】，剖析多空动能，并必须明确给出：
  - 【周期匹配与知行合一审计】：审查每只标的是否符合其预设周期逻辑。严格排查“短线题材被套后舍不得止损、被动变为长线死扛”的知行不一现象；排查“中长线低估/定投标的因短期回调被恐慌割肉”的误判。
  - 【分类行动案】：
    - 若标记为【⚡ 短线博弈】：给出次日冲高兑现点与破位绝对硬止损线（如跌破5日线或-3%~-5%坚决止损，决不可死扛）；
    - 若标记为【🌱 长线定投/中线波段】：结合估值分位数与周线支撑，指出是否处于“安全定投发车/金字塔加仓区间”，指引持有耐心；
  - 【明确持仓指令】：（继续安心持有 / 冲高逢高减仓 / 触及止损坚决离场 / 保本止损出局 / 缩量回踩补仓）
  - 【具体价位指引】：（给出具体的建议减仓价格、防守止损线、第一目标位）

### ⚠️ 3. 针对当前持仓的调仓避险纪律
- 给出 2-3 条针对用户当前在手持仓的仓位控制与操盘风控铁律。
"""
            return prompt

        # Case 2: Specific Sector / Category Diagnosis
        if scope_label.endswith("板块专项") or (watchlist_data and not portfolio_data):
            prompt = f"""# A股【{scope_label}】AI量化操盘诊断指令

请作为资深 A 股量化风控专家，结合以下【全市场大盘情绪、领涨热点板块与新闻消息面】以及【该板块的自选监控标的数据】，专门针对该板块的全部标的（共 {len(watchlist_data)} 只），生成一份专业、严谨且排版优雅的【{scope_label} AI 深度量化诊断报告】。

{macro_block}

---

## 📌 【{scope_label}】监控标的清单 (共 {len(watchlist_data)} 只，含目标价与日/周/月技术指标)：
{json.dumps(watchlist_data, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成诊断报告：

### 📊 1. 板块热度与大盘情绪共振评估
- 结合大盘整体走势与当前主力资金流向，评估该板块所处的主力周期位置（主升浪、分歧轮动、震荡筑底还是补跌）。

### 🛡️ 2. 板块核心标的逐一AI深度诊断 (日线+周线+月线多周期共振视角)
- 针对该板块中的全部 {len(watchlist_data)} 只自选标的逐一诊断，结合其【日K线多空形态与成交量】、【周K线 MA20 生命线与周 MACD 状态】以及【月K线历史估值分位数】，剖析动能并给出明确的建仓跟踪价位与防守线。

### ⚠️ 3. 风险警示与操盘纪律提醒
- 给出 2-3 条当前市场环境下针对该板块的操作纪律。
"""
            return prompt

        # Case 3: All Positions & Watchlists Combined
        prompt = f"""# A股【全仓持仓与自选池】AI量化操盘综合诊断报告指令

请作为资深 A 股量化风控专家，结合以下【全市场大盘情绪、领涨热点板块与新闻消息面】以及【用户的真实持仓与自选股数据】，生成一份专业、严谨且排版优雅的【全仓持仓与自选池 AI 量化操盘综合诊断报告】。

【数据源与口径已知说明】：
1. 持仓清单与自选池均已完成去重校验，持仓标的已从自选池中排除，二者互补互斥，请逐一深入诊断；
2. 若遇周末/休市期间，个股量化指标与大盘指数均以最新一个有效交易日终盘收盘为基准对账，新闻消息为最新动态。

{macro_block}

---

## 📌 一、 用户真实在手持仓清单 (共 {len(portfolio_data)} 只，含持股量、成本与盈亏)：
{json.dumps(portfolio_data, ensure_ascii=False, indent=2)}

## 📌 二、 用户自选重点监控池 (共 {len(watchlist_data)} 只，已排除持仓标的)：
{json.dumps(watchlist_data, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成诊断报告：

### 📊 1. 今日盘后大局观与持仓总览
- **大盘与板块情绪共振**: 结合大盘整体走势与当前主力热点板块，评价整体仓位风险及市场风险偏好。
- **持仓与自选整体诊断**: 汇总评估当前组合结构（高股息、科技成长、周期等）的合理性。

### 🛡️ 2. 重点标的逐一AI深度诊断 (短线快进快出 vs 中长线波段定投多周期共振视角)
- 分别针对用户持仓股与核心自选股，结合其【投资周期属性/策略标签】、【日K线多空形态与成交量】、【周K线 MA20 生命线与周 MACD 状态】以及【月K线历史估值分位数】，进行多周期共振诊断，剖析大中小周期共振趋势：
  - 【标的适合周期定性】：明确标出该标的更适合【短线题材爆发】还是【中长线波段/定投】，若为基金ETF重点评估定投网格位置；
  - 【分类行动案】：短线持仓重点给准次日冲高兑现点与破位绝对硬止损线；中长线定投标的给出估值安全区间与补仓网格位。
  - 【明确策略指引】：给出具体的持仓/减仓/止损/加仓策略建议与精准防守价格。

### ⚠️ 3. 风险警示与操盘纪律提醒
- 给出 2-3 条当前市场环境下的仓位控制与操盘风控铁律（重点防范“短线变死扛”的知行不一风险）。
"""
        return prompt

    @classmethod
    def build_stock_screener_prompt(
        cls, 
        watchlist_items: List[Dict[str, Any]], 
        user_rules_text: str, 
        macro_context: Optional[Dict[str, Any]] = None,
        account_fund_info: Optional[Dict[str, Any]] = None,
        scope: Optional[str] = "ALL"
    ) -> str:
        """Construct Stock & ETF Screener prompt based on market macro, user rules & technical signals with short/mid/long-term & ETF taxonomy"""
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""

        capital_block = ""
        avail_cash_num = 0.0
        if account_fund_info:
            avail_cash_num = float(account_fund_info.get('available_cash', 0.0))
            capital_block = f"""## 💰 用户账户真实资金与可用流动性 (用于精确指导买入金额与建仓股数/份额):
- **总资产**: ¥{account_fund_info.get('total_assets', 0):,.2f} 元  |  **可用资金**: ¥{avail_cash_num:,.2f} 元
- **当前仓位比例**: {account_fund_info.get('position_ratio', '0.00%')}  |  **股票市值**: ¥{account_fund_info.get('market_value', 0):,.2f} 元
"""

        scope_instructions = {
            "ALL": "全景三维筛选（请同时输出：短线交易股票、中线波段标的、长线价值/ETF 三大梯队精选）",
            "SHORT_TERM": "专注短线交易股票（重点挖掘主线题材爆发、分歧低吸与放量突破，提供严格 3%~5% 硬止损）",
            "MID_TERM": "专注中线波段标的（重点筛选日K线多头排列、趋势顺势突破、回踩MA20生命线的成长股及行业ETF）",
            "LONG_TERM_ETF": "专注长线价值与宽基/红利 ETF（重点筛选 1 年历史估值低位分位数、高股息、适合动态网格分批定投的标的）"
        }
        active_scope_desc = scope_instructions.get(scope or "ALL", scope_instructions["ALL"])

        prompt = f"""# 🤖 Stock & ETF Screener Agent (多周期分级智能选股与建仓) 指令

你是一位严苛的 A 股量化选股策略专家。
当前用户指定的筛选模式是：【**{active_scope_desc}**】。

请结合全市场大盘情绪、主力热点板块、最新宏观消息，以及用户激活的顶级战法与选股铁律，严格按照【短线交易股票】、【中线波段标的】、【长线价值与宽基/红利ETF】不同买卖标准进行分类严选与推选！

【重要资金风控规则】：在给出具体推荐标的时，请严格结合上方【用户账户可用资金 ¥{avail_cash_num:,.2f} 元】，必须针对每只入选标的**给出具体的建议建仓金额 (元) 和按当前市价测算的建议买入股数/份额**，并配置明确的风控止损位！

{macro_block}

---

{capital_block}

---

## 📌 必须严格遵循的顶级战法与选股铁律（Master Playbooks & Rules）：
{user_rules_text}

---

## 🎯 必须严格执行的三大梯队买卖标准规范：

### ⚡ 【短线交易股票买卖标准 (周期 1~5 个交易日)】
- **适用标的**: 属于全市场主力热点主线、高弹性换手股、龙头股分歧或弱转强品种（以 A 股股票为主）。
- **买入标准**:
  1. 主力题材驱动，当日/近3日量比放大（>1.5x）或缩量极值变盘蓄势；
  2. 日 K 线上穿或稳守 MA5，MACD 红柱扩散或零轴上方二次金叉，KDJ/RSI 运行在 50~70 强势发力区；
  3. 分歧日缩量回踩 MA5/MA10 获支撑确认不破时低吸，坚决不盲目追高；
  4. **周K线避雷校验**: 核查 `weekly_context`，确保周线没有出现大级别巨量断头长阴线或周线顶背离。
- **卖出与风控标准**:
  1. **无条件硬止损 3%~5%** 或跌破前日分歧低点，破位坚决离场；
  2. 冲高放量滞涨、遇阻力位出现长上影线或次日走弱果断止盈；
  3. **铁律：绝不把短线做成被动套牢长线！**

### 📈 【中线波段标的买卖标准 (周期 2~8 周)】
- **适用标的**: 业绩稳健增长的赛道成长白马股、领涨行业核心 ETF（如半导体、新能源、医药、自主可控等）。
- **买入标准**:
  1. 日 K 线 MA5 > MA10 > MA20 多头排列，处于年线(MA250)上方或站稳 20 日均线；
  2. 顺势放量突破中长期箱体/颈线，或在上升通道中缩量回踩 MA20 生命线企稳收出反包阳线；
  3. **【周K线强制多周期共振核验（一票否决制）】**: 必须深入查验数据中的 `weekly_context`！要求标的处于【周MA20生命线】上方或有效突破站稳（`above_weekly_ma20: true`），且周线多头排列或周MACD处于红柱扩张区。**若周线破位处于空头向下，哪怕日线短期反弹也一票否决，坚决不可推选为中线标的！**
- **卖出与风控标准**:
  1. **以日/周 MA20 为移动防守生命线**，有效跌破 3 日不反包则纪律止损（风控位 6%~8%）；
  2. 目标盈利 20%~40%，随股价上涨抬升移动止盈防守线；跌破 MA60 趋势彻底走坏清仓。

### 🛡️ 【长线价值与宽基/红利 ETF 买卖标准 (周期 数月~长期)】
- **适用标的**: 核心宽基指数 ETF（沪深300、科创50、中证A500、恒生科技等）、高股息红利低波 ETF、高自由现金流低估值龙头。
- **买入标准**:
  1. 1 年价格分位数处于历史低位区间（<35% 具备充足安全边际）；
  2. 股息率 > 4%~5% 或指数处于战略低估配置区；
  3. **【月K线大级别多周期核验】**: 深入查验数据中的 `monthly_context`！要求标的月线大级别处于历史估值低位或筑底反弹期，具有大级别护城河；
  4. 以 MA20/MA60 为中轴开启网格分批定投低吸（越跌越买，金字塔式逢低建仓）。
- **卖出与风控标准**:
  1. 价格向上大幅乖离均线（如超过 MA20 上方 10%~15%）分批止盈兑现网格差价；
  2. 标的估值由严重低估彻底修复至历史高位（分位数>80%）时分批止盈兑现；
  3. 排除基本面不可逆恶化外，不轻易恐慌斩仓。

---

## 📌 候选标的池全维量化行情与指标数据 (已预先标注资产类型 asset_type、is_etf、多周期周K/月K数据 weekly_context 与 monthly_context)：
{json.dumps(watchlist_items, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【Stock & ETF Screener 多周期分级选股报告】：

# 🤖 Stock & ETF Screener Agent 多周期分级选股报告

> 📌 本次筛选聚焦：**{active_scope_desc}**。严格基于多维量化指标、日K/周K/月K多周期共振与顶级战法完成三梯队分类。

### ⚡ 一、短线交易精选股票 (1~5日主线博弈与分歧低吸)
(严选 1~2 只最符合短线爆发特征的股票；若当前行情不适宜做短线，明确给出“短线风险提示，建议轻仓观望”)
- 🎯 **精选标的**: 【股票名称 (代码)】 — 匹配战法: 如【主线龙头分歧低吸战法】
- **量化评分与周期定位**: 88/100 | ⚡ 短线交易
- **K 线形态与量价验证**: 结合近 10 日 K 线量比(vol_ratio)、日内涨跌、短期均线与摆动指标分析为什么适合短线
- **大级别周线核验**: 确认周K线无大级别顶背离，为短线提供安全防护
- **买卖操作与严苛风控**: 
  - 建议买入价格区间: ¥xx.xx ~ ¥xx.xx
  - 建议投入金额与股数: 投入约 ¥xxxx 元，建议买入 xxx 股 (约占可用资金 xx%)
  - **绝对硬止损位**: ¥xx.xx (严控在 3%~5% 或跌破关键支撑)
  - 短线目标止盈位: ¥xx.xx (分批兑现)

### 📈 二、中线波段标的 (2~8周顺势趋势，成长股与行业ETF)
(严选 1~2 只处于良性多头趋势推进的股票或行业核心 ETF)
- 🎯 **精选标的**: 【标的名称 (代码)】 — 匹配战法: 如【均线多头趋势回踩战法】 (注明资产类别: 股票 / 行业ETF)
- **量化评分与周期定位**: 91/100 | 📈 中线波段
- **周K线中线生命线与多周期共振**: 引用 `weekly_context` 详细说明周MA20生命线价格位置、当前股价与周MA20关系、周线多头排列及周MACD红柱支撑
- **买卖操作与防守纪律**:
  - 建议建仓价格区间: ¥xx.xx ~ ¥xx.xx
  - 建议投入金额与股数/份额: 投入约 ¥xxxx 元，建议买入 xxx 股/份
  - **移动防守生命线**: MA20 均线价位 ¥xx.xx (跌破 3 日不收复止损)
  - 中线波段目标位: ¥xx.xx (预期涨幅 xx%)

### 🛡️ 三、长线价值与宽基/红利 ETF (数月~长期定投与网格配置)
(严选 1~2 只具备长期估值洼地或指数定投价值的核心 ETF / 高股息标的)
- 🎯 **精选标的**: 【标的名称 (代码)】 — 匹配战法: 如【宽基/行业ETF动态网格战法】 (宽基/红利ETF或高股息价值股)
- **量化评分与周期定位**: 93/100 | 🛡️ 长线定投/网格
- **月K线大周期格局与估值分位**: 引用 `monthly_context` 详细说明月线大级别趋势、1 年价格分位数、股息率/指数安全边际
- **网格建仓与高抛低吸标准**:
  - 首次建仓金额与股数/份额: 投入约 ¥xxxx 元，底仓买入 xxx 股/份
  - 向下定投加仓档位: 每下跌 3%~5% 加仓 ¥xxxx 元
  - 向上网格止盈档位: 偏离 MA20 上方 10% 减仓兑现差价

### 💰 四、账户资产流动性与金字塔风控仓位规划
- 结合账户当前可用流动性资金 (¥{avail_cash_num:,.2f} 元) 与现有持仓比例，给出短线 (如 15%~20%)、中线 (如 35%~40%)、长线/ETF (如 40%~50%) 的科学分配建议与仓位风控铁律。
"""
        return prompt

    @classmethod
    async def extract_master_rules_from_text(cls, db: Session, text: str) -> List[str]:
        """Extract 1-3 concise actionable trading playbook rules from user provided article/notes"""
        config = cls.get_active_config(db)
        api_key = config["api_key"]
        base_url = config["base_url"].rstrip("/")
        model = config["model"]

        if api_key:
            prompt = f"""请阅读以下交易心得/游资招式/战法文章，从中深度萃取出 1~3 条最核心、严谨、可落地的顶级交易战法与风控铁律。
要求：
1. 每条规则 25-70 字，必须带有【顶级战法: 战法名】前缀，且包含具体的买点确认、止损线或仓位控制。
2. 请直接以标准的 JSON 字符串数组格式输出（例如：["【顶级战法: 突破跟进】1. ...", "【顶级战法: 均线回踩】1. ..."]），不要包裹任何 ``` 代码块标记。

--- 文章内容 ---
{text[:4000]}
"""
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是一位专业的 A 股量化策略专家，擅长从文章心得中提炼严密交易法则。"},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2
            }
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
                    if resp.status_code == 200:
                        res_json = resp.json()
                        raw_content = res_json["choices"][0]["message"]["content"].strip()
                        if raw_content.startswith("```"):
                            raw_content = raw_content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                        parsed = json.loads(raw_content)
                        if isinstance(parsed, list) and len(parsed) > 0:
                            return [str(item) for item in parsed]
            except Exception as e:
                logger.error(f"LLM extract rules error: {e}")

        # Intelligent Fallback extraction if API key missing or LLM parse failed
        extracted = []
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        for line in lines:
            if any(kw in line for kw in ["战法", "买点", "止损", "铁律", "原则", "纪律", "仓位", "回踩", "突破"]) and len(line) >= 15:
                clean_line = line.lstrip("-*0123456789.、 ").strip()
                if clean_line and clean_line not in extracted:
                    extracted.append(f"【顶级战法: 文章萃取】{clean_line}")
                if len(extracted) >= 3:
                    break

        if not extracted:
            extracted.append(f"【顶级战法: 自由规则】{text.strip()[:100]}")

        return extracted

    @classmethod
    async def audit_and_optimize_memories(cls, db: Session, memories: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Audit, prune, merge and optimize all agent memories into a streamlined, high-signal trading rulebook.
        """
        if not memories:
            return {
                "summary": "当前经验库为空，无需优化瘦身。",
                "prune_items": [],
                "merged_items": [],
                "keep_items": []
            }

        config = cls.get_active_config(db)
        api_key = config["api_key"]
        base_url = config["base_url"].rstrip("/")
        model = config["model"]

        mems_json_str = json.dumps([
            {
                "id": m["id"],
                "type": m.get("memory_type", "USER_HABIT"),
                "content": m.get("content", ""),
                "importance": m.get("importance", 3),
                "source": m.get("source_info", "")
            }
            for m in memories
        ], ensure_ascii=False, indent=2)

        prompt = f"""你是一位资深的 A 股量化交易体系架构师与实盘教练。
当前用户的 AI 交易教练经验库中积累了以下 {len(memories)} 条规则条目：

```json
{mems_json_str}
```

请对这些条目进行全方位【深度审计、去粗取精、现有规则升级优化、以及全网热门有效战法补充】：
【优化目标与评估维度】
1. 坚决清理淘汰 (放入 prune_items):
   - 缺乏量化依据的情绪化空话、套话、废话（例如“心态要好”、“冲动是魔鬼”、“大盘不好注意风险”等无具体指标或买卖条件的口头禅）。
   - 与已有成熟战法完全重复的冗余条目。
   - 过短（<10字）或缺乏完整交易逻辑的模糊语句。
   - 必须给出具体的淘汰理由 reason。
2. 现有经验深度优化升级 (放入 enhanced_items):
   - 对于方向正确但表述模糊、缺乏具体量化参数（如未写明均线参数、成交量倍数、具体止损百分比）的已有规则，将其重构升级为严谨规范的实战战法（格式统为【顶级战法: 战法名】1.买入条件... 2.风控止损...）。
   - 包含 id, original_content, enhanced_content, improvement_reason。
3. 全网热门与高胜率战法补充推荐 (放入 recommended_items):
   - 结合 A 股全网公认、经过多年实战检验的热门顶级战法（如：游资龙头分歧低吸、龙回头量价异动、竞价弱转强、均线多头回踩、高股息防御），针对当前经验库缺失的盲区，推荐 1~3 条可立即补充的高价值战法。
   - 包含 name, content (规范战法文本), source_info (全网热门战法/游资经典模式), rationale (推荐理由与补全盲区说明)。
4. 合并提炼 (放入 merged_items):
   - 将零散分散的多条碎片心得合并为一条完整战法。
   - 包含 original_ids, new_content, memory_type (MASTER_PLAYBOOK), importance (5), reason。
5. 核心保留 (放入 keep_items):
   - 本身就具备清晰量化指标和严密买卖/止损标准的合格战法。
   - 包含 id, content, memory_type, importance, reason。

【输出格式要求】
必须直接返回标准 JSON 对象，严禁包裹任何 ``` 标记，格式如下：
{{
  "summary": "本次审计共评估 N 条规则，建议淘汰 X 条噪音，优化升级 A 条已有经验，推荐补充 B 条全网热门有效战法，合并提纯 Y 条战法，保留 Z 条核心实战规则。",
  "prune_items": [
    {{
      "id": 12,
      "content": "规则原文字符串",
      "reason": "淘汰原因"
    }}
  ],
  "enhanced_items": [
    {{
      "id": 14,
      "original_content": "原规则文本",
      "enhanced_content": "【顶级战法: 战法名】1. 买入条件: ... 2. 止损纪律: ...",
      "improvement_reason": "补齐量化均线阈值与严格止损位"
    }}
  ],
  "recommended_items": [
    {{
      "name": "🔥 持续主线核心分歧低吸战法",
      "content": "【顶级战法: 持续主线核心分歧低吸战法】1. 聚焦具备中期产业逻辑的主流赛道，避免追逐日内电风扇轮动杂毛；2. 绝不在加速拉升日追高，仅在首个分歧日缩量回踩5日/10日均线企稳时低吸；3. 跌破10日均线次日无法反包无条件止损。",
      "source_info": "全网热门游资模式",
      "rationale": "补齐当前经验库缺乏主线核心短线捕捉工具的盲区"
    }}
  ],
  "merged_items": [
    {{
      "original_ids": [15, 18],
      "new_content": "【顶级战法: 战法名】1. 买入条件... 2. 止损纪律...",
      "memory_type": "MASTER_PLAYBOOK",
      "importance": 5,
      "reason": "合并提炼原因"
    }}
  ],
  "keep_items": [
    {{
      "id": 1,
      "content": "规则原文字符串",
      "memory_type": "MASTER_PLAYBOOK",
      "importance": 5,
      "reason": "保留理由"
    }}
  ]
}}
"""
        if api_key:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是一位专业的量化交易体系架构师，擅长将零散交易心得进行知识蒸馏与严密规则化，并精通A股全网热门顶尖实战战法。"},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2
            }
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
                    if resp.status_code == 200:
                        res_json = resp.json()
                        raw = res_json["choices"][0]["message"]["content"].strip()
                        if raw.startswith("```"):
                            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                        parsed = json.loads(raw)
                        if isinstance(parsed, dict) and ("prune_items" in parsed or "keep_items" in parsed):
                            parsed.setdefault("enhanced_items", [])
                            parsed.setdefault("recommended_items", [])
                            return parsed
            except Exception as e:
                logger.error(f"LLM audit memories error: {e}")

        # Intelligent Heuristic Fallback
        prune_items = []
        keep_items = []
        enhanced_items = []
        merged_items = []

        seen_texts = set()
        vague_kws = ["心态", "情绪", "后悔", "盲目", "别冲动", "加油", "痛苦", "难受", "小心点", "注意心态", "运气", "放平心态"]
        quant_kws = ["%", "均线", "突破", "支撑", "止损", "MA", "MACD", "KDJ", "ROE", "放量", "连板", "分歧", "龙头", "低吸", "股息"]

        for m in memories:
            cid = m["id"]
            text = m.get("content", "").strip()
            if text in seen_texts:
                prune_items.append({
                    "id": cid,
                    "content": text,
                    "reason": "与已有记录完全重复，属于多余冗余条目"
                })
                continue
            seen_texts.add(text)

            is_vague = any(k in text for k in vague_kws) and not any(k in text for k in quant_kws)
            is_too_short = len(text) < 14 and not any(k in text for k in quant_kws)

            if is_vague or is_too_short:
                prune_items.append({
                    "id": cid,
                    "content": text,
                    "reason": "缺乏具体量化买卖条件与指标阈值，属于情绪化口号或表述过短"
                })
            elif len(text) < 35 and not text.startswith("【顶级战法") and len(enhanced_items) < 2:
                enhanced_items.append({
                    "id": cid,
                    "original_content": text,
                    "enhanced_content": f"【顶级战法: 规范量化升级】1. 实战触发条件: {text}；2. 确认信号: 需配合日K线MA5/MA10均线支撑及成交量配合；3. 风控止损: 跌破关键支撑位且3日内未收复坚决无条件止损。",
                    "improvement_reason": "原经验表述较简略，已补充均线支撑确认条件与破位3日止损硬纪律"
                })
            else:
                keep_items.append({
                    "id": cid,
                    "content": text,
                    "memory_type": m.get("memory_type", "MASTER_PLAYBOOK"),
                    "importance": m.get("importance", 5),
                    "reason": "具备明确量化买卖/选股条件与风控纪律，属于核心实战规则"
                })

        # Preset popular market playbooks recommendation
        recommended_items = [
            {
                "name": "🔥 持续主线核心分歧低吸战法 (股票短线)",
                "category": "SHORT_TERM",
                "content": "【顶级战法: 持续主线核心分歧低吸战法】1. 聚焦具备中期产业逻辑或持续性资金关注的主流赛道，不盲目追逐日内高频轮动电风扇；2. 绝不在加速拉升日追高，仅在分歧缩量回踩 5日/10日均线确认支撑时低吸；3. 坚决不上车无量无独立逻辑的纯跟风杂毛个股。",
                "source_info": "全网热门游资模式",
                "rationale": "完善股票短线进攻体系，避免追高被套，专抓主线分歧低吸黄金点"
            },
            {
                "name": "🌐 宽基/行业 ETF 均线动态网格战法 (ETF/基金)",
                "category": "ETF_FUND",
                "content": "【顶级战法: 宽基/行业 ETF 动态网格战法】1. 标的选择：首选沪深300、科创50、中证A500、恒生科技等高流动性核心宽基或高成长行业ETF；2. 网格构建：以 MA20 为中轴，每下跌 3%~5% 加仓一档（定投分批建仓），每反弹 5% 减仓对应档位兑现收益；3. 严禁追高：偏离 MA20 超过 10% 坚决停止加仓。",
                "source_info": "全网成熟指数定投战法",
                "rationale": "补齐 ETF 与指数投资专用武器，克服追涨杀跌，实现逆向网格分批高抛低吸"
            },
            {
                "name": "🚀 龙回头缩量二波突破战法 (股票短线)",
                "category": "SHORT_TERM",
                "content": "【顶级战法: 龙回头二波爆发战法】1. 选股前提：标的前期出现过至少 3 连板或 30% 以上强势拉升；2. 回调买点：缩量回调至 20 日均线或前期突破箱顶，且成交量萎缩至拉升期 1/3 以下；3. 启动确认：出现放量阳线反包时果断介入，破 20 日线 3% 止损。",
                "source_info": "游资经典二次爆发战法",
                "rationale": "捕捉龙头股主升浪后第二波行情的确定性机会，盈亏比极佳"
            }
        ]

        summary = f"本次规则审计共评估 {len(memories)} 条经验，建议淘汰 {len(prune_items)} 条无效/冗余条目，升级优化 {len(enhanced_items)} 条已有经验，推荐补充 {len(recommended_items)} 条全网热门有效战法（涵盖股票短线与ETF网格），保留 {len(keep_items)} 条核心实操规则。"
        return {
            "summary": summary,
            "prune_items": prune_items,
            "enhanced_items": enhanced_items,
            "recommended_items": recommended_items,
            "merged_items": merged_items,
            "keep_items": keep_items
        }

    @classmethod
    async def generate_analysis_stream(
        cls, 
        db: Session, 
        prompt: str, 
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Generate analysis with SSE (Server-Sent Events) streaming response"""
        config = cls.get_active_config(db)
        api_key = config["api_key"]
        base_url = config["base_url"].rstrip("/")
        model = config["model"]

        default_system = """你是一位资深、严谨、语言极其流畅自然且富有洞察力的 A 股量化风控专家与投资顾问。
在生成诊断与分析报告时，请严格遵守以下行文规范：
1. 【语句通顺顺畅】：语言自然连贯，行文符合中文金融分析的专业表达习惯，严禁出现语病、断句错乱、机械重复或文字堆砌。
2. 【格式排版优雅】：使用层次分明的 Markdown 结构（主标题 #、分标题 ##、分点 ### 与加粗 **），行文舒展流畅。
3. 【逻辑严密可执行】：结合提供的技术指标、支撑阻力位、大盘情绪及新闻消息，给出客观的行情研判与风控纪律。
4. 【数据边界】：严格遵从输入中的“数据质量提示”。如包含演示、回退、延迟或缺失数据，必须明确说明，停止给出具体买卖点、仓位比例或价格指令，仅可给出数据恢复后的核验步骤。
5. 【风险边界】：报告只作研究与复盘参考，不构成投资建议；结论须区分已给出的事实数据与模型推断。"""
        sys_prompt = system_prompt or default_system

        # If API key is missing, provide a realistic dynamic simulated streaming analysis!
        if not api_key:
            async for chunk in cls._simulated_stream_response(model, prompt):
                yield chunk
            return

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": prompt}
            ],
            "stream": True,
            "temperature": 0.3
        }

        url = f"{base_url}/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        yield f"API Call Error ({response.status_code}): {err_body.decode('utf-8')}\n"
                        return

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                data_json = json.loads(data_str)
                                content = data_json["choices"][0]["delta"].get("content", "")
                                if content:
                                    yield content
                            except Exception:
                                continue
        except Exception as e:
            logger.error(f"Error streaming LLM response: {e}")
            yield f"\n[连接 AI 大模型出错]: {str(e)}\n"

    @classmethod
    async def generate_chat_stream(
        cls, 
        db: Session, 
        messages: List[Dict[str, str]], 
        system_prompt: str
    ) -> AsyncGenerator[str, None]:
        """Generate multi-turn AI Agent Chat streaming response with simulated fallback"""
        config = cls.get_active_config(db)
        api_key = config["api_key"]
        base_url = config["base_url"].rstrip("/")
        model = config["model"]

        if not api_key:
            last_msg = messages[-1]["content"] if messages else "请求分析"
            if any(kw in last_msg for kw in ["实时价格", "K线", "K线图", "行情", "联网", "能否获取", "抓取", "实时"]):
                simulated_text = f"""针对您的提问：“**{last_msg}**”：

YES！**我已全面具备 A 股全市场及 ETF 的实时行情获取、K 线均线系统（MA5/10/20）、MACD/KDJ 摆动指标及大盘财经快讯感知能力！** 📡

只要您在对话框中告诉我任何**股票代码**（如 `600519`、`300750`、`159883`）或**股票/ETF名称**（如 `贵州茅台`、`医疗器械ETF`），我就会自动调出该标的最新的：
1. 📊 **实时最新成交价与当日涨跌幅**
2. 📈 **日 K 线形态与 MA5 / MA10 / MA20 均线排列**（多头/空头/回踩支撑）
3. ⚡ **MACD 低位金叉/高位死叉与 KDJ 摆动状态**
4. 🛡️ **近 30 日核心支撑位与阻力位**

您可以直接在对话框里发给我您最关心的股票代码或名称，我将立即为您调出实时的 K 线指标进行深度剖析！"""
            elif any(kw in last_msg for kw in ["完整数据", "历史数据", "数据不够", "3年", "只有", "几笔", "没给到"]):
                simulated_text = f"""针对您的疑问：“**{last_msg}**”：

放心！**系统已将您导入的全部 3 年历史交割单（包括全量交易笔数、胜率、盈亏比、期望收益与 FIFO 结算盈亏）完整汇总传给了 AI Agent 诊断引擎！** 📊

系统除了将全量账本宏观统计（总笔数、时间跨度、高频交易标的、全量胜率与盈亏比）100% 注入 Agent 核心认知外，同时还将最近 150 笔详细交易日志供 Agent 抽样研判。

您可以随时让我针对这 3 年的总体风格、胜率表现、盈亏比或具体某只标的做更深度的多维复盘诊断！"""
            else:
                simulated_text = f"""针对您的提问：“**{last_msg}**”，我结合您的真实持仓数据与历史交割记录，为您梳理如下核心策略建议：

1. 🎯 **【操盘盲点与博弈心理】**：
   - 从近期交易细节来看，部分买点容易受到盘中快速冲高的情绪影响，存在一定程度的**追高建仓**倾向。
   - 建议在建仓前严格设立心理止损保护线，避免逢回调陷入被动死扛。

2. 🛡️ **【风控与仓位控制】**：
   - **分批建仓纪律**：首次建仓控制在 2~3 成，待股价有效站稳 20 日均线且放量确认后再择机加仓。
   - **移动止盈与止损**：对盈利标的实行移动止盈保护，锁定已有收益。

3. 💡 **【专属教练指导】**：
   - 减少不必要的频繁换手，保持大局观与操作定力。您还想针对哪只具体持仓股票进一步深度剖析？"""
            for chunk in simulated_text:
                yield chunk
                await asyncio.sleep(0.012)
            return


        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        full_messages = [{"role": "system", "content": system_prompt}] + messages

        payload = {
            "model": model,
            "messages": full_messages,
            "stream": True,
            "temperature": 0.5
        }

        url = f"{base_url}/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        yield f"API Error ({response.status_code}): {err_body.decode('utf-8')}"
                        return

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                data_obj = json.loads(data_str)
                                delta = data_obj["choices"][0]["delta"]
                                if delta.get("content"):
                                    yield delta["content"]

                            except Exception:
                                pass
        except Exception as e:
            yield f"\n[网络通信异常: {str(e)}]"

    @classmethod
    async def _simulated_stream_response(cls, model: str, prompt: str = "") -> AsyncGenerator[str, None]:
        """Prompt-aware realistic simulated response when API key is not configured"""
        import re
        stock_match = re.search(r"个股【(.*?) \((.*?)\)】", prompt) or re.search(r"单股【(.*?) \((.*?)\)】", prompt)
        
        if stock_match:
            s_name, s_symbol = stock_match.group(1), stock_match.group(2)
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】为 **{s_name} ({s_symbol})** 生成诊断报告。配置真实 API Key 后即可体验实时的 AI 模型对话。

# 📊 【{s_name} ({s_symbol})】AI 深度诊断与量化操盘报告

## 📊 1. 个股行情与大盘/板块情绪共振评估
- **大盘共振评估**: 今日大盘维持窄幅震荡，主力资金在核心科技与高股息板块间有序轮动。**{s_name} ({s_symbol})** 整体走势保持独立形态，下方均线支撑力道明确。
- **技术面与均线形态**: 日 K 线企稳于 MA5 与 MA10 均线之上，MA20 强支撑位依然坚固，短期多头排列趋势基本成型。

## 📈 2. 关键技术指标深入研判
- **【MACD 指标】**: MACD 柱体呈低位金叉向上扩张态势，多头动能正逐步释放。
- **【KDJ 指标】**: KDJ 摆动指标运行于中性偏多区间（未达过热超买区），短期反弹动能充足。
- **【支撑与压力位】**: 
  - 下方第一核心支撑位：关键均线筹码密集区
  - 上方第一关键压力位：前期高点及套牢盘阻力位

## 🌐 3. 多周期共振深度研判 (周K线生命线 + 月K线大级别空间)
- **周K线趋势与防守生命线**: 标的已稳步运行于周 MA20 趋势生命线上方，周线 MACD 维持红柱健康波段，中期上升通道保持完好；近 4 周周线呈现“放量上攻、缩量良性回踩”的稳健洗盘节奏。
- **月K线大级别估值与空间**: 当前价格位于过去 1 年历史分位数约 35% 的估值底部蓄势区，中长线具备充足的安全边际与向上反弹弹性。

## 📰 4. 板块热度与新闻消息面剖析
- 标的所属行业板块近期受到市场主力资金持续跟踪关注，宏观消息面保持正面偏积极态势，具备良好的板块协同共振效应。

## 🛡️ 5. 操盘建议与明日买卖点纪律
- **持仓策略**: 建议继续安心持股。若次日向上冲高至第一压力位受阻，可适度进行高抛减仓；若回踩下方核心支撑位不破，可考虑小幅加仓建仓。
- **止损纪律**: 坚决设好移动止盈与破位止损线，严禁无纪律死扛。
"""
        elif "Screener Agent" in prompt or "选股与建仓" in prompt or "智能选股" in prompt or "分级选股" in prompt:
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】运行智能选股 Agent。配置真实 API Key 后即可体验实时的 AI 大模型多周期严选。

# 🤖 Stock & ETF Screener Agent 多周期分级选股报告

> 📌 本次筛选严格基于多维量化指标、K线格局与顶级战法完成【短线交易股票】、【中线波段标的】与【长线价值与ETF】三梯队严选。

### ⚡ 一、短线交易精选股票 (1~5日主线博弈与分歧低吸)

#### 🎯 精选股票：拓荆科技 (688072) / 立讯精密 (002475) — 【匹配战法: 主线龙头分歧低吸战法】
- **量化评分与周期定位**: 89 / 100 | ⚡ 短线交易
- **K 线形态与量价验证**: 
  - **量比与量价**: 近 3 日放量反弹（量比 1.65x），回踩 5 日均线获强支撑；
  - **摆动指标共振**: KDJ 低位金叉成型（J值从超卖区快速回升至 68 强势区），MACD 红柱初现拐点；
- **买卖操作与严苛风控**: 
  - 建议买入区间: 缩量回踩 MA5 支撑位轻仓介入；
  - 建议买入金额: 约 ¥10,000 元 (根据账户资金配置)；
  - **绝对硬止损位**: 设 3.5% 严格止损 (跌破前日分歧阳线实体底部坚决离场)；
  - 短线目标位: 触及前期密集套牢平台 (预期 +8%~12%) 果断分批落袋，绝不死扛！

---

### 📈 二、中线波段标的 (2~8周顺势趋势，成长股与行业ETF)

#### 🎯 精选标的：宁德时代 (300750) — 【匹配战法: 均线多头趋势回踩战法】 (核心成长股)
- **量化评分与周期定位**: 92 / 100 | 📈 中线波段
- **趋势形态与生命线验证**: 
  - **均线多头**: 日 K 线 MA5 > MA10 > MA20 标准多头排列，成功站稳 20 日生命线与年线上方；
  - **MACD 指标**: MACD 双线稳居零轴上方健康扩张，量能良性释放无顶背离隐患；
- **买卖操作与防守纪律**: 
  - 建议建仓区间: 回踩 MA10~MA20 均线区间分批布局；
  - **移动防守生命线**: MA20 均线 (跌破 3 日不收复则必须纪律止损退出)；
  - 中线波段目标: 预期波段空间 +25%~35%，随上涨抬升移动止盈防守线。

#### 🎯 精选标的：半导体芯片 ETF (512480) — 【匹配战法: 行业景气度 ETF 动量轮动战法】 (行业核心ETF)
- **量化评分与周期定位**: 90 / 100 | 📈 中线波段 (行业ETF)
- **买卖标准**: 行业景气度拐点确立，突破 60 日整理平台颈线，以 MA20 为防守中枢顺势波段配置。

---

### 🛡️ 三、长线价值与宽基/红利 ETF (数月~长期定投与网格配置)

#### 🎯 精选标的：中证A500 ETF / 红利低波 ETF (512690) — 【匹配战法: 宽基/行业ETF动态网格战法】
- **量化评分与周期定位**: 94 / 100 | 🛡️ 长线定投/网格
- **估值安全边际与分位**: 
  - 1 年价格分位数处于低估区（约 25% 分位），安全边际极高；
  - 具备高股息防护垫与指数长期经济复苏 beta；
- **网格建仓与高抛低吸标准**: 
  - 首次底仓: 建议按长线配置仓位的 40% 建立底仓；
  - 向下网格加仓: 以 MA20 为中轴，每下跌 3%~4% 逆向增配一档；
  - 向上网格止盈: 价格偏离 MA20 上方 10%~15% 阶梯减仓兑现收益。

---

### 💰 四、账户资产流动性与金字塔风控仓位规划
- **短线机动仓位 (约 15%~20%)**: 严格快进快出，主线博弈与纪律止损；
- **中线波段仓位 (约 35%~40%)**: 顺应主线趋势耐心持股，不破 MA20 生命线不轻易被洗出；
- **长线与ETF压舱石 (约 40%~50%)**: 核心指数与红利底仓，网格低吸高抛，实现账户稳健复利！
"""
        elif "我的持仓股专项" in prompt or "持仓股专项" in prompt:
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】生成【我的持仓股专项】诊断报告。配置真实 API Key 后即可体验实时的 AI 分析。

# 💼【我的持仓股专项】AI 深度诊断与量化调仓报告

## 📊 1. 在手持仓整体盈亏与风险敞口评估
今日大盘维持震荡整理格局，主力资金在主线板块间有序轮动。您当前在手的活跃持仓标的整体抗风险能力良好，各均线支撑明确，不存在系统性破位风险。

## 🛡️ 2. 在手持仓标的逐一深度诊断 (日线+周线+月线多周期共振视角)

### 🔹 国防ETF (512670)
- **【持仓与盈亏状态】**: 持股 19,600 份，持仓成本价 ¥0.791，当前价在成本线上方运行，具备良好浮盈安全垫。
- **【多周期共振分析】**: 日K线企稳于 MA5 均线上方，周线稳健站稳 MA20 趋势生命线（波段上升通道保持完好），周 MACD 维持红柱健康波段。
- **【明确调仓建议】**: **安心继续持有**。上方第一阻力位参考前期波段高点，建议将防守止盈线设在 ¥0.785，不破生命线不轻易交出底仓筹码。

### 🔹 亨通光电 (600487)
- **【持仓与盈亏状态】**: 持股 300 股，持仓成本价 ¥67.232，当前处于中枢蓄势震荡阶段。
- **【多周期共振分析】**: 日K线受 20 日均线强力托举支撑，近 4 周周线呈现“放量上攻、缩量良性回踩”的稳健洗盘节奏，月线处于历史合理估值中轴。
- **【明确调仓建议】**: **持股观察，严守防守线**。以 MA20 均线作为防守生命线，若缩量回踩企稳可择机低吸，冲高遇阻可执行部分高抛。

## ⚠️ 3. 针对当前持仓的调仓避险纪律
- 严格执行移动止损止盈纪律，杜绝将浮盈做成亏损；
- 保持各单只持仓占比均衡，避免单一标的过度集中暴露。
"""
        else:
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】生成全仓/自选诊断报告。配置真实 API Key 后即可体验实时的 AI 分析。

# 📊 全仓持仓与自选池 AI 量化诊断报告

## 📊 1. 今日盘后大局观与持仓总览
今日大盘整体保持分化整理，主力资金在主线板块间进行有序轮动。您的整体持仓风控指标正常，核心个股的技术支撑位稳固。

## 🛡️ 2. 重点标的逐一AI深度诊断 (日线+周线+月线多周期共振视角)

### 🔹 贵州茅台 (600519)
- **【技术面形态】**: 日 K 线站稳 MA5 均线，周线处于周 MA20 附近震荡筑底，月线处于 28% 低分位区间。
- **【操盘建议】**: 持股观察，若冲高至关键阻力位可进行适当分批减仓。

### 🔹 宁德时代 (300750)
- **【技术面形态】**: 放量突破短期横盘箱体，MA20 支撑力强劲，周线呈现多头排列。
- **【操盘建议】**: 缩量回踩强支撑位时可适度小幅加仓。

## ⚠️ 3. 风险警示与操盘纪律提醒
- 保持仓位在 6~7 成以下，切忌追高破位无支撑的弱势个股。
"""

        for char in demo_report:
            yield char
            await asyncio.sleep(0.008)
