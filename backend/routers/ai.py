import json
import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, Position, Watchlist, Stock, AnalysisReport, TradeRecord, AgentMemory, PushConfig, bj_now
from services.market_data import MarketDataService
from services.llm_engine import MultiLLMEngine
from services.agent_memory import AgentMemoryService
from services.notifier import send_wechat_notification


router = APIRouter(prefix="/ai", tags=["AI Stock Analysis"])

class SingleStockAnalyzeRequest(BaseModel):
    symbol: str

class PortfolioAnalyzeRequest(BaseModel):
    scope: Optional[str] = "ALL"  # "ALL" | "POSITIONS_ONLY" | "CATEGORY:板块名"

class PushReviewRequest(BaseModel):
    report_id: Optional[int] = None
    title: Optional[str] = "📊 AI 股票交易复盘诊断报告"
    content_md: Optional[str] = None


@router.post("/analyze/portfolio/stream")
async def analyze_portfolio_stream(req: Optional[PortfolioAnalyzeRequest] = None, db: Session = Depends(get_db)):
    """Stream AI analysis for portfolio / specific sectors with market macro & news context"""
    scope = req.scope if (req and req.scope) else "ALL"
    macro_context = MarketDataService.get_market_macro_context()
    
    if scope.startswith("SINGLE:"):
        raw_sym = scope.split("SINGLE:", 1)[1].strip()
        symbol = MarketDataService.format_symbol(raw_sym)
        stock = db.query(Stock).filter(Stock.symbol == symbol).first()
        name = stock.name if stock else MarketDataService.get_stock_name(symbol)
        indicators = MarketDataService.get_stock_indicators_summary(symbol, name)
        
        pos = db.query(Position).filter(Position.symbol == symbol).first()
        if pos:
            indicators["cost_price"] = pos.cost_price
            indicators["current_volume"] = pos.current_volume
            
        scope_label = f"单股【{name} ({symbol})】"
        prompt = MultiLLMEngine.build_single_stock_prompt(symbol, name, indicators, macro_context=macro_context)
        item_count_label = f"单股 {symbol}"
    else:
        positions = []
        watchlists = []
        scope_label = "全仓与全部自选"

        if scope == "ALL":
            positions = db.query(Position).all()
            watchlists = db.query(Watchlist).all()
            scope_label = "全仓与全部自选"
        elif scope == "POSITIONS_ONLY":
            positions = db.query(Position).all()
            scope_label = "我的持仓股专项"
        elif scope.startswith("CATEGORY:"):
            cat_name = scope.split("CATEGORY:", 1)[1]
            watchlists = db.query(Watchlist).filter(Watchlist.category == cat_name).all()
            scope_label = f"【{cat_name}】板块专项"
        else:
            positions = db.query(Position).all()
            watchlists = db.query(Watchlist).all()

        portfolio_payload = []
        for pos in positions:
            stock = db.query(Stock).filter(Stock.symbol == pos.symbol).first()
            name = stock.name if stock else pos.symbol
            indicators = MarketDataService.get_stock_indicators_summary(pos.symbol, name)
            indicators["cost_price"] = pos.cost_price
            indicators["current_volume"] = pos.current_volume
            portfolio_payload.append(indicators)

        watchlist_payload = []
        for w in watchlists:
            stock = db.query(Stock).filter(Stock.symbol == w.symbol).first()
            name = stock.name if stock else w.symbol
            indicators = MarketDataService.get_stock_indicators_summary(w.symbol, name)
            indicators["category"] = w.category
            indicators["target_buy_price"] = w.target_buy_price
            watchlist_payload.append(indicators)

        prompt = MultiLLMEngine.build_portfolio_prompt(portfolio_payload, watchlist_payload, scope_label=scope_label, macro_context=macro_context)
        item_count_label = f"{len(portfolio_payload)}持仓, {len(watchlist_payload)}自选/板块"

    async def event_generator():
        fallback_sections = macro_context.get("meta", {}).get("fallback_sections", [])
        quality_preamble = ""
        if fallback_sections:
            quality_preamble = (
                f"> ⚠️ **数据质量提示**：{'、'.join(fallback_sections)}暂不可用，"
                "相应内容为演示回退数据。本报告不会基于该部分给出具体买卖、仓位或价格建议。\n\n"
            )
        report_text = quality_preamble
        if quality_preamble:
            yield quality_preamble
        async for chunk in MultiLLMEngine.generate_analysis_stream(db, prompt):
            report_text += chunk
            yield chunk

        # Auto save completed report to DB with Beijing Time (UTC+8)
        active_cfg = MultiLLMEngine.get_active_config(db)
        report = AnalysisReport(
            report_type="DAILY_PORTFOLIO",
            provider_model=active_cfg["model"],
            input_summary=f"{scope_label} ({item_count_label})",
            content_md=report_text,
            generated_at=bj_now()
        )
        db.add(report)
        db.commit()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/analyze/single/stream")
