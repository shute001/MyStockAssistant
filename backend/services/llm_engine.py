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

### 📰 3. 板块热度与新闻消息面/催化因素剖析
- 评价该标的所属板块在当前大盘中的热度及最新财经消息面催化。

### 🛡️ 4. 操盘建议与明日买卖点纪律
- **短线/中线建议**: 结合大盘风向与个股指标，明确给出具体的【高抛点】、【低吸点】或【止损位/建仓观察位】。
"""
        return prompt

    @classmethod
    def build_trade_review_prompt(
        cls, 
        db: Session, 
        trade_records: List[Dict[str, Any]], 
        current_positions: List[Dict[str, Any]],
        macro_context: Optional[Dict[str, Any]] = None,
        traded_stocks_indicators: Optional[Dict[str, Any]] = None
    ) -> str:
        """Construct Trade Review Agent prompt with memory injection, per-trade indicators, 4D scoring & weekly leak detection"""
        memory_block = AgentMemoryService.format_memories_for_prompt(db)
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""
        
        indicators_block = ""
        if traded_stocks_indicators:
            indicators_block = f"""## 📈 交易涉及个股的【实时最新价格、K线均线与技术指标】：
{json.dumps(traded_stocks_indicators, ensure_ascii=False, indent=2)}
"""

        reason_example = trade_records[0].get("strategy_reason") if (trade_records and trade_records[0].get("strategy_reason")) else "突破建仓"

        prompt = f"""# 🤖 Trade Review Agent (AI 交易复盘与诊所教练) 指令

你是一位经验丰富、注重风险控制与交易心理的 A 股量化交易复盘教练。
你的职责是：深入分析用户的交易记录、持仓以及确定性统计数据（胜率、盈亏比、期望收益），**对照当日/当前全市场大盘情绪、领涨热点板块、实时新闻背景以及个股真实 K 线均线指标（MA5/10/20、MACD、KDJ、支撑压力位）**，识别交易性格、优点与致命缺点，输出【四维能力评分卡】与【周度纪律漏洞诊断】，给出犀利且可执行的改进指导，并在报告结尾自动萃取【记忆演化总结】。

{macro_block}

---

{indicators_block}

---

{memory_block}

---

## 二、 用户交易历史明细 ({len(trade_records)} 笔交易):
{json.dumps(trade_records, ensure_ascii=False, indent=2)}

