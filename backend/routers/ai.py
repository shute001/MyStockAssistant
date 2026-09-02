import json
import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, Position, Watchlist, Stock, AnalysisReport, TradeRecord, bj_now
from services.market_data import MarketDataService
from services.llm_engine import MultiLLMEngine
from services.agent_memory import AgentMemoryService


router = APIRouter(prefix="/ai", tags=["AI Stock Analysis"])

class SingleStockAnalyzeRequest(BaseModel):
    symbol: str

class PortfolioAnalyzeRequest(BaseModel):
    scope: Optional[str] = "ALL"  # "ALL" | "POSITIONS_ONLY" | "CATEGORY:板块名"

@router.post("/analyze/portfolio/stream")
async def analyze_portfolio_stream(req: Optional[PortfolioAnalyzeRequest] = None, db: Session = Depends(get_db)):
    """Stream AI analysis for portfolio / specific sectors"""
    scope = req.scope if (req and req.scope) else "ALL"
    
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
        prompt = MultiLLMEngine.build_single_stock_prompt(symbol, name, indicators)
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

        prompt = MultiLLMEngine.build_portfolio_prompt(portfolio_payload, watchlist_payload, scope_label=scope_label)
        item_count_label = f"{len(portfolio_payload)}持仓, {len(watchlist_payload)}自选/板块"

    async def event_generator():
        report_text = ""
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
    """Stream AI diagnosis for a single stock"""
    symbol = MarketDataService.format_symbol(req.symbol)
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    name = stock.name if stock else symbol
    indicators = MarketDataService.get_stock_indicators_summary(symbol, name)

    prompt = f"""请对 A 股个股【{name} ({symbol})】进行深度个股诊断。
技术与基本面行情数据如下：
{json.dumps(indicators, ensure_ascii=False, indent=2)}

请输出：
1. 【技术面与指标态势】：结合均线系统、MACD、KDJ。
2. 【关键支撑位与阻力位】：结合当前价格（{indicators.get('current_price')}元）分析支撑位（{indicators.get('support_price')}元）与压力位（{indicators.get('resistance_price')}元）。
3. 【博弈与买卖策略建议】：短线与中线操盘纪律。
"""
    return StreamingResponse(MultiLLMEngine.generate_analysis_stream(db, prompt), media_type="text/event-stream")

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

class AgentChatMessage(BaseModel):
    role: str
    content: str

class AgentChatPayload(BaseModel):
    messages: List[AgentChatMessage]
    stock_context: Optional[str] = None


@router.post("/agent/chat-stream")
async def chat_with_agent_stream(payload: AgentChatPayload, db: Session = Depends(get_db)):
    """Stream multi-turn conversation with Trade Review Coach AI Agent with memory injection"""
    # 1. Fetch user recent trade history (last 20 trades)
    trades = db.query(TradeRecord).order_by(TradeRecord.trade_date.desc()).limit(20).all()
    trade_payload = []
    for t in trades:
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

    # 2. Fetch user current positions
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

    # 3. Fetch agent active memories
    memories_prompt = AgentMemoryService.format_memories_for_prompt(db)

    system_prompt = f"""你是一位专业的 A 股交易教练 AI Agent，具备深厚的量化操盘、行为金融学与心态管理经验。
你长期观察并记录用户的真实交易历史与操作偏好，负责耐心地与用户对话答疑、诊断其交易心理、分析操作盲点并给出犀利而建设性的改进建议。

【用户当前持仓】
{json.dumps(pos_payload, ensure_ascii=False, indent=2)}

【用户近期交易历史记录】
{json.dumps(trade_payload, ensure_ascii=False, indent=2)}

{memories_prompt}

请基于上述持仓、历史交割单和认知记忆，以专业、沉稳、建设性的语气同用户进行对话，直接回答用户的提问，指出其可能存在的操盘陷阱（如频繁交易、追高被套、重仓不止损等），并给出可落地的改善动作。语气平易近人且富有洞察力。
"""


    messages_payload = [{"role": msg.role, "content": msg.content} for msg in payload.messages]

    async def event_generator():
        response_text = ""
        async for chunk in MultiLLMEngine.generate_chat_stream(db, messages_payload, system_prompt):
            if chunk:
                response_text += chunk
                yield chunk


        # Trigger background auto memory evolution if meaningful
        if len(response_text) > 30 and len(payload.messages) > 0:
            last_user_msg = payload.messages[-1].content
            conversation_snippet = f"用户问：{last_user_msg}\nAgent答：{response_text}"
            AgentMemoryService.auto_extract_and_evolve(db, conversation_snippet, source_label="Agent 交互对话")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/agent/review-stream")

async def review_trades_agent_stream(db: Session = Depends(get_db)):
    """Stream Trade Review Agent analysis with memory injection & auto-evolution"""
    trades = db.query(TradeRecord).order_by(TradeRecord.trade_date.desc()).limit(30).all()
    trade_payload = []
    for t in trades:
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

    prompt = MultiLLMEngine.build_trade_review_prompt(db, trade_payload, pos_payload)

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
        report = AnalysisReport(
            report_type="TRADE_REVIEW_AGENT",
            provider_model=active_cfg["model"],
            input_summary=f"复盘 Agent 诊断 ({len(trade_payload)}笔交易, {len(pos_payload)}持仓)",
            content_md=report_text,
            generated_at=bj_now()
        )
        db.add(report)
        db.commit()

        # Trigger Memory Evolution to learn from this session!
        AgentMemoryService.auto_extract_and_evolve(db, report_text, source_label=f"复盘报告 #{report.id}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")

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

@router.post("/screener/run-stream")
async def run_stock_screener_agent_stream(db: Session = Depends(get_db)):
    """Stream Stock & ETF Screener Agent recommendation report based on Watchlist & User Rules"""
    watchlists = db.query(Watchlist).all()
    positions = db.query(Position).all()

    symbols_map = {}
    for w in watchlists:
        symbols_map[w.symbol] = w.category or "自选股"
    for p in positions:
        if p.symbol not in symbols_map:
            symbols_map[p.symbol] = "持仓股"

    watchlist_items = []
    for sym, cat in symbols_map.items():
        stock = db.query(Stock).filter(Stock.symbol == sym).first()
        name = stock.name if stock else sym
        indicators = MarketDataService.get_stock_indicators_summary(sym, name)
        indicators["category"] = cat
        watchlist_items.append(indicators)

    user_rules_text = AgentMemoryService.format_memories_for_prompt(db)
    prompt = MultiLLMEngine.build_stock_screener_prompt(watchlist_items, user_rules_text)

    async def event_generator():
        report_text = ""
        async for chunk in MultiLLMEngine.generate_analysis_stream(
            db, 
            prompt,
            system_prompt="你是一位专业的 A 股量化选股专家与策略风控教练，严苛匹配筛选规则，重视操作纪律。"
        ):
            if chunk:
                report_text += chunk
                yield chunk

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