async def analyze_single_stock_stream(req: SingleStockAnalyzeRequest, db: Session = Depends(get_db)):
    """Stream AI diagnosis for a single stock with market macro & news context"""
    symbol = MarketDataService.format_symbol(req.symbol)
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    name = stock.name if stock else symbol
    indicators = MarketDataService.get_stock_indicators_summary(symbol, name)
    macro_context = MarketDataService.get_market_macro_context()

    prompt = MultiLLMEngine.build_single_stock_prompt(symbol, name, indicators, macro_context=macro_context)
    return StreamingResponse(MultiLLMEngine.generate_analysis_stream(db, prompt), media_type="text/event-stream")

@router.get("/reports/latest")
def get_latest_report(report_type: Optional[str] = None, db: Session = Depends(get_db)):
    """Get the latest analysis report by report_type"""
    query = db.query(AnalysisReport)
    if report_type:
        query = query.filter(AnalysisReport.report_type == report_type)
    report = query.order_by(AnalysisReport.generated_at.desc()).first()
    if not report:
        return {"status": "none", "report": None}
    dt_str = report.generated_at.strftime("%Y-%m-%d %H:%M:%S") if report.generated_at else ""
    return {
        "status": "success",
        "report": {
            "id": report.id,
            "report_type": report.report_type,
            "provider_model": report.provider_model,
            "input_summary": report.input_summary,
            "content_md": report.content_md,
            "generated_at": dt_str
        }
    }

@router.get("/reports")
def get_reports(limit: int = Query(10, le=50), db: Session = Depends(get_db)):

    """Get historical analysis reports with formatted Beijing Time (UTC+8)"""
    reports = db.query(AnalysisReport).order_by(AnalysisReport.generated_at.desc()).limit(limit).all()
    results = []
    for r in reports:
        dt_str = r.generated_at.strftime("%Y-%m-%d %H:%M:%S") if r.generated_at else ""
        results.append({
            "id": r.id,
            "report_type": r.report_type,
            "provider_model": r.provider_model,
            "input_summary": r.input_summary,
            "content_md": r.content_md,
            "generated_at": dt_str
        })
    return results