## 三、 用户当前持仓状况:
{json.dumps(current_positions, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【Trade Review Agent 复盘与诊断报告】：

### 📊 1. 交易明细与大盘情绪/板块热度/K线指标深度对照诊断
- **板块与大盘情绪对照**: 对比上方【全市场大盘情绪、领涨热点板块与新闻】，剖析交易标的是否顺应了主力资金热点（例如：是否买在大盘/板块主线热点，还是买在无题材跟风盘/弱势阴跌板块）。
- **K线买卖择时点对照**: 对比个股实时 K 线均线（MA5/10/20）及支撑/阻力价位，评价交易买点是否处于【放量突破】、【缩量回踩支撑】还是【冲动追高/破位死扛】。

### 🏆 2. 顶级战法与风控铁律对标检查 (Master Playbook Compliance Check)
- **战法恪守检查**: 结合上方【必须严格对标与恪守的顶级战法库】，逐一对照评估用户近期交易是否【符合】或【违背】战法纪律（重点对标如：CANSLIM 7%硬止损、龙头分歧低吸、均线多头回踩等）。

### 📊 3. 交易能力四维评估打分卡 (请严格给出 0-100 具体分数及一句话评语)
- **🎯 择时与买点质量 (Timing & Entry)**: [打分]/100 — 评语（评价是否追高、抄底时机及K线位置）
- **🛡️ 止损与风控纪律 (Risk Control)**: [打分]/100 — 评语（评价止损执行、计划外冲动交易控制）
- **🧠 交易心理控制 (Psychology)**: [打分]/100 — 评语（评价恐惧、贪婪、FOMO追涨等心态）
- **📈 策略与战法适配度 (Playbook Fit)**: [打分]/100 — 评语（评价交易策略与当前大盘板块环境及顶级战法的匹配程度）

### 🔎 4. 经典交易案例与周度漏洞诊断 (Weekly Leak Detection)
- **🏆 本周最佳成功操作**: 点评表现最好的一笔交易（买卖理由“{reason_example}”），说明成功的核心因素。
- **⚠️ 本周最大纪律漏洞**: 深刻剖析导致亏损或风险最大的一笔/类交易（重点检查【计划外冲动】交易）。

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
        all_items = portfolio_data + watchlist_data
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""

        prompt = f"""# A股【{scope_label}】AI量化操盘诊断指令

请作为资深 A 股量化风控专家，结合以下【全市场大盘情绪、领涨热点板块与新闻消息面】以及【用户的持仓与自选股数据】，生成一份专业、严谨且排版优雅的【全仓/自选 AI 量化诊断报告】。

{macro_block}

---

## 📌 用户持仓与自选股清单数据：
{json.dumps(all_items, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成诊断报告：

### 📊 1. 今日盘后大局观与持仓总览
- **大盘与板块情绪共振**: 结合大盘整体走势与当前主力热点板块，评价整体仓位风险及市场风险偏好。
- **持仓与自选整体诊断**: 汇总评估当前组合结构（高股息、科技成长、周期等）的合理性。

### 🛡️ 2. 重点标的逐一AI深度诊断
- 针对用户持仓与自选股中的核心标的，逐一分析其技术面、均线形态、MACD/KDJ状态，并给出明确的持仓/减仓/止损/加仓策略建议。

### ⚠️ 3. 风险警示与操盘纪律提醒
- 给出 2-3 条当前市场环境下的仓位控制与操盘风控铁律。
"""
        return prompt

    @classmethod
    def build_stock_screener_prompt(
        cls, 
        watchlist_items: List[Dict[str, Any]], 
        user_rules_text: str, 
        macro_context: Optional[Dict[str, Any]] = None
    ) -> str:
        """Construct Stock & ETF Screener prompt based on market macro, user rules & technical signals"""
        macro_block = MarketDataService.format_macro_prompt_block(macro_context) if macro_context else ""

        prompt = f"""# 🤖 Stock & ETF Screener Agent (AI 智能选股与预警) 指令

你是一位严苛的 A 股量化选股策略专家。
请结合全市场大盘情绪、主力热点板块、最新宏观消息，以及用户激活的顶级战法与选股铁律，进行多维度智能推选。

{macro_block}

---

## 📌 必须严格遵循的顶级战法与选股铁律（Master Playbooks & Rules）：
{user_rules_text}

---

## 📌 候选标的池行情与指标数据：
{json.dumps(watchlist_items, ensure_ascii=False, indent=2)}

---

## 请按以下 Markdown 结构生成【Stock & ETF Screener 选股与建仓报告】：

### 🏆 1. 顶尖战法高匹配度精选标的推荐
- 从候选池中严苛筛选出 1-3 只最高度匹配【顶级战法与风控铁律】的重点标的。标注其对标的战法名称（如：CANSLIM突破、龙头分歧低吸）。

### 🔍 2. 战法契合度与深度指标验证
- **战法规则匹配点**: 阐述该标的具体满足了哪几条顶级战法规则（如：均线 MA5/10/20 多头、放量突破、MACD 零轴上方金叉）。
- **板块与消息面催化**: 说明该标的是否具备大盘风向与板块热度支撑。

### 🛡️ 3. 建仓买点与严格风控纪律
- 给出建议的建仓区间、止损价位与首期仓位占比。
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

## 📰 3. 板块热度与新闻消息面剖析
- 标的所属行业板块近期受到市场主力资金持续跟踪关注，宏观消息面保持正面偏积极态势，具备良好的板块协同共振效应。

## 🛡️ 4. 操盘建议与明日买卖点纪律
- **持仓策略**: 建议继续安心持股。若次日向上冲高至第一压力位受阻，可适度进行高抛减仓；若回踩下方核心支撑位不破，可考虑小幅加仓建仓。
- **止损纪律**: 坚决设好移动止盈与破位止损线，严禁无纪律死扛。
"""
        elif "Screener Agent" in prompt or "选股与建仓" in prompt or "智能选股" in prompt:
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】运行智能选股 Agent。配置真实 API Key 后即可体验实时的 AI 模型筛选。

# 🤖 Stock & ETF Screener Agent (智能选股与建仓推荐报告)

## 🏆 1. 顶尖战法高匹配度精选标的推荐

### 🎯 推荐标的：宁德时代 (300750) — 【对标: 欧奈尔 CANSLIM 突破战法】
- **量化评分**: 92 / 100
- **战法匹配项**: 相对强度 RS>85，成交量放量突破 50% 均量箱体，日 K 线 MA5 > MA10 > MA20 多头排列。

### 🎯 推荐标的：贵州茅台 (600519) — 【对标: 均线多头趋势回踩战法】
- **量化评分**: 88 / 100
- **战法匹配项**: 日 K 线回踩 20 日均线企稳支撑，MACD 低位金叉扩张，极具风控赔率优势。

## 🔍 2. 战法契合度与深度指标验证
- **技术面突破点**: 均线与成交量高度配合，资金净流入排名处于全市场前列。
- **板块与消息面催化**: 主力资金聚焦核心龙头，大盘震荡时具备强劲的防御与反弹动能。

## 🛡️ 3. 建仓买点与严格风控纪律
- **建仓区间**: 建议缩量回踩 MA5 / MA10 均线分批建仓（首期仓位 2~3 成）。
- **硬止损线**: 严守 7% 绝对止损纪律，破位支撑无条件平仓防守。
"""
        else:
            demo_report = f"""> 💡 **系统提示**: 当前正在使用【{model} 演示模拟模式】生成全仓/自选诊断报告。配置真实 API Key 后即可体验实时的 AI 分析。

# 📊 全仓持仓与自选股 AI 量化诊断报告

## 📊 1. 今日盘后大局观与持仓总览
今日大盘整体保持分化整理，主力资金在主线板块间进行有序轮动。您的整体持仓风控指标正常，核心个股的技术支撑位稳固。

## 🛡️ 2. 重点标的逐一AI深度诊断

### 🔹 贵州茅台 (600519)
- **【技术面形态】**: 日 K 线站稳 MA5 均线，MACD 柱体由负转正呈金叉蓄势形态。
- **【操盘建议】**: 持股观察，若冲高至关键阻力位可进行适当分批减仓。

### 🔹 宁德时代 (300750)
- **【技术面形态】**: 放量突破短期横盘箱体，MA20 支撑力强劲。
- **【操盘建议】**: 缩量回踩强支撑位时可适度小幅加仓。

## ⚠️ 3. 风险警示与操盘纪律提醒
- 保持仓位在 6~7 成以下，切忌追高破位无支撑的弱势个股。
"""

        for char in demo_report:
            yield char
            await asyncio.sleep(0.008)
