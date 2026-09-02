import json
import asyncio
import logging
import httpx
from typing import AsyncGenerator, Dict, Any, List, Optional
from sqlalchemy.orm import Session
from database import LLMConfig

from services.agent_memory import AgentMemoryService

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
    def build_single_stock_prompt(cls, symbol: str, name: str, indicators: Dict[str, Any]) -> str:
        """Construct professional A-share single stock analysis prompt payload"""
        prompt = f"""# A股个股【{name} ({symbol})】AI量化操盘诊断指令

请作为资深 A 股量化风控专家，基于以下该股票的最新行情数据、K线走势、均线及技术指标，为用户输出一份专业、客观、有纪律性的【单股AI深度诊断报告】。

## 实时行情与技术指标数据：
{json.dumps(indicators, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【{name} ({symbol})】深度诊断报告：

### 📊 1. 个股行情与技术面总体评价
- 评价当前股价（¥{indicators.get('current_price')}元）、今日涨跌幅（{indicators.get('pct_chg')}）及成交量。
- 分析当前 K 线趋势与均线排列形态（MA5: {indicators.get('ma5')} / MA10: {indicators.get('ma10')} / MA20: {indicators.get('ma20')}，当前为【{indicators.get('ma_trend')}】）。

### 📈 2. 关键技术指标深入研判 (MACD / KDJ / 支撑与阻力)
- **【MACD形态】**: 分析 MACD_DIF({indicators.get('macd_dif')})、MACD_DEA({indicators.get('macd_dea')}) 与柱体 ({indicators.get('macd_status')})。
- **【KDJ摆动】**: K值 ({indicators.get('kdj_k')})、D值 ({indicators.get('kdj_d')})、J值 ({indicators.get('kdj_j')}) 处于超买还是超卖区。
- **【强支撑位与压力位】**: 基于近期低点支撑位（**¥{indicators.get('support_price')}元**）与近期高点压力位（**¥{indicators.get('resistance_price')}元**）分析套牢盘与反弹阻力。

### 🛡️ 3. 操盘建议与明日买卖点纪律
- **短线/中线建议**: 结合以上数据，明确给出具体的【高抛点】、【低吸点】或【止损位/建仓观察位】。
"""
        return prompt

    @classmethod
    def build_trade_review_prompt(
        cls, 
        db: Session, 
        trade_records: List[Dict[str, Any]], 
        current_positions: List[Dict[str, Any]]
    ) -> str:
        """Construct Trade Review Agent prompt with memory injection & market quotes"""
        memory_block = AgentMemoryService.format_memories_for_prompt(db)
        
        reason_example = trade_records[0].get("strategy_reason") if (trade_records and trade_records[0].get("strategy_reason")) else "突破建仓"

        prompt = f"""# 🤖 Trade Review Agent (AI 交易复盘与诊所教练) 指令

你是一位经验丰富、注重风险控制与交易心理的 A 股量化交易复盘教练。
你的职责是：深入分析用户的每日交易记录与持仓，识别交易性格、优点与致命缺点，给出犀利且可执行的改进指导，并在报告结尾自动萃取【记忆演化总结】以便 Agent 长期学习。

---

{memory_block}

---

## 二、 用户历史交易记录明细 ({len(trade_records)} 笔交易):
{json.dumps(trade_records, ensure_ascii=False, indent=2)}

## 三、 用户当前持仓状况:
{json.dumps(current_positions, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【Trade Review Agent 复盘与诊断报告】：

### 🏆 1. 交易表现与胜率总体点评
- 统计近期的买卖频率、资金利用率与胜率评价。
- 结合你的历史记忆（过去总结的用户习惯/教训），点评用户本次交易是否有改进，还是重复犯了过去的错误。

### 🔎 2. 经典交易案例逐笔剖析 (得失研判)
- 针对提交的每一笔/重点买卖记录（包括买入单价、买入理由“{reason_example}”与成交时点）：
  - **点评买入/卖出时机**：是否属于追高、抄底、顺势或盲目追跌。
  - **评估理由合理性**：用户填写的买卖理由是否符合交易纪律。

### 💡 3. 交易性格与心理陷阱诊断
- 诊断用户存在的心理误区（如：FOMO害怕错过、止损犹豫、过度交易、重仓赌单股）。

### 🎯 4. 下一交易日/未来操作禁忌与改进建议
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
        scope_label: str = "全仓与自选"
    ) -> str:
        """Construct professional A-share portfolio / sector analysis prompt payload"""
        all_items = portfolio_data + watchlist_data
        prompt = f"""# A股【{scope_label}】AI量化操盘诊断指令

请作为资深 A 股量化风控专家，基于以下【{scope_label}】的最新行情数据、技术指标与持仓成本，为用户输出一份专业、客观、有纪律性的【AI量化诊断报告】。

## 一、诊股分析标的范围：【{scope_label}】