@router.get("/reports/{report_id}")
def get_report_detail(report_id: int, db: Session = Depends(get_db)):
    """Get single report detail"""
    report = db.query(AnalysisReport).filter(AnalysisReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    dt_str = report.generated_at.strftime("%Y-%m-%d %H:%M:%S") if report.generated_at else ""
    return {
        "id": report.id,
        "report_type": report.report_type,
        "provider_model": report.provider_model,
        "input_summary": report.input_summary,
        "content_md": report.content_md,
        "generated_at": dt_str
    }

class MemoryCreateRequest(BaseModel):
    content: str
    memory_type: Optional[str] = "USER_HABIT"
    importance: Optional[int] = 3

class ActivatePlaybookRequest(BaseModel):
    playbook_id: str

class ExtractRulesRequest(BaseModel):
    text: str
    title: Optional[str] = "战法心得文章"

def get_trade_context_for_agent(db: Session, limit_recent: int = 150):
    """
    Fetch dataset-wide summary statistics (FIFO P&L, win rate, P/L ratio, date range)
    plus expanded recent trade records sample (up to limit_recent, default 150).
    Prevents AI Agent from falsely assuming only 20-30 trades exist.
    """
    from routers.trades import calculate_trade_ledger

    all_records = db.query(TradeRecord).order_by(TradeRecord.trade_date.asc(), TradeRecord.id.asc()).all()
    total_count = len(all_records)
    
    if total_count == 0:
        summary_info = {
            "dataset_scope": "未找到交割单记录",
            "total_trades_count": 0,
            "date_range": "无交易数据"
        }
        return summary_info, [], set()

    start_date_str = all_records[0].trade_date.strftime("%Y-%m-%d") if all_records[0].trade_date else "未知"
    end_date_str = all_records[-1].trade_date.strftime("%Y-%m-%d") if all_records[-1].trade_date else "未知"

    ledger_stats = calculate_trade_ledger(all_records)
    
    symbol_counts = {}
    for r in all_records:
        stk_name = r.name or r.symbol
        symbol_counts[stk_name] = symbol_counts.get(stk_name, 0) + 1
    top_stocks = sorted(symbol_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    summary_info = {
        "dataset_scope": f"已成功装载用户全量历史交割单总计 {total_count} 笔交易记录",
        "date_range": f"{start_date_str} 至 {end_date_str}",
        "total_trades_count": total_count,
        "realized_pnl_fifo": ledger_stats.get("realized_pnl"),
        "win_rate": f"{ledger_stats.get('win_rate')}%",
        "profit_loss_ratio": ledger_stats.get("profit_loss_ratio"),
        "expectancy_per_trade": ledger_stats.get("expectancy"),
        "total_closed_trades": ledger_stats.get("total_closed_trades"),
        "total_fees": ledger_stats.get("total_fees"),
        "planned_execution_ratio": f"{ledger_stats.get('planned_ratio')}%",
        "most_frequently_traded_stocks": [f"{stk[0]} ({stk[1]}笔)" for stk in top_stocks]
    }

    recent_records = db.query(TradeRecord).order_by(TradeRecord.trade_date.desc(), TradeRecord.id.desc()).limit(limit_recent).all()
    trade_payload = []
    unique_symbols = set()
    for t in recent_records:
        unique_symbols.add(t.symbol)
        trade_payload.append({
            "symbol": t.symbol,
            "name": t.name,
            "trade_type": t.trade_type,
            "price": t.price,
            "volume": t.volume,
            "amount": t.amount,
            "strategy_reason": t.strategy_reason or "无说明",
            "trade_date": t.trade_date.strftime("%Y-%m-%d %H:%M:%S") if t.trade_date else ""
        })

    return summary_info, trade_payload, unique_symbols

class AgentChatMessage(BaseModel):
    role: str
    content: str

class AgentChatPayload(BaseModel):
    messages: List[AgentChatMessage]
    stock_context: Optional[str] = None


@router.post("/agent/chat-stream")
async def chat_with_agent_stream(payload: AgentChatPayload, db: Session = Depends(get_db)):
    """Stream multi-turn conversation with Trade Review Coach AI Agent with memory, real-time quotes & news injection"""
    # 1. Fetch user full trade dataset summary + expanded recent trade history (up to 150 trades)
    summary_info, trade_payload, _ = get_trade_context_for_agent(db, limit_recent=150)

    # 1.5. Fetch user account fund & capital allocation metrics
    from routers.account import get_account_fund_summary
    account_fund_info = get_account_fund_summary(db)

    # 2. Fetch user current positions with real-time quotes & market data
    positions = db.query(Position).all()
    pos_symbols = [p.symbol for p in positions]
    quotes_map = MarketDataService.get_batch_realtime_quotes(pos_symbols) if pos_symbols else {}
    
    pos_payload = []
    for p in positions:
        stock = db.query(Stock).filter(Stock.symbol == p.symbol).first()
        s_name = stock.name if stock else p.symbol
        q_info = quotes_map.get(p.symbol, {})
        pos_payload.append({
            "symbol": p.symbol,
            "name": q_info.get("name") or s_name,
            "cost_price": p.cost_price,
            "current_price": q_info.get("current_price", p.cost_price),
            "pct_chg": q_info.get("pct_chg", "0.00%"),
            "current_volume": p.current_volume,
            "strategy_tag": p.strategy_tag
        })

    # 3. Fetch Real-time Market Macro & News Context (Indices, Hot Sectors, Sina Financial News)
    macro_context = MarketDataService.get_market_macro_context()
    macro_block = MarketDataService.format_macro_prompt_block(macro_context)

    # 4. Dynamically detect mentioned stocks in user's message & fetch K-line indicators (or auto-fetch top holdings)
    import re
    last_user_text = payload.messages[-1].content if payload.messages else ""
    symbols_found = set(re.findall(r'\d{6}', last_user_text))
    
    # Also match by Chinese stock name in DB or common ETF names
    all_stocks = db.query(Stock).all()
    for stk in all_stocks:
        if stk.name and len(stk.name) >= 2 and stk.name in last_user_text:
            symbols_found.add(stk.symbol)

    # If no specific stock is mentioned in message, automatically add top 3 holding positions' K-line indicators!
    if not symbols_found and positions:
        for p in positions[:3]:
            symbols_found.add(p.symbol)

    queried_indicators = []
    for sym in list(symbols_found)[:5]:
        stk_info = MarketDataService.get_stock_indicators_summary(sym)
        if stk_info and "error" not in stk_info:
            queried_indicators.append(stk_info)
    
    queried_stock_block = ""
    if queried_indicators:
        queried_stock_block = f"""
### 📌 核心个股与持仓标的【实时 K 线与技术指标研判数据】(包含 MA5/10/20 均线、MACD, KDJ 及 30日支撑与压力位)：
{json.dumps(queried_indicators, ensure_ascii=False, indent=2)}
"""

    # 5. Fetch agent active memories (Master Playbooks & Lessons)
    memories_prompt = AgentMemoryService.format_memories_for_prompt(db)

    account_capital_prompt = f"""
【💰 用户账户总资金与资金流动性概览 (同花顺 9 项资金指标)】
- 💰 总资产: ¥{account_fund_info['total_assets']:,.2f} 元
- 💵 可用资金: ¥{account_fund_info['available_cash']:,.2f} 元 (资金余额: ¥{account_fund_info['cash_balance']:,.2f} 元, 可取: ¥{account_fund_info['withdrawable_cash']:,.2f} 元)
- 📈 股票市值: ¥{account_fund_info['market_value']:,.2f} 元
- 📊 当前仓位比例: {account_fund_info['position_ratio']} (持仓盈亏: ¥{account_fund_info['holding_pnl']:,.2f} 元, 当日盈亏: ¥{account_fund_info['daily_pnl']:,.2f} 元 [{account_fund_info['daily_pnl_pct']}])
- 🔒 冻结资金: ¥{account_fund_info['frozen_amount']:,.2f} 元

【💡 资金与仓位决策指导规则】：
在为用户提供加仓/建仓/减仓或资产配置建议时，你必须**严格结合用户上述真实的可用资金 (¥{account_fund_info['available_cash']:,.2f}) 与当前仓位比例 ({account_fund_info['position_ratio']})** 进行精细化仓位计算！例如：若建议建仓某只股票，请给出具体的【建议投入金额 (元)】与【建议买入股数】，并提醒用户保持合理的现金防御比例！
"""

    system_prompt = f"""你是一位专业的 A 股交易教练 AI Agent，具备深厚的量化操盘、实时行情研判、行为金融学与心态管理经验。

【⚠️ 最高权威指令 - 你的核心能力与数据全貌认知】
1. 你已经**完全掌握用户导入的全部历史交易账本与交割单数据全貌**！
   - 📊 用户全量历史交割单宏观数据汇总：
{json.dumps(summary_info, ensure_ascii=False, indent=2)}
   - 下方【用户近期交易明细日志】为你展示了最近 {len(trade_payload)} 笔成交记录。**请绝对不要误以为用户只导入了二三十笔交易**！你手里已握有全量 {summary_info.get('total_trades_count', len(trade_payload))} 笔交易（时间跨度 {summary_info.get('date_range', '全时间段')}）的准确胜率、盈亏比与 FIFO 累计盈亏！当用户询问“是否收到完整数据”或“分析3年操作”时，你必须非常清晰自信地指出你已掌控全量账本宏观数据及近期详细明细日志！

2. 你已经**全面接入并拥有获取 A 股全市场及 ETF 的实时价格、K 线图技术指标（MA5/10/20均线多空、MACD金叉死叉、KDJ摆动状态、支撑阻力位）以及联网大盘与财经新闻的能力**！
当用户询问你“能否获取实时价格和K线图”或“能否联网”时，你必须**非常明确且自信地回答**：
“完全可以！我已全面接入 A 股及 ETF 的实时价格行情、K 线均线系统（MA5/10/20）、MACD/KDJ 摆动指标以及大盘新闻快讯。您可以直接告诉我任何股票代码（如 159883、600519）或名称（如 医疗器械ETF、贵州茅台），我将立即为您调出最新的实时价格、K 线形态与买卖支撑位进行专业解读！”

3. **微信消息推送能力**：
你系统层面已完全支持将你的分析、复盘与策略总结实时发送到用户的个人微信（基于 Server酱 / PushPlus / 企业微信通道）！
当用户要求你“推送到微信”、“发送到微信”、“把总结/分析发到微信”、“微信推送”等请求时，你必须**非常自信地回答**：
“好的！我已将本次的操盘分析与策略总结实时发送至您的微信，请在手机微信中查收！”，并在回答第一行包含标识 `[WECHAT_PUSH_REQUESTED]`，随后随附整理好的【微信精简版复盘/策略卡片】。

{macro_block}
{account_capital_prompt}
{queried_stock_block}

【用户当前持仓 (包含实时报价与盈亏状态)】
{json.dumps(pos_payload, ensure_ascii=False, indent=2)}

【用户近期交易明细日志 (抽样最近 {len(trade_payload)} 笔交易)】
{json.dumps(trade_payload, ensure_ascii=False, indent=2)}

{memories_prompt}

请基于上述大盘宏观热点、实时行情与 K 线指标、全量交割单账本、账户资金全貌、持仓与认知战法，以专业、沉稳、建设性的语气同用户进行对话。如果用户询问某只股票或具体盘口，请直接引用提供的最新行情指标与大盘热点给出犀利而精准的解答！
"""

    messages_payload = [{"role": msg.role, "content": msg.content} for msg in payload.messages]

    async def event_generator():
        response_text = ""
        async for chunk in MultiLLMEngine.generate_chat_stream(db, messages_payload, system_prompt):
            if chunk:
                response_text += chunk
                yield chunk

        # Check if user requested push to WeChat or tag emitted
        last_user_msg = payload.messages[-1].content if payload.messages else ""
        if "[WECHAT_PUSH_REQUESTED]" in response_text or any(k in last_user_msg for k in ["推送到微信", "发送到微信", "微信推送", "发到微信", "发微信"]):
            push_cfg = db.query(PushConfig).first()
            if push_cfg and push_cfg.is_enabled and push_cfg.secret_key:
                try:
                    clean_push_content = response_text.replace("[WECHAT_PUSH_REQUESTED]", "").strip()
                    await send_wechat_notification(
                        title=f"🤖 AI 交易教练对话研判 ({bj_now().strftime('%H:%M')})",
                        content_md=clean_push_content,
                        channel=push_cfg.channel,
                        secret_key=push_cfg.secret_key
                    )
                except Exception:
                    pass

        # Trigger background auto memory evolution if meaningful
        if len(response_text) > 30 and len(payload.messages) > 0:
            conversation_snippet = f"用户问：{last_user_msg}\nAgent答：{response_text}"
            AgentMemoryService.auto_extract_and_evolve(db, conversation_snippet, source_label="Agent 交互对话")

    return StreamingResponse(event_generator(), media_type="text/event-stream")



@router.post("/agent/review-stream")
async def review_trades_agent_stream(db: Session = Depends(get_db)):
    """Stream Trade Review Agent analysis with memory injection & auto-evolution"""
    summary_info, trade_payload, unique_symbols = get_trade_context_for_agent(db, limit_recent=150)

    # Fetch real-time indicators summary for all traded stocks
    traded_stocks_indicators = {}
    for sym in list(unique_symbols)[:8]:
        stk_info = MarketDataService.get_stock_indicators_summary(sym)
        if stk_info and "error" not in stk_info:
            traded_stocks_indicators[sym] = stk_info

    positions = db.query(Position).all()
    pos_payload = []
    for p in positions:
        stock = db.query(Stock).filter(Stock.symbol == p.symbol).first()
        pos_payload.append({
            "symbol": p.symbol,
            "name": stock.name if stock else p.symbol,
            "cost_price": p.cost_price,
            "current_volume": p.current_volume,
            "strategy_tag": p.strategy_tag
        })

    macro_context = MarketDataService.get_market_macro_context()
    from routers.account import get_account_fund_summary
    account_fund_info = get_account_fund_summary(db)

    prompt = MultiLLMEngine.build_trade_review_prompt(
        db, 
        trade_payload, 
        pos_payload, 
        macro_context=macro_context,
        traded_stocks_indicators=traded_stocks_indicators,
        summary_info=summary_info,
        account_fund_info=account_fund_info
    )

    async def event_generator():
        report_text = ""
        async for chunk in MultiLLMEngine.generate_analysis_stream(
            db, 
            prompt, 
            system_prompt="你是一位专业的 A 股量化交易复盘教练，性格犀利客观，擅长分析用户心理与操盘胜率，帮用户改进交易习惯。"
        ):
            report_text += chunk
            yield chunk

        active_cfg = MultiLLMEngine.get_active_config(db)
        total_rec_count = summary_info.get("total_trades_count", len(trade_payload))
        report = AnalysisReport(
            report_type="TRADE_REVIEW_AGENT",
            provider_model=active_cfg["model"],
            input_summary=f"复盘 Agent 诊断 (全量{total_rec_count}笔交割单, 抽样{len(trade_payload)}笔明细, {len(pos_payload)}持仓)",
            content_md=report_text,
            generated_at=bj_now()
        )
        db.add(report)
        db.commit()

        # Trigger Memory Evolution to learn from this session!
        AgentMemoryService.auto_extract_and_evolve(db, report_text, source_label=f"复盘报告 #{report.id}")

        # Check WeChat Auto Push Config
        push_cfg = db.query(PushConfig).first()
        if push_cfg and push_cfg.is_enabled and push_cfg.auto_push_review and push_cfg.secret_key:
            try:
                await send_wechat_notification(
                    title=f"📊 AI 交易复盘报告 ({bj_now().strftime('%Y-%m-%d %H:%M')})",
                    content_md=report_text,
                    channel=push_cfg.channel,
                    secret_key=push_cfg.secret_key
                )
            except Exception:
                pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/push-review")
async def push_review_to_wechat(req: PushReviewRequest, db: Session = Depends(get_db)):
    """Push a review report or custom markdown to configured WeChat channel"""
    push_cfg = db.query(PushConfig).first()
    if not push_cfg or not push_cfg.is_enabled or not push_cfg.secret_key:
        raise HTTPException(status_code=400, detail="未开启微信消息推送，请先在设置中填入 SendKey 或 Token 并保存开启")

    content = req.content_md
    if not content and req.report_id:
        rpt = db.query(AnalysisReport).filter(AnalysisReport.id == req.report_id).first()
        if rpt:
            content = rpt.content_md

    if not content:
        last_rpt = db.query(AnalysisReport).filter(AnalysisReport.report_type == "TRADE_REVIEW_AGENT").order_by(AnalysisReport.generated_at.desc()).first()
        if last_rpt:
            content = last_rpt.content_md

    if not content:
        raise HTTPException(status_code=404, detail="未找到可推送的复盘报告内容")

    res = await send_wechat_notification(
        title=req.title or "📊 AI 股票交易复盘诊断报告",
        content_md=content,
        channel=push_cfg.channel,
        secret_key=push_cfg.secret_key
    )
    return res


@router.get("/agent/memories")
def get_agent_memories(limit: int = Query(50, le=100), db: Session = Depends(get_db)):
    """Fetch Agent memory bank items"""
    return AgentMemoryService.get_all_memories(db, limit=limit)

@router.post("/agent/memories")
def create_agent_memory(payload: MemoryCreateRequest, db: Session = Depends(get_db)):
    """Manually add an Agent memory entry"""
    mem = AgentMemoryService.add_memory(
        db=db,
        content=payload.content,
        memory_type=payload.memory_type or "USER_HABIT",
        importance=payload.importance or 3,
        source_info="用户手动添加"
    )
    return {"status": "success", "id": mem.id}

@router.delete("/agent/memories/{memory_id}")
def delete_agent_memory(memory_id: int, db: Session = Depends(get_db)):
    """Delete an Agent memory entry"""
    success = AgentMemoryService.delete_memory(db, memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "success", "deleted_id": memory_id}

@router.get("/agent/playbooks")
def get_preset_playbooks(db: Session = Depends(get_db)):
    """Fetch preset master playbooks with activation state"""
    active_mems = db.query(AgentMemory).filter(
        AgentMemory.agent_name == AgentMemoryService.AGENT_NAME,
        AgentMemory.memory_type == "MASTER_PLAYBOOK"
    ).all()
    active_contents = {m.content.strip() for m in active_mems}

    playbooks = []
    for pb in AgentMemoryService.PRESET_PLAYBOOKS:
        is_active = pb["content"].strip() in active_contents
        playbooks.append({
            **pb,
            "is_activated": is_active
        })
    return playbooks

@router.post("/agent/playbooks/activate")
def activate_playbook(payload: ActivatePlaybookRequest, db: Session = Depends(get_db)):
    """Activate a preset master playbook into Agent long-term memory"""
    pb = next((p for p in AgentMemoryService.PRESET_PLAYBOOKS if p["id"] == payload.playbook_id), None)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook not found")

    mem = AgentMemoryService.add_memory(
        db=db,
        content=pb["content"],
        memory_type="MASTER_PLAYBOOK",
        importance=5,
        source_info=f"预置战法:{pb['name']}"
    )
    return {"status": "success", "message": f"已成功将【{pb['name']}】激活注入为 Agent 顶级指导战法！", "id": mem.id}

@router.post("/agent/extract-rules")
async def extract_rules_from_text(payload: ExtractRulesRequest, db: Session = Depends(get_db)):
    """Extract actionable trading rules from text/article using LLM and save into Agent memory"""
    if not payload.text or len(payload.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="文本长度不足，请输入有效的战法/心得内容")

    extracted_rules = await MultiLLMEngine.extract_master_rules_from_text(db, payload.text)
    
    saved_mems = []
    source_label = payload.title or "战法心得文章"
    for rule in extracted_rules:
        mem = AgentMemoryService.add_memory(
            db=db,
            content=rule,
            memory_type="MASTER_PLAYBOOK",
            importance=5,
            source_info=f"文章萃取:{source_label}"
        )
        saved_mems.append({"id": mem.id, "content": mem.content})

    return {
        "status": "success",
        "extracted_rules": extracted_rules,
        "saved_memories": saved_mems
    }

def auto_sync_screener_recommendations_to_watchlist(db: Session, report_text: str, candidate_items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Automatically parse recommended stocks from Screener AI report and sync into Watchlist under '🤖 AI 精选建仓' category
    """
    category_name = "🤖 AI 精选建仓"
    
    # Extract Section 1 (精选标的推荐)
    target_section = report_text
    if "1. 顶尖战法" in report_text:
        parts = report_text.split("1. 顶尖战法", 1)
        if len(parts) > 1:
            target_section = parts[1].split("2. 战法契合度", 1)[0]

    added_items = []
    
    for item in candidate_items:
        sym = item.get("symbol")
        name = item.get("name")
        if not sym:
            continue
            
        symbol_matched = bool(sym and sym in target_section)
        name_matched = bool(name and len(name) >= 2 and name in target_section)

        if symbol_matched or name_matched:
            w = db.query(Watchlist).filter(Watchlist.symbol == sym).first()
            if w:
                w.category = category_name
                w.remark = f"AI智能选股推选建仓标的 ({bj_now().strftime('%m-%d %H:%M')})"
            else:
                w = Watchlist(
                    symbol=sym,
                    category=category_name,
                    remark=f"AI智能选股推选建仓标的 ({bj_now().strftime('%m-%d %H:%M')})"
                )
                db.add(w)
            
            added_items.append({"symbol": sym, "name": name or sym})

    if added_items:
        db.commit()

    return added_items


@router.post("/screener/run-stream")
async def run_stock_screener_agent_stream(db: Session = Depends(get_db)):
    """Stream Stock & ETF Screener Agent recommendation report with parallel indicators fetching & real-time progress updates"""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    watchlists = db.query(Watchlist).all()
    positions = db.query(Position).all()
    all_stocks = {s.symbol: s.name for s in db.query(Stock).all()}

    symbols_map = {}
    for w in watchlists:
        symbols_map[w.symbol] = w.category or "自选股"
    for p in positions:
        if p.symbol not in symbols_map:
            symbols_map[p.symbol] = "持仓股"

    total_candidates = len(symbols_map)
    user_rules_text = AgentMemoryService.format_memories_for_prompt(db)
    macro_context = MarketDataService.get_market_macro_context()

    async def event_generator():
        # 1. Yield clean initial status banner to frontend
        yield f"> 📡 **智能选股 Agent 已启动**：正在利用 12 线程并发引擎扫描全量 **{total_candidates}** 只候选标的（自选/持仓）的实时行情、MA 均线、MACD 与 30 日支撑/压力位...\n\n"

        if total_candidates == 0:
            yield "⚠️ **选股提示**: 当前自选股与持仓列表中暂无标的。请先在【自选股/板块】中添加关注标的，智能选股 Agent 才能为您匹配战法推选！"
            return

        # 2. Pre-fetch batch quotes in 1 single HTTP request (~50ms)
        all_syms = list(symbols_map.keys())
        MarketDataService.get_batch_realtime_quotes(all_syms)

        # 3. Parallel fetch stock indicators using ThreadPoolExecutor
        loop = asyncio.get_running_loop()
        watchlist_items = []

        def fetch_single(sym: str, cat: str):
            name = all_stocks.get(sym) or MarketDataService.get_stock_name(sym)
            ind = MarketDataService.get_stock_indicators_summary(sym, name)
            ind["category"] = cat
            return ind

        with ThreadPoolExecutor(max_workers=min(12, max(1, total_candidates))) as executor:
            tasks = [
                loop.run_in_executor(executor, fetch_single, sym, cat)
                for sym, cat in symbols_map.items()
            ]
            # Gather all completed indicators without polluting markdown text
            watchlist_items = await asyncio.gather(*tasks)

        yield f"> 🧠 **行情研判全量就绪**！正在对标【顶级战法库】与【全场大盘/热点风向】精选优质建仓标的...\n\n---\n\n"

        from routers.account import get_account_fund_summary
        account_fund_info = get_account_fund_summary(db)

        # 4. Construct prompt and stream LLM response
        prompt = MultiLLMEngine.build_stock_screener_prompt(
            watchlist_items, 
            user_rules_text, 
            macro_context=macro_context,
            account_fund_info=account_fund_info
        )

        report_text = ""
        async for chunk in MultiLLMEngine.generate_analysis_stream(
            db, 
            prompt,
            system_prompt="你是一位专业的 A 股量化选股专家与策略风控教练，严苛匹配筛选规则，重视操作纪律。"
        ):
            if chunk:
                report_text += chunk
                yield chunk

        # Auto sync recommended stocks into Watchlist under category "🤖 AI 精选建仓"
        synced_stocks = auto_sync_screener_recommendations_to_watchlist(db, report_text, watchlist_items)
        if synced_stocks:
            stock_names_str = "、".join([f"**{s['name']} ({s['symbol']})**" for s in synced_stocks])
            sync_notice = f"\n\n---\n\n> ✨ **自选板块自动打标与同步通知**：系统已自动将 AI 匹配精选的建仓标的 {stock_names_str} 添加/同步至自选板块【**🤖 AI 精选建仓**】中！您可随时在“持仓与自选管理”板块中集中监控其最新走势与买点！\n"
            report_text += sync_notice
            yield sync_notice

        # Auto save completed report to DB
        active_cfg = MultiLLMEngine.get_active_config(db)
        report = AnalysisReport(
            report_type="STOCK_SCREENER_AGENT",
            provider_model=active_cfg["model"],
            input_summary=f"智能选股 Agent ({len(watchlist_items)}只自选/持仓股筛选)",
            content_md=report_text,
            generated_at=bj_now()
        )
        db.add(report)
        db.commit()

        AgentMemoryService.auto_extract_and_evolve(db, report_text, source_label="选股 Agent 每日推选")

    return StreamingResponse(event_generator(), media_type="text/event-stream")