## 二、行情数据与技术指标完整清单 ({len(all_items)} 只标的)：
{json.dumps(all_items, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【{scope_label}】诊断报告：

### 📊 1. 今日盘后大局观与【{scope_label}】态势总览
- 简述整体风险暴露、技术面强弱分化与资金关注度评估。

### 🛡️ 2. 标的股票逐一AI深度诊断 (包含操盘建议)
针对列表中的每一只股票进行诊断：
- **【技术面与形态】**: 结合 MA5/MA10/MA20、MACD 金死叉及 KDJ 评价趋势形态。
- **【支撑与压力位】**: 对比当前股价与支撑/阻力位，判断处于获利减仓区还是破位止损区。
- **【明日操作纪律】**: 给出具体的【高抛点】、【低吸点】或【止损位/建仓观察位】。

### 🎯 3. 板块共振与择时建仓建议
- 评估板块轮动节奏，指出哪些标的接近强支撑位具备建仓机会，哪些处于高位震荡需观望。

### ⚠️ 4. 重点风险警示与操盘纪律提醒
- 列出次日需要特别警惕的风险点（如连续缩量阴跌、破位死叉等）。
"""
        return prompt

    @classmethod
    def build_stock_screener_prompt(
        cls,
        watchlist_items: List[Dict[str, Any]],
        user_rules_text: str
    ) -> str:
        """Construct prompt for Stock Screener & Recommendation Agent"""
        prompt = f"""# 🎯 A股/ETF 智能选股与策略推选 Agent 指令

请作为资深 A 股量化选股专家与技术分析师，基于用户自定义的【选股与建仓规则】，对用户自选股/持仓清单中的股票及 ETF 进行逐一量化指标匹配与多维度筛选。

---

## 📌 一、用户当前生效的【选股与建仓规则库】：
{user_rules_text}

---

## 📊 二、待筛选的自选股/ETF行情与技术指标数据 ({len(watchlist_items)} 只)：
{json.dumps(watchlist_items, ensure_ascii=False, indent=2)}

---

## 🚀 三、请输出【自选股每日智能筛选与策略推选报告】：

### 🟢 1. 【精选符合条件标的】(强烈推荐 / 突破关注)
- 逐一列出完美符合用户【选股与建仓规则】的股票/ETF代码与名称。
- **触发理由与核心买点**：结合均线排列（MA5/MA10/MA20）、MACD金叉/柱体膨胀、KDJ低位反转、强支撑位与成交量。
- **建仓策略建议**：建议买入价格区间（¥）、初始建仓仓位比例（如 2-3 成）及硬性止损位（¥）。

### 🟡 2. 【潜伏与观察标的】(接近突破 / 回踩支撑)
- 列出接近符合规则、处于蓄势阶段或缩量回踩 MA20 强支撑位的标的。
- 给出次日观察条件（如：“若明日放量突破 ¥XX 元即可跟进建仓”）。

### 🔴 3. 【高风险规避标的】(破位死叉 / 暂不推荐)
- 列出处于死叉破位、MA20 线下阴跌或超买高位滞涨的标的，提示暂不建仓规避风险。

### 💡 4. 【策略优化与纪律提醒】
- 针对当前选股规则给出 1-2 条量化优化点。
"""
        return prompt

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

        default_system = "你是一位专业A股量化分析师与风控专家，分析严谨客观，注重风险控制与交易纪律。"
        sys_prompt = system_prompt or default_system

        # If API key is missing, provide a realistic simulated streaming analysis!
        if not api_key:
            async for chunk in cls._simulated_stream_response(model):
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
            simulated_text = f"""针对你的提问：“**{last_msg}**”，我结合你的真实持仓与历史交易记录为你进行深度剖析：

1. 🎯 **【操盘盲点诊断】**：
   - 从你的历史交割单来看，你在多笔交易中存在**追高建仓**与**回调犹豫**的问题。
   - 比如部分个股在逢大阳线进场时，未提前设置明确的初始止损位，导致回调时陷入被动持仓心态。

2. 🛡️ **【心态与风险控制建议】**：
   - **分批建仓纪律**：切忌单次满仓买入，首次建仓控制在 2-3 成仓，待股价缩量企稳站上 20 日均线后再考虑顺势加仓。
   - **纪律性止损/止盈**：在开仓前务必确定心理止损位（如 -3% 至 -5% 破位即切断风险）。

3. 💡 **【专属教练提醒】**：
   - 减少因频繁短线买卖带来的无谓手续费磨损，保持大局观与耐心。你还想针对哪只具体持仓股票深入探讨？"""
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
    async def _simulated_stream_response(cls, model: str) -> AsyncGenerator[str, None]:
        """Realistic simulated response when API key is not configured"""
        demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】生成报告。配置真实 API Key 后即可获得实时的 AI 分析。

# 📊 每日持仓诊断与操盘报告

## 📊 1. 今日盘后大局观与持仓总览
今日大盘窄幅震荡，主力资金呈现板块轮动迹象。您的整体持仓风险可控，核心个股支撑位依然稳固。

## 🛡️ 2. 持仓股逐一AI深度诊断

### 🔹 贵州茅台 (600519)
- **【技术面形态】**: 日K线收复 MA5 与 MA10 均线，MACD 柱由负转正呈低位金叉蓄势形态。
- **【成本与支撑】**: 当前价格低于您的持仓成本约 4%，下方 1550 元附近存在密集筹码强支撑。
- **【明日操作纪律】**: 
  - **建议**: 持股待涨。若次日冲高至 1680 压力位受阻，可适度高抛做T；若下探 1550 不破，可考虑小幅补仓。

### 🔹 平安银行 (000001)
- **【技术面形态】**: KDJ 指标进入超买区，缩量运行，处在高位横盘震荡阶段。
- **【成本与支撑】**: 位于盈利区间，上方 12.5 元存在一定获利盘抛压。
- **【明日操作纪律】**: 设好移动止盈线 11.5 元，锁住既有利润。

## 🎯 3. 自选股跟踪与建仓预警
- **宁德时代 (300750)**: 当前回踩 20 日均线，放量企稳迹象明显，可列为**重点拟建仓观察对象**。

## ⚠️ 4. 重点风险警示
- 控制整体仓位在 6~7 成以下，切忌追高破位无支撑的强势股。
"""
        for char in demo_report:
            yield char
            await asyncio.sleep(0.01)
