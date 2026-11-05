import json

import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from fastapi.responses import StreamingResponse

from sqlalchemy.orm import Session

from pydantic import BaseModel

from typing import Optional, List

from database import get_db, Position, Watchlist, Stock, AnalysisReport, TradeRecord, AgentMemory, PushConfig, ScreenerStrategyConfig, StrategyWeightRecord, bj_now

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

        def is_valid_symbol(s: str) -> bool:

            s_str = str(s).strip()

            return bool(s_str and len(s_str) == 6 and s_str.isdigit() and s_str != "830000")

        if scope == "ALL":

            raw_positions = db.query(Position).filter(Position.current_volume > 0).all()

            raw_watchlists = db.query(Watchlist).all()

            scope_label = "全仓与全部自选"

        elif scope == "POSITIONS_ONLY":

            raw_positions = db.query(Position).filter(Position.current_volume > 0).all()

            raw_watchlists = []

            scope_label = "我的持仓股专项"

        elif scope == "HORIZON:SHORT":

            raw_positions = db.query(Position).filter(

                Position.current_volume > 0,

                (Position.strategy_tag.like("%短%") | Position.strategy_tag.like("%高吸%") | Position.strategy_tag.like("%博弈%"))

            ).all()

            raw_watchlists = db.query(Watchlist).filter(

                Watchlist.category.like("%短%") | Watchlist.category.like("%龙头%") | Watchlist.category.like("%突破%")

            ).all()

            scope_label = "⚡ 短线博弈专项诊断"

        elif scope == "HORIZON:MID":

            raw_positions = db.query(Position).filter(

                Position.current_volume > 0,

                (Position.strategy_tag.like("%中%") | Position.strategy_tag.like("%波段%") | Position.strategy_tag.like("%趋势%"))

            ).all()

            raw_watchlists = db.query(Watchlist).filter(

                Watchlist.category.like("%中%") | Watchlist.category.like("%波段%") | Watchlist.category.like("%趋势%")

            ).all()

            scope_label = "📈 中线波段趋势专项诊断"

        elif scope == "HORIZON:LONG":

            raw_positions = db.query(Position).filter(

                Position.current_volume > 0,

                (Position.strategy_tag.like("%长%") | Position.strategy_tag.like("%定投%") | Position.strategy_tag.like("%价值%") | Position.strategy_tag.like("%底仓%"))

            ).all()

            raw_watchlists = db.query(Watchlist).filter(

                Watchlist.category.like("%长%") | Watchlist.category.like("%定投%") | Watchlist.category.like("%红利%") | Watchlist.category.like("%ETF%")

            ).all()

            scope_label = "🌱 长线定投与价值专项诊断"

        elif scope.startswith("CATEGORY:"):

            from routers.stocks import normalize_categories

            cat_name = scope.split("CATEGORY:", 1)[1].strip()

            all_w = db.query(Watchlist).all()

            raw_watchlists = [w for w in all_w if cat_name in normalize_categories(w.category)]

            # Cross-reference user holding positions

            held_positions = db.query(Position).filter(Position.current_volume > 0).all()

            pos_by_sym = {p.symbol: p for p in held_positions}

            raw_positions = [pos_by_sym[w.symbol] for w in raw_watchlists if w.symbol in pos_by_sym]

            # Also check if any active position stock matches category

            for p in held_positions:

                stk = db.query(Stock).filter(Stock.symbol == p.symbol).first()

                if stk and stk.industry and (cat_name in stk.industry or stk.industry in cat_name):

                    if not any(w.symbol == p.symbol for w in raw_watchlists):

                        raw_watchlists.append(Watchlist(symbol=p.symbol, category=cat_name))

                        if p not in raw_positions:

                            raw_positions.append(p)

            is_industry = any(kw in cat_name for kw in ["板块", "行业", "概念", "赛道", "半导体", "医药", "芯片", "新能源", "电力", "消费", "军工", "地产", "白酒"])

            scope_label = f"【{cat_name}】板块专项" if is_industry else f"【{cat_name}】自选观察池"

        else:

            raw_positions = db.query(Position).filter(Position.current_volume > 0).all()

            raw_watchlists = db.query(Watchlist).all()

            scope_label = "全仓与全部自选"

        # 1. Filter valid positions and unique by symbol

        seen_pos = set()

        positions = []

        for p in raw_positions:

            if is_valid_symbol(p.symbol) and p.symbol not in seen_pos:

                seen_pos.add(p.symbol)

                positions.append(p)

        pos_symbols = {p.symbol for p in positions}

        # 2. Filter valid watchlists, deduplicate by symbol, and exclude positions in ALL scope

        seen_watch = set()

        watchlists = []

        for w in raw_watchlists:

            if not is_valid_symbol(w.symbol):

                continue

            if scope == "ALL" and w.symbol in pos_symbols:

                # Exclude already-held positions from watchlist to prevent redundant duplicate diagnosis

                continue

            if w.symbol not in seen_watch:

                seen_watch.add(w.symbol)

                watchlists.append(w)

        portfolio_payload = []

        for pos in positions:

            stock = db.query(Stock).filter(Stock.symbol == pos.symbol).first()

            name = stock.name if stock else pos.symbol

            indicators = MarketDataService.get_stock_indicators_summary(pos.symbol, name, db=db)

            indicators["cost_price"] = pos.cost_price

            indicators["current_volume"] = pos.current_volume

            curr_p = indicators.get("current_price") or pos.cost_price or 0.0

            val = round(curr_p * pos.current_volume, 2)

            cost_val = round((pos.cost_price or 0.0) * pos.current_volume, 2)

            indicators["market_value"] = val

            indicators["profit_loss"] = round(val - cost_val, 2)

            indicators["profit_ratio"] = f"{round(((curr_p - pos.cost_price)/pos.cost_price * 100), 2)}%" if pos.cost_price else "0.00%"

            indicators["strategy_tag"] = pos.strategy_tag or "持仓"

            portfolio_payload.append(indicators)

        # Cross-reference with all active positions for user_holding information

        all_active_positions = db.query(Position).filter(Position.current_volume > 0).all()

        pos_by_sym = {p.symbol: p for p in all_active_positions}

        watchlist_payload = []

        for w in watchlists:

            stock = db.query(Stock).filter(Stock.symbol == w.symbol).first()

            name = stock.name if stock else w.symbol

            indicators = MarketDataService.get_stock_indicators_summary(w.symbol, name, db=db)

            indicators["category"] = w.category

            indicators["target_buy_price"] = getattr(w, "target_buy_price", None)

            indicators["stop_loss_price"] = getattr(w, "stop_loss_price", None)

            indicators["remark"] = getattr(w, "remark", None)

            # Cross-reference user's actual holding position

            if w.symbol in pos_by_sym:

                p = pos_by_sym[w.symbol]

                curr_p = indicators.get("current_price") or p.cost_price or 0.0

                val = round(curr_p * p.current_volume, 2)

                cost_val = round((p.cost_price or 0.0) * p.current_volume, 2)

                indicators["user_holding"] = {

                    "is_held": True,

                    "cost_price": p.cost_price,

                    "current_volume": p.current_volume,

                    "market_value": val,

                    "profit_loss": round(val - cost_val, 2),

                    "profit_ratio": f"{round(((curr_p - p.cost_price)/p.cost_price * 100), 2)}%" if p.cost_price else "0.00%",

                    "strategy_tag": p.strategy_tag or "持仓"

                }

            else:

                indicators["user_holding"] = {

                    "is_held": False,

                    "status": "观察中未建仓"

                }

            watchlist_payload.append(indicators)

        prompt = MultiLLMEngine.build_portfolio_prompt(portfolio_payload, watchlist_payload, scope_label=scope_label, macro_context=macro_context)

        if scope == "POSITIONS_ONLY":

            item_count_label = f"{len(portfolio_payload)}只持仓股专项"

            if len(portfolio_payload) == 0:

                async def empty_positions_generator():

                    msg = "> 💡 **持仓提示**：您当前账户中暂无活跃持仓股票（持仓股数均为 0 或已全部清仓）。\n\n请先在【持仓管理】中录入您的买入持仓，或通过【交易记录】同步交易后，再发起持仓股专项深度量化诊断。"

                    yield msg

                return StreamingResponse(empty_positions_generator(), media_type="text/event-stream")

        elif scope.startswith("HORIZON:"):

            item_count_label = f"{len(portfolio_payload)}持仓, {len(watchlist_payload)}自选"

            if len(portfolio_payload) == 0 and len(watchlist_payload) == 0:

                async def empty_horizon_generator():

                    msg = f"> 💡 **投资周期提示**：当前在【{scope_label}】下未检索到被标记为对应周期策略的标的。\n\n建议前往【持仓管理】为持仓标的设定【投资周期标签】（如⚡短线博弈、📈中线波段、🌱长线定投），或在自选股中归类后再发起专项诊断。"

                    yield msg

                return StreamingResponse(empty_horizon_generator(), media_type="text/event-stream")

        elif scope.startswith("CATEGORY:"):

            item_count_label = f"{len(watchlist_payload)}只板块标的"

            if len(watchlist_payload) == 0:

                async def empty_category_generator():

                    msg = f"> 💡 **板块诊断提示**：当前在分类【{cat_name}】下暂无股票标的。\n\n建议前往【自选股池】将关注的股票归入【{cat_name}】分类，或在自选股卡片中修改分类标签后再发起板块专项诊断。"

                    yield msg

                return StreamingResponse(empty_category_generator(), media_type="text/event-stream")

        else:

            item_count_label = f"{len(portfolio_payload)}持仓, {len(watchlist_payload)}自选"

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

    category: Optional[str] = "SHORT_TERM"

class ActivatePlaybookRequest(BaseModel):

    playbook_id: str

class ExtractRulesRequest(BaseModel):

    text: str

    title: Optional[str] = "战法心得文章"

class ApplyOptimizationRequest(BaseModel):

    delete_ids: List[int] = []

    merged_items: Optional[List[dict]] = []

    enhanced_items: Optional[List[dict]] = []

    recommended_items: Optional[List[dict]] = []

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

    now = bj_now()

    now_date = now.date()

    this_week_monday = now_date - datetime.timedelta(days=now.weekday())

    last_week_monday = this_week_monday - datetime.timedelta(days=7)

    recent_records = db.query(TradeRecord).order_by(TradeRecord.trade_date.desc(), TradeRecord.id.desc()).limit(limit_recent).all()

    

    this_week_count = 0

    last_week_count = 0

    days_since_last_trade = (now_date - recent_records[0].trade_date.date()).days if (recent_records and recent_records[0].trade_date) else 999

    latest_rec = recent_records[0] if recent_records else None

    latest_str = f"{latest_rec.trade_date.strftime('%Y-%m-%d')} ({latest_rec.name} {latest_rec.trade_type})" if (latest_rec and latest_rec.trade_date) else "暂无"

    trade_payload = []

    unique_symbols = set()

    for t in recent_records:

        unique_symbols.add(t.symbol)

        t_d = t.trade_date.date() if t.trade_date else None

        if t_d and t_d >= this_week_monday:

            period_tag = "本周交易"

            this_week_count += 1

        elif t_d and t_d >= last_week_monday:

            period_tag = "上周交易"

            last_week_count += 1

        else:

            period_tag = "历史代表交易"

        trade_payload.append({

            "symbol": t.symbol,

            "name": t.name,

            "trade_type": t.trade_type,

            "price": t.price,

            "volume": t.volume,

            "amount": t.amount,

            "strategy_reason": t.strategy_reason or "无说明",

            "trade_date": t.trade_date.strftime("%Y-%m-%d %H:%M:%S") if t.trade_date else "",

            "period_tag": period_tag

        })

    summary_info["timing_context"] = {

        "current_review_date": now.strftime("%Y-%m-%d"),

        "this_week_range": f"{this_week_monday.strftime('%Y-%m-%d')} 至 {now_date.strftime('%Y-%m-%d')}",

        "this_week_trades_count": this_week_count,

        "last_week_trades_count": last_week_count,

        "days_since_last_trade": days_since_last_trade,

        "latest_trade_summary": latest_str

    }

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

    positions = db.query(Position).filter(Position.current_volume > 0).all()

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

    # 2.5. Fetch user Watchlist Categories & Sector Pools (本地自选板块与分类股票池)

    from routers.stocks import normalize_categories

    all_watchlists = db.query(Watchlist).all()

    all_stocks = db.query(Stock).all()

    stock_name_map = {s.symbol: s.name for s in all_stocks if s.name}

    category_map: Dict[str, List[Any]] = {}

    for w in all_watchlists:

        cats = normalize_categories(w.category)

        for cat in cats:

            cat_name = cat.strip()

            if not cat_name:

                continue

            if cat_name not in category_map:

                category_map[cat_name] = []

            category_map[cat_name].append(w)

    # 3. Fetch Real-time Market Macro & News Context (Indices, Hot Sectors, Sina Financial News)

    macro_context = MarketDataService.get_market_macro_context()

    macro_block = MarketDataService.format_macro_prompt_block(macro_context)

    # 4. Dynamically detect mentioned stocks & sectors/categories in user's message

    import re

    last_user_text = payload.messages[-1].content if payload.messages else ""

    symbols_found = set(re.findall(r'\d{6}', last_user_text))

    # Also incorporate stock_context from frontend if provided

    if payload.stock_context:

        ctx_syms = re.findall(r'\d{6}', payload.stock_context)

        for cs in ctx_syms:

            symbols_found.add(cs)

        if not ctx_syms:

            for item in MarketDataService.search_stock_by_query(payload.stock_context):

                symbols_found.add(item["symbol"])

    

    # Match by Chinese stock name in DB

    for stk in all_stocks:

        if stk.name and len(stk.name) >= 2 and stk.name in last_user_text:

            symbols_found.add(stk.symbol)

    # Match against known common cache

    for sym, s_name in MarketDataService._STOCK_NAME_CACHE.items():

        if s_name in last_user_text:

            symbols_found.add(sym)

    # Fuzzy search using Smartbox for Chinese words mentioned in message

    potential_words = re.findall(r'[\u4e00-\u9fa5A-Za-z0-9]{2,8}', last_user_text)

    if len(symbols_found) < 3:

        skip_words = {"分析", "股票", "今日", "现在", "走势", "指标", "看看", "怎么样", "买入", "卖出", "建仓", "行情", "技术", "教练", "策略", "这个", "那个", "建议", "复盘", "持仓", "自选"}

        for word in potential_words:

            if word in skip_words or len(word) < 2:

                continue

            hits = MarketDataService.search_stock_by_query(word)

            for h in hits:

                if word in h["name"] or h["name"] in word or h["name"] in last_user_text:

                    symbols_found.add(h["symbol"])

                    break

            if len(symbols_found) >= 3:

                break

    # 4.5. Detect plate/sector/category queries and assemble local sector context

    is_asking_plate = any(k in last_user_text for k in ["板块", "自选", "分组", "分类", "股票池", "池子", "自选股", "标的池", "自选池"])

    matched_categories = []

    for cat_name in category_map.keys():

        clean_cat = re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]', '', cat_name)

        if clean_cat and (clean_cat in last_user_text or (len(clean_cat) >= 2 and any(clean_cat in w or w in clean_cat for w in potential_words))):

            matched_categories.append(cat_name)

    if not matched_categories and is_asking_plate:

        # User asked general plate question -> prioritize active custom categories (excluding massive general pool)

        matched_categories = [c for c in category_map.keys() if c != "自选股池"][:4]

        if not matched_categories and "自选股池" in category_map:

            matched_categories = ["自选股池"]

    # Gather target stocks for the matched categories

    target_category_items = []

    for mc in matched_categories:

        for w in category_map.get(mc, []):

            target_category_items.append((mc, w))

    # Fetch batch real-time quotes for targeted category stocks (up to 40 stocks)

    target_cat_syms = list(set([w.symbol for _, w in target_category_items[:40]]))

    cat_quotes_map = MarketDataService.get_batch_realtime_quotes(target_cat_syms) if target_cat_syms else {}

    # Build local sectors summary and detailed quotes block

    local_sectors_block = ""

    if category_map:

        summary_lines = ["### 📁 用户本地自选板块与自定义股票池全景数据："]

        summary_lines.append(f"用户在本地自选管理中共创建维护了 **{len(category_map)}** 个自选板块/分类，纳入跟踪股票共 **{len(all_watchlists)}** 只：")

        for cat, items in category_map.items():

            sample_names = [f"{stock_name_map.get(w.symbol, w.symbol)}({w.symbol})" for w in items[:4]]

            suffix = f"等共 {len(items)} 只" if len(items) > 4 else f"共 {len(items)} 只"

            summary_lines.append(f"- **【{cat}】**: {', '.join(sample_names)} ({suffix})")

        details_lines = []

        if matched_categories and target_category_items:

            details_lines.append(f"\n### 🔥 重点聚焦板块【{' / '.join(matched_categories)}】股票池明细与实时行情：")

            details_lines.append("| 股票名称 | 代码 | 所属板块 | 最新现价 | 今日涨跌幅 | 计划买入价 | 止损位 | 设定备注/战法 |")

            details_lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

            for mc, w in target_category_items[:30]:

                q = cat_quotes_map.get(w.symbol, {})

                s_name = q.get("name") or stock_name_map.get(w.symbol) or w.symbol

                curr_price = f"¥{float(q.get('current_price', 0)):.2f}" if float(q.get('current_price', 0)) > 0 else "-"

                pct_chg = q.get("pct_chg", "0.00%")

                buy_p = f"¥{w.target_buy_price:.2f}" if w.target_buy_price else "-"

                sl_p = f"¥{w.stop_loss_price:.2f}" if w.stop_loss_price else "-"

                remark = w.remark or "自选跟踪"

                details_lines.append(f"| {s_name} | {w.symbol} | {mc} | {curr_price} | {pct_chg} | {buy_p} | {sl_p} | {remark} |")

                

                # Automatically add key stocks from matched category into symbols_found for indicators

                if len(symbols_found) < 5:

                    symbols_found.add(w.symbol)

        local_sectors_block = "\n".join(summary_lines) + ("\n" + "\n".join(details_lines) if details_lines else "")

    # If no specific stock is mentioned in message, automatically add top 3 holding positions' K-line indicators!

    if not symbols_found and positions:

        for p in positions[:3]:

            symbols_found.add(p.symbol)

    queried_indicators = []

    for sym in list(symbols_found)[:5]:

        stk_info = MarketDataService.get_stock_indicators_summary(sym, db=db)

        if stk_info and "error" not in stk_info:

            queried_indicators.append(stk_info)

    

    queried_stock_block = ""

    if queried_indicators:

        queried_stock_block = f"""

### 📌 核心个股与持仓标的【最近 10 日 K 线形态、放缩量配合与全维量化指标研判数据】：

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

   - 下方【用户近期交易明细日志】为你展示了最近 {len(trade_payload)} 笔成交记录。你手里已握有全量 {summary_info.get('total_trades_count', len(trade_payload))} 笔交易（时间跨度 {summary_info.get('date_range', '全时间段')}）的准确胜率、盈亏比与 FIFO 累计盈亏！当用户询问账本或胜率时，清晰自信地指出你已掌控全量账本宏观数据！

2. 你已经**全面接入并实时掌握上述个股的【最近 10 个交易日真实日 K 线走势序列（每日高开低收、涨跌幅、量比、红绿柱实体形态）】、【半年线与年线牛熊位置（MA120/MA250）】、【过去 1 年价格历史分位数】以及【全套技术指标（MA5/10/20、MACD红绿柱、KDJ摆动、RSI超买超卖、BOLL布林带触轨状态）】！**

【极其严厉的回答纪律】：

- 当用户询问具体股票的走势、K线、指标或买卖决策时，你**必须逐一调用并具体引用上方数据中的【近10日K线走势明细中的具体日期、K线形态、成交量量比倍数、均线支撑压制与MACD/KDJ/RSI/BOLL信号】进行环环相扣的技术面推导**！

- 明确给出具体的【支撑止损线（元）】、【反弹目标压力区间】与【买卖操作逻辑】！

- **绝对严禁**回复“我无法查看K线”、“我无法获取实时图表”或以任何借口拒绝分析，上面提供的数据即为最完整、最真实的权威行情与形态序列！

3. **微信消息推送能力**：

你系统层面已完全支持将你的分析、复盘与策略总结实时发送到用户的个人微信（基于 Server酱 / PushPlus / 企业微信通道）！

当用户要求你“推送到微信”、“发送到微信”、“把总结/分析发到微信”、“微信推送”等请求时，你必须**非常自信地回答**：

“好的！我已将本次的操盘分析与策略总结实时发送至您的微信，请在手机微信中查收！”，并在回答第一行包含标识 `[WECHAT_PUSH_REQUESTED]`，随后随附整理好的【微信精简版复盘/策略卡片】。

4. **持仓股票止损止盈智能设单能力 (自动监控、微信/弹窗强提醒)**：

你具备直接帮助用户为持仓股票配置【止损止盈多维监控规则】的强大能力！支持目标价止损/止盈、跌破/突破指定均线(MA5/10/20/60)、MACD死叉/金叉、以及移动最高价回撤止盈。

当用户询问：“帮我分析xx并设置止损止盈”、“帮我设个条件”、“给持仓股设置风控”、“止损位多少如何设条件”或类似意图时，你除了在正文中给出详尽的技术面推导逻辑（支撑位、阻力位、均线与动能）外，**必须在回复末尾附带如下标准 JSON 格式的代码块（代码块语言标识必须严格为 condition_proposal）**：

```condition_proposal

{{

  "symbol": "600519",

  "name": "贵州茅台",

  "conditions": [

    {{

      "condition_type": "STOP_LOSS",

      "condition_label": "🛑 关键支撑止损",

      "target_value": 1620.0,

      "strategy_note": "跌破关键支撑位1620元严格止损防守"

    }},

    {{

      "condition_type": "MA_CROSS_BELOW",

      "condition_label": "📉 跌破20日生命线止损",

      "ma_period": 20,

      "strategy_note": "跌破20日均线趋势走坏减仓离场"

    }},

    {{

      "condition_type": "TARGET_PROFIT",

      "condition_label": "🎯 第一阻力位止盈",

      "target_value": 1780.0,

      "strategy_note": "达到前期筹码套牢密集区1780元分批锁定利润"

    }},

    {{

      "condition_type": "TRAILING_STOP",

      "condition_label": "🛡️ 移动止盈 (回撤5%)",

      "trail_percent": 5.0,

      "strategy_note": "自冲高最高点回落达5%时锁定利润"

    }}

  ]

}}

```

系统前端会自动将该块渲染为极具美感的【智能条件单推荐卡片】，用户点击即可“⚡ 一键应用到监控”，一旦触发系统将立即弹窗并推送到用户微信！

5. **本地自选板块与分类股票池全维度研判能力**：

你系统层面已**全量接入用户在本地创建的全部自选板块、自定义股票池（如“准备建仓”、“ETF实仓”、“AI长线/ETF”等）及其中包含的具体股票清单与实时行情数据**！

当用户询问“分析我的板块”、“看看准备建仓板块”、“分析自选板块股票”等板块相关问题时，你**必须直接调取并具体引用下方【用户本地自选板块与自定义股票池全景数据】及【重点聚焦板块股票池明细与实时行情】中的具体板块分类、股票列表、最新现价与涨跌幅进行深度剖析**！

- 明确点评该板块当前整体涨跌热度、强弱分化与资金关注度；

- 挑出板块内处于关键买点、均线支撑或具备突破形态的重点标的进行深度解读；

- 结合用户真实的账户资金与仓位给出明确的建仓/观望/减仓操作建议与风控防线；

- **绝对严禁**回复“我无法获取本地板块数据”、“系统未提供板块数据”或让用户自己报股票！

{macro_block}

{account_capital_prompt}

{local_sectors_block}

{queried_stock_block}

【用户当前持仓 (包含实时报价与盈亏状态)】

{json.dumps(pos_payload, ensure_ascii=False, indent=2)}

【用户近期交易明细日志 (抽样最近 {len(trade_payload)} 笔交易)】

{json.dumps(trade_payload, ensure_ascii=False, indent=2)}

{memories_prompt}

请基于上述大盘宏观热点、本地自选板块股票池、1年与近10日K线序列、多维技术指标、全量交割单账本、账户资金全貌、持仓与认知战法，以专业、沉稳、建设性的语气同用户进行对话。直接引用提供的最新行情指标、板块股票与大盘热点给出犀利而精准的解答！

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

    positions = db.query(Position).filter(Position.current_volume > 0).all()

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

def get_agent_memories(

    limit: int = Query(50, le=100), 

    category: Optional[str] = Query(None),

    db: Session = Depends(get_db)

):

    """Fetch Agent memory bank items with optional category filtering"""

    return AgentMemoryService.get_all_memories(db, limit=limit, category=category)

@router.post("/agent/memories")

def create_agent_memory(payload: MemoryCreateRequest, db: Session = Depends(get_db)):

    """Manually add an Agent memory entry"""

    mem = AgentMemoryService.add_memory(

        db=db,

        content=payload.content,

        memory_type=payload.memory_type or "USER_HABIT",

        importance=payload.importance or 3,

        source_info="用户手动添加",

        category=payload.category

    )

    return {"status": "success", "id": mem.id}

@router.delete("/agent/memories/{memory_id}")

def delete_agent_memory(memory_id: int, db: Session = Depends(get_db)):

    """Delete an Agent memory entry"""

    success = AgentMemoryService.delete_memory(db, memory_id)

    if not success:

        raise HTTPException(status_code=404, detail="Memory not found")

    return {"status": "success", "deleted_id": memory_id}

@router.post("/agent/memories/audit")

async def audit_agent_memories(db: Session = Depends(get_db)):

    """AI Audit of Agent memories: identify useless/redundant rules and suggest merges"""

    return await AgentMemoryService.audit_and_optimize(db)

@router.post("/agent/memories/apply-optimization")

def apply_memory_optimization(payload: ApplyOptimizationRequest, db: Session = Depends(get_db)):

    """Apply approved pruning, enhancement, additions and merging changes to the memory vault"""

    return AgentMemoryService.apply_optimization(

        db=db,

        delete_ids=payload.delete_ids,

        merged_items=payload.merged_items,

        enhanced_items=payload.enhanced_items,

        recommended_items=payload.recommended_items

    )

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

def auto_sync_screener_recommendations_to_watchlist(db: Session, report_text: str, candidate_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:

    """

    Automatically parse recommended stocks from Screener AI report and sync into Watchlist with specific tier categories:

    - 🤖 AI 短线精选 (短线博弈/分歧低吸)

    - 🤖 AI 中线波段 (中线顺势/均线生命线)

    - 🤖 AI 长线/ETF (长线定投/ETF动态网格)

    """

    # Detect tier header offsets in markdown report

    short_pos = report_text.find("短线")

    mid_pos = report_text.find("中线")

    long_pos = report_text.find("长线")

    if long_pos == -1:

        long_pos = report_text.find("三、长线")

    added_items = []

    for item in candidate_items:

        sym = item.get("symbol")

        name = item.get("name")

        if not sym:

            continue

        # Check where symbol or name appears in the report

        pos_sym = report_text.find(sym)

        pos_name = report_text.find(name) if (name and len(name) >= 2) else -1

        valid_positions = [p for p in [pos_sym, pos_name] if p != -1]

        if not valid_positions:

            continue

        first_pos = min(valid_positions)

        # Determine target tier category

        cat_tag = "🤖 AI 精选建仓"

        sub_desc = "AI多维量化精选"

        if short_pos != -1 and first_pos >= short_pos and (mid_pos == -1 or first_pos < mid_pos) and (long_pos == -1 or first_pos < long_pos):

            cat_tag = "🤖 AI 短线精选"

            sub_desc = "⚡ 短线交易"

        elif mid_pos != -1 and first_pos >= mid_pos and (long_pos == -1 or first_pos < long_pos):

            cat_tag = "🤖 AI 中线波段"

            sub_desc = "📈 中线波段"

        elif long_pos != -1 and first_pos >= long_pos:

            cat_tag = "🤖 AI 长线/ETF"

            sub_desc = "🛡️ 长线价值/ETF"

        # Update or create Watchlist

        w = db.query(Watchlist).filter(Watchlist.symbol == sym).first()

        now_str = bj_now().strftime('%m-%d %H:%M')

        if w:

            existing_cats = [c.strip() for c in (w.category or "").split(",") if c.strip()]

            if cat_tag not in existing_cats:

                existing_cats.append(cat_tag)

                w.category = ",".join(existing_cats)

            w.remark = f"[{sub_desc}] AI智能选股推选标的 ({now_str})"

        else:

            w = Watchlist(

                symbol=sym,

                category=cat_tag,

                remark=f"[{sub_desc}] AI智能选股推选标的 ({now_str})"

            )

            db.add(w)

        added_items.append({"symbol": sym, "name": name or sym, "category": cat_tag, "tier": sub_desc})

    if added_items:

        db.commit()

    return added_items

@router.post("/screener/run-stream")

async def run_stock_screener_agent_stream(

    scope: Optional[str] = Query("ALL", description="Screening scope: ALL | SHORT_TERM | MID_TERM | LONG_TERM_ETF"),

    explore: Optional[bool] = Query(False, description="是否启用动态探索/换一批模式"),

    seed: Optional[int] = Query(None, description="随机种子，用于换一批轮换"),

    db: Session = Depends(get_db)

):

    """Stream Stock & ETF Screener Agent recommendation report with parallel indicators fetching & multi-tier taxonomy"""

    import asyncio

    import random

    from concurrent.futures import ThreadPoolExecutor

    watchlists = db.query(Watchlist).all()

    positions = db.query(Position).filter(Position.current_volume > 0).all()

    stocks_db = db.query(Stock).all()

    all_stocks = {s.symbol: s.name for s in stocks_db}

    stock_industry_map = {s.symbol: (s.industry or "通用行业") for s in stocks_db}

    symbols_map = {}

    for w in watchlists:

        symbols_map[w.symbol] = w.category or "自选股"

    for p in positions:

        if p.symbol not in symbols_map:

            symbols_map[p.symbol] = "持仓股"

    macro_context = MarketDataService.get_market_macro_context()

    # If candidate pool is too small (< 4), automatically add market hot sector representative core ETFs/stocks

    if len(symbols_map) < 4:

        hot_defaults = [

            ("512480", "半导体芯片主线"),

            ("159883", "医疗器械医药主线"),

            ("002475", "果链消费电子核心龙头"),

            ("688981", "科创半导体龙头"),

            ("601127", "新能源汽车主线龙头"),

            ("512690", "消费高股息红利ETF")

        ]

        for h_sym, h_cat in hot_defaults:

            if h_sym not in symbols_map:

                symbols_map[h_sym] = f"全市场热门主线 ({h_cat})"

    total_candidates = len(symbols_map)

        # 1. Fetch dynamic strategy weights and fused status from StrategyWeightRecord

    strategy_weights = db.query(StrategyWeightRecord).all()

    active_weights = [w for w in strategy_weights if w.is_active]

    fused_weights = [w for w in strategy_weights if not w.is_active]

    # 2. Fetch dynamic quantitative funnel config from ScreenerStrategyConfig

    funnel_cfg = db.query(ScreenerStrategyConfig).filter(ScreenerStrategyConfig.config_key == "CURRENT_FUNNEL_CONFIG").first()

    dyn_min_amount_wan = funnel_cfg.min_amount_wan if funnel_cfg else 2000.0

    dyn_min_etf_amount_wan = funnel_cfg.min_etf_amount_wan if funnel_cfg else 1000.0

    dyn_require_weekly_ma20 = funnel_cfg.require_weekly_ma20 if funnel_cfg else True

    # 3. Dynamic directives injected into user_rules_text

    fused_warning_lines = [f"- 🚫 **【严禁推荐·风控熔断战法】{w.strategy_name}**: 近期实盘跟踪胜率仅 {w.win_rate}% 触发熔断暂停，本次严禁推选该战法下的任何标的！" for w in fused_weights]

    boosted_lines = [f"- 🌟 **【高胜率重点推荐战法】{w.strategy_name}**: 近期实盘胜率达 {w.win_rate}%（权重 {w.weight}），优先重点推选符合此战法的标的！" for w in active_weights if w.weight >= 65]

    evolution_directives = "## 🧬 经过【实盘胜率自进化系统】动态自适应调优的战法去留准则（必须严格执行）：\n"

    if fused_warning_lines:

        evolution_directives += "\n".join(fused_warning_lines) + "\n"

    else:

        evolution_directives += "- 暂无熔断战法，全体系战法正常运行\n"

    if boosted_lines:

        evolution_directives += "\n".join(boosted_lines) + "\n"

    if dyn_require_weekly_ma20:

        evolution_directives += "- ⚠️ **【生命线风控硬指标】**: 周K线位于 MA20 生命线下方或周 MACD 死叉的标的，一票否决严禁入选！\n"

    # Decouple dual-track: Screener receives objective Master Playbooks + dynamic evolution rules

    user_rules_text = evolution_directives + "\n\n" + AgentMemoryService.format_memories_for_prompt(db, context_mode="SCREENER")

    async def event_generator():

        scope_labels = {

            "ALL": "全景三维严选 (短线 / 中线 / 长线与ETF)",

            "SHORT_TERM": "⚡ 专注短线交易股票 (1~5日主线博弈与分歧低吸)",

            "MID_TERM": "📈 专注中线波段标的 (2~8周顺势多头与行业ETF)",

            "LONG_TERM_ETF": "🛡️ 专注长线价值与宽基/红利 ETF (数月~长期定投与网格)"

        }

        active_label = scope_labels.get(scope or "ALL", scope_labels["ALL"])

        mode_tag = "【🎲 动态探索轮换】" if (explore or seed is not None) else "【🎯 经典多因子精选】"

        # 1. Yield clean initial status banner to frontend

        yield f"> 📡 **智能选股 Agent 已启动{mode_tag}【{active_label}】**：正在利用并发量化引擎扫描全量 **{total_candidates}** 只候选标的（自选/持仓/领涨主线龙头）的 1 年周期均线、近 10 日 K 线量价形态、量比与全维摆动指标...\n\n"

        if total_candidates == 0:

            yield "⚠️ **选股提示**: 当前候选池为空。请在【自选股/板块】中添加关注标的，智能选股 Agent 才能为您匹配战法推选！"

            return

        # 2. Pre-fetch batch quotes in 1 single HTTP request (~150ms for 2000 stocks)

        all_syms = list(symbols_map.keys())

        quotes_map = MarketDataService.get_batch_realtime_quotes(all_syms)

        # 3. Two-Stage High-Performance Quant Funnel with Multi-Factor Scoring, Sector Diversification & Risk Filtering

        selected_symbols_map = {}

        if total_candidates > 35:

            positions_syms = set(s for s, c in symbols_map.items() if c == "持仓股")

            etf_syms = []

            stock_syms = []

            for sym in all_syms:

                is_etf = sym.startswith(("51", "56", "58", "159", "501", "16"))

                if is_etf:

                    etf_syms.append(sym)

                else:

                    stock_syms.append(sym)

            # --- Rule A: Risk & Liquidity Pre-Filter ---

            def is_eligible_candidate(sym: str, is_etf: bool) -> bool:

                if sym in positions_syms:

                    return True

                q = quotes_map.get(sym, {})

                name = q.get("name") or all_stocks.get(sym) or ""

                # ST / *ST / 退市 warning filter

                name_upper = name.upper()

                if "ST" in name_upper or "退" in name:

                    return False

                # Suspended or no valid price/volume

                price = float(q.get("current_price") or 0.0)

                vol = float(q.get("volume") or 0.0)

                if price <= 0.0 or vol <= 0.0:

                    return False

                # Extreme panic limit-down filter (-9.8% or lower)

                pct = float(q.get("pct_chg_num") or 0.0)

                if pct <= -9.8:

                    return False

                # Liquidity threshold: filter out dead/zombie stocks (< 2000万元)

                amt_wan = float(q.get("amount_wan") or 0.0)

                if not is_etf and amt_wan < dyn_min_amount_wan:

                    return False

                if is_etf and amt_wan < dyn_min_etf_amount_wan:

                    return False

                return True

            filtered_stock_syms = [s for s in stock_syms if is_eligible_candidate(s, False)]

            filtered_etf_syms = [s for s in etf_syms if is_eligible_candidate(s, True)]

            # If filtering was too strict, fallback to original lists

            if len(filtered_stock_syms) < 10:

                filtered_stock_syms = stock_syms

            if len(filtered_etf_syms) < 4:

                filtered_etf_syms = etf_syms

            # Set up deterministic or exploratory random generator

            rng = random.Random(seed if seed is not None else (random.randint(1, 10000000) if explore else 42))

            # --- Rule B: Multi-Factor Quant Scoring ---

            def calc_short_term_score(sym: str) -> float:

                q = quotes_map.get(sym, {})

                pct = float(q.get("pct_chg_num") or 0.0)

                amt_yi = float(q.get("amount_yi") or 0.0)

                

                # 1. Price Momentum Score (max 60)

                # Golden breakout & divergence zone: +2.0% ~ +6.5%

                if 2.0 <= pct <= 6.5:

                    m_score = 60.0

                elif 0.5 <= pct < 2.0:

                    m_score = 48.0

                elif -2.5 <= pct < 0.5:

                    m_score = 44.0  # Healthy pullback

                elif 6.5 < pct <= 9.2:

                    m_score = 32.0  # Chasing high caution

                elif pct > 9.2:

                    m_score = 15.0  # Locked limit-up, difficult to buy

                else:

                    m_score = 10.0  # Breakdown / weak

                    

                # 2. Liquidity & High-Elasticity Volume Score (max 40)

                # 1.5亿~25亿 is the golden elasticity sweet-spot for swing & momentum trades

                if 2.0 <= amt_yi <= 25.0:

                    l_score = 40.0

                elif amt_yi > 25.0:

                    l_score = 34.0  # Mega-cap, slightly lower momentum beta

                elif 1.0 <= amt_yi < 2.0:

                    l_score = 30.0

                elif 0.5 <= amt_yi < 1.0:

                    l_score = 22.0

                else:

                    l_score = 10.0

                # 3. Dynamic exploration bonus in explore mode (max 15.0)

                exp_bonus = rng.uniform(0.0, 15.0) if (explore or seed is not None) else 0.0

                return m_score + l_score + exp_bonus

            def calc_mid_term_score(sym: str) -> float:

                q = quotes_map.get(sym, {})

                pct = float(q.get("pct_chg_num") or 0.0)

                amt_yi = float(q.get("amount_yi") or 0.0)

                mcap_yi = float(q.get("market_cap_yi") or 0.0)

                

                # Steady trend momentum (max 50)

                if 1.0 <= pct <= 6.0:

                    m_score = 50.0

                elif 0.0 <= pct < 1.0:

                    m_score = 38.0

                elif -2.0 <= pct < 0.0:

                    m_score = 32.0

                else:

                    m_score = 20.0

                    

                # Capital depth & market cap (max 50)

                cap_score = 0.0

                if mcap_yi >= 300.0:

                    cap_score += 25.0

                elif mcap_yi >= 100.0:

                    cap_score += 20.0

                elif mcap_yi >= 30.0:

                    cap_score += 15.0

                else:

                    cap_score += 10.0

                if amt_yi >= 5.0:

                    cap_score += 25.0

                elif amt_yi >= 2.0:

                    cap_score += 20.0

                elif amt_yi >= 0.8:

                    cap_score += 14.0

                else:

                    cap_score += 8.0

                exp_bonus = rng.uniform(0.0, 12.0) if (explore or seed is not None) else 0.0

                return m_score + cap_score + exp_bonus

            core_broad_etfs = {"510300", "510500", "560510", "159915", "588000", "513180", "512690", "512880", "159949", "512480"}

            def calc_etf_score(sym: str) -> float:

                q = quotes_map.get(sym, {})

                amt_yi = float(q.get("amount_yi") or 0.0)

                base_score = 55.0 if sym in core_broad_etfs else 35.0

                l_score = 45.0 if amt_yi >= 5.0 else (35.0 if amt_yi >= 1.5 else 20.0)

                exp_bonus = rng.uniform(0.0, 18.0) if (explore or seed is not None) else 0.0

                return base_score + l_score + exp_bonus

            short_pool = sorted(filtered_stock_syms, key=calc_short_term_score, reverse=True)

            mid_pool = sorted(filtered_stock_syms, key=calc_mid_term_score, reverse=True)

            etf_pool = sorted(filtered_etf_syms, key=calc_etf_score, reverse=True)

            # --- Rule C: Sector Cap & Diversification (防止单一行业过度扎堆) ---

            def select_diversified(pool: list, target_count: int, max_per_ind: int = 3, existing_chosen: set = None) -> list:

                selected = []

                ind_counts = {}

                if existing_chosen:

                    for s in existing_chosen:

                        ind = stock_industry_map.get(s, "通用行业")

                        ind_counts[ind] = ind_counts.get(ind, 0) + 1

                deferred = []

                for s in pool:

                    if existing_chosen and s in existing_chosen:

                        continue

                    ind = stock_industry_map.get(s, "通用行业")

                    limit = max_per_ind if ind not in ("通用行业", "其他行业", "", None) else (max_per_ind * 2)

                    if ind_counts.get(ind, 0) < limit:

                        selected.append(s)

                        ind_counts[ind] = ind_counts.get(ind, 0) + 1

                        if len(selected) >= target_count:

                            break

                    else:

                        deferred.append(s)

                # Fallback: fill remaining if diverse pool is smaller than target_count

                if len(selected) < target_count:

                    for s in deferred:

                        if s not in selected:

                            selected.append(s)

                            if len(selected) >= target_count:

                                break

                return selected

            # Allocate quota based on scope

            chosen = set()

            # 1. Always prioritize active user positions (up to 8)

            for ps in list(positions_syms)[:8]:

                chosen.add(ps)

            if scope == "SHORT_TERM":

                needed = max(0, 30 - len(chosen))

                div_stocks = select_diversified(short_pool, needed, max_per_ind=4, existing_chosen=chosen)

                for s in div_stocks:

                    chosen.add(s)

            elif scope == "MID_TERM":

                needed_mid = max(0, 20 - len(chosen))

                div_mid = select_diversified(mid_pool, needed_mid, max_per_ind=3, existing_chosen=chosen)

                for s in div_mid:

                    chosen.add(s)

                needed_etf = max(0, 30 - len(chosen))

                for s in etf_pool:

                    if len(chosen) >= 30:

                        break

                    chosen.add(s)

            elif scope == "LONG_TERM_ETF":

                for s in etf_pool[:22]:

                    if len(chosen) >= 22:

                        break

                    chosen.add(s)

                needed_mid = max(0, 30 - len(chosen))

                div_mid = select_diversified(mid_pool, needed_mid, max_per_ind=2, existing_chosen=chosen)

                for s in div_mid:

                    chosen.add(s)

            else: # ALL: Balanced representation: ~12 Short, ~12 Mid, ~8 Long/ETF

                # 1. 12 short-term diverse momentum stocks

                short_selected = select_diversified(short_pool, 12, max_per_ind=3, existing_chosen=chosen)

                for s in short_selected:

                    chosen.add(s)

                # 2. 12 mid-term diverse trend stocks

                mid_selected = select_diversified(mid_pool, 12, max_per_ind=3, existing_chosen=chosen)

                for s in mid_selected:

                    chosen.add(s)

                # 3. 8 ETF assets

                for s in etf_pool:

                    if len([x for x in chosen if x in filtered_etf_syms]) >= 8:

                        break

                    chosen.add(s)

            for sym in chosen:

                selected_symbols_map[sym] = symbols_map[sym]

            # Calculate industry coverage statistics for user report

            covered_inds = set(stock_industry_map.get(s, "通用行业") for s in chosen if s in filtered_stock_syms)

            covered_inds.discard("通用行业")

            ind_stat_str = f"，覆盖 **{len(covered_inds)}** 个细分行业板块（单行业最多入选 ≤ 3 只）" if covered_inds else ""

            yield f"> ⚡ **量化初筛漏斗完成**：已执行【ST/退市避雷、流动性筛选、行业中性化打散去扎堆{ind_stat_str}与多因子打分{mode_tag}】，从 **{total_candidates}** 只标的中严选出 **{len(selected_symbols_map)}** 只核心潜力候选标的！正在并发提取日K/周K/月K深度指标与权威要闻...\n\n"

        else:

            selected_symbols_map = symbols_map

        # 4. Parallel fetch stock indicators & recent official news using ThreadPoolExecutor for shortlisted symbols

        loop = asyncio.get_running_loop()

        watchlist_items = []

        def fetch_single(sym: str, cat: str):

            name = all_stocks.get(sym) or MarketDataService.get_stock_name(sym)

            ind = MarketDataService.get_stock_indicators_summary(sym, name)

            ind["category"] = cat

            # Concurrently attach official stock news & announcements from EastMoney / Securities Press / CLS

            try:

                from services.news_service import NewsService

                raw_news = NewsService.get_stock_news(sym, name=name, limit=3)

                ind["recent_news"] = [

                    f"[{n.get('publish_time', '')}] 《{n.get('source', '权威媒体')}》: {n.get('title', '')}"

                    for n in raw_news

                ]

            except Exception:

                ind["recent_news"] = []

            return ind

        target_pool = list(selected_symbols_map.items())

        with ThreadPoolExecutor(max_workers=min(12, max(1, len(target_pool)))) as executor:

            tasks = [

                loop.run_in_executor(executor, fetch_single, sym, cat)

                for sym, cat in target_pool

            ]

            watchlist_items = await asyncio.gather(*tasks)

        yield f"> 🧠 **量化行情、权威公告与财联社电报全量核验就绪**！正在融合【消息面避雷/催化 + 日/周/月K多周期共振】严选建仓标的...\n\n---\n\n"

        from routers.account import get_account_fund_summary

        account_fund_info = get_account_fund_summary(db)

        # 4. Construct prompt and stream LLM response

        prompt = MultiLLMEngine.build_stock_screener_prompt(

            watchlist_items, 

            user_rules_text, 

            macro_context=macro_context,

            account_fund_info=account_fund_info,

            scope=scope

        )

        report_text = ""

        async for chunk in MultiLLMEngine.generate_analysis_stream(

            db, 

            prompt,

            system_prompt="你是一位专业的 A 股量化选股专家与策略风控教练，严苛匹配短线、中线、长线与 ETF 的差异化买卖标准，重视风控纪律。"

        ):

            if chunk:

                report_text += chunk

                yield chunk

        # Auto sync recommended stocks into Watchlist under specific AI categories

        synced_stocks = auto_sync_screener_recommendations_to_watchlist(db, report_text, watchlist_items)

        if synced_stocks:

            stock_names_str = "、".join([f"**{s['name']} ({s['symbol']})** [{s.get('tier', 'AI精选')}]" for s in synced_stocks])

            sync_notice = f"\n\n---\n\n> ✨ **自选板块多级自动打标与同步完成**：系统已自动将 AI 匹配精选的标的 {stock_names_str} 分类同步至自选板块【**🤖 AI 短线精选 / 🤖 AI 中线波段 / 🤖 AI 长线/ETF**】！您可随时在“持仓与自选管理”中集中监控其最新走势与买卖点！\n"

            report_text += sync_notice

            yield sync_notice

        # Auto save completed report to DB

        active_cfg = MultiLLMEngine.get_active_config(db)

        report = AnalysisReport(

            report_type="STOCK_SCREENER_AGENT",

            provider_model=active_cfg["model"],

            input_summary=f"智能选股 Agent [{active_label}] ({len(watchlist_items)}只标的筛选)",

            content_md=report_text,

            generated_at=bj_now()

        )

        db.add(report)

        db.commit()

        AgentMemoryService.auto_extract_and_evolve(db, report_text, source_label="选股 Agent 每日推选")

        # Auto record structured recommendation snapshots for performance tracking & self-evolution

        from services.screener_tracker import ScreenerTrackerService

        ScreenerTrackerService.record_recommendations_from_report(

            db=db,

            report_id=report.id,

            report_text=report_text,

            candidate_items=watchlist_items,

            scope=scope or "ALL"

        )

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/screener/performance-stats")

def get_screener_performance_stats(

    days: int = 0,

    tier: Optional[str] = None,

    strategy_id: Optional[str] = None,

    limit: int = 500,

    db: Session = Depends(get_db)

):

    """Get aggregated track record and win rate stats for past screener recommendations with multi-period & strategy scorecard"""

    from services.screener_tracker import ScreenerTrackerService

    return ScreenerTrackerService.get_performance_summary(

        db,

        days=days,

        tier=tier,

        strategy_id=strategy_id,

        limit=limit

    )

@router.post("/screener/evolve-stream")

async def run_screener_self_evolution_stream(

    days: int = 0,

    db: Session = Depends(get_db)

):

    """

    Stream Screener Strategy Review & Self-Evolution Report.

    Audits past recommendations vs actual price performance, reflects on winning/losing factors,

    and automatically extracts actionable lessons into Agent Memory.

    """

    from services.screener_tracker import ScreenerTrackerService

    stats = ScreenerTrackerService.get_performance_summary(db, days=days)

    if not stats.get("records"):

        async def empty_generator():

            msg = """# ℹ️ 历史推选跟踪样本库准备中

> 📌 **系统状态**：数据库中尚未沉淀智能选股的真实推选样本。

### 💡 为什么需要推选样本？

AI 策略自进化的核心原理是：**基于实盘实际推荐过的股票，跟踪其实盘后续走势（是否达标止盈、是否触及止损），进而归因并自适应优化选股规则**。

### 🚀 您只需简单两步即可激活：

1. **第一步（生成首批推选）**：点击上方的 **【🎯 智能选股 Agent】** 按钮运行一次选股。系统会自动为您快照记录入选股票的买入基准价、目标止盈与防守止损位；

2. **第二步（实盘走势跟踪）**：系统在后台毫秒级对齐实盘最新行情；

3. **第三步（开启自进化）**：再次点击 **【🔄 胜率复盘与自进化】**，AI 将基于真实涨跌盈亏进行深度归因与策略记忆进化！

"""

            yield msg

        return StreamingResponse(empty_generator(), media_type="text/event-stream")

    prompt = ScreenerTrackerService.build_screener_evolution_prompt(db, days=days)

    async def event_generator():

        report_text = ""

        async for chunk in MultiLLMEngine.generate_analysis_stream(

            db,

            prompt,

            system_prompt="你是一位专业的 A 股量化选股策略总监与风控教练，擅长通过实盘复盘归因得失，动态优化选股规则与防守参数。"

        ):

            if chunk:

                report_text += chunk

                yield chunk

        # Auto save review report

        active_cfg = MultiLLMEngine.get_active_config(db)

        report = AnalysisReport(

            report_type="SCREENER_EVOLUTION_REVIEW",

            provider_model=active_cfg["model"],

            input_summary="智能选股策略实盘胜率复盘与自进化",

            content_md=report_text,

            generated_at=bj_now()

        )

        db.add(report)

        db.commit()

                # 1. Soft evolution: auto extract newly learned rules into agent memory bank

        AgentMemoryService.auto_extract_and_evolve(db, report_text, source_label="选股策略自进化")

        # 2. Hard evolution: apply quantitative funnel config & strategy weights auto-adjustment to SQLite!

        from services.screener_tracker import ScreenerTrackerService

        evo_result = ScreenerTrackerService.apply_auto_evolution(db, report_text=report_text, days=days)

        # 3. Format visual evolution summary card and stream to client

        fused_list = evo_result.get("fused_strategies", [])

        boosted_list = evo_result.get("boosted_strategies", [])

        fused_text = "、".join([f"**{f['name']}** (胜率 {f['win_rate']}%)" for f in fused_list]) if fused_list else "无（当前体系战法健康运行）"

        boosted_text = "、".join([f"**{b['name']}** (胜率 {b['win_rate']}%, 权重 {b['weight']})" for b in boosted_list]) if boosted_list else "基准均衡运行"

        cfg_info = evo_result.get("funnel_config", {})

        closing_card = f"""\n\n---

### 🧬 系统策略自进化执行日志 (硬量化参数与战法权重已完成闭环回写)

- 🔄 **进化迭代版本**: **第 {evo_result.get('version', 1)} 代量化自适应策略系统**

- 📊 **战法权重自适应调优与风控熔断**:

  - 🟢 **重点加权优先推选**: {boosted_text}

  - 🔴 **触发风控熔断暂停**: {fused_text}

- 🎯 **底层初筛漏斗参数动态同步**:

  - 最低成交额门槛: **¥{int(cfg_info.get('min_amount_wan', 2000))} 万元** (已同步更新)

  - 周K线 MA20 趋势过滤: **{"严格执行一票否决" if cfg_info.get('require_weekly_ma20') else "常规放行"}**

  - 默认纪律硬止损基准: **{cfg_info.get('default_stop_loss_pct', -4.5)}%**

- 💡 **自进化决策归因**: {cfg_info.get('summary', '已根据最新实盘胜率自动更新策略库')}

> ✅ **硬闭环状态确认**：底层 Python 筛选引擎参数、战法权重数据库已完成自动持久化回写！下次启动【智能选股 Agent】时将自动采用最新优化后的战法权重与风控规则。

"""

        yield closing_card

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class StrategyWeightToggleRequest(BaseModel):

    strategy_id: str

    is_active: Optional[bool] = None

@router.get("/screener/strategy-weights")

def get_screener_strategy_weights(db: Session = Depends(get_db)):

    """Fetch live strategy weights, circuit breaker states, and funnel config"""

    from services.screener_tracker import ScreenerTrackerService

    return ScreenerTrackerService.get_strategy_weights_and_config(db)

@router.post("/screener/strategy-weights/toggle")

def toggle_strategy_weight_fuse(req: StrategyWeightToggleRequest, db: Session = Depends(get_db)):

    """Manually toggle a strategy's active/fuse state"""

    rec = db.query(StrategyWeightRecord).filter(StrategyWeightRecord.strategy_id == req.strategy_id).first()

    if not rec:

        raise HTTPException(status_code=404, detail="Strategy not found")

    if req.is_active is not None:

        rec.is_active = req.is_active

    else:

        rec.is_active = not rec.is_active

    rec.fuse_reason = "用户手动调整运行状态" if rec.is_active else "用户手动熔断暂停"

    rec.updated_at = bj_now()

    db.commit()

    from services.screener_tracker import ScreenerTrackerService

    return ScreenerTrackerService.get_strategy_weights_and_config(db)

@router.post("/screener/strategy-weights/reset")

def reset_screener_strategy_weights(db: Session = Depends(get_db)):

    """Reset strategy weights and funnel config back to baseline defaults"""

    cfg = db.query(ScreenerStrategyConfig).filter(ScreenerStrategyConfig.config_key == "CURRENT_FUNNEL_CONFIG").first()

    if cfg:

        cfg.min_amount_wan = 2000.0

        cfg.min_etf_amount_wan = 1000.0

        cfg.require_weekly_ma20 = True

        cfg.default_stop_loss_pct = -4.5

        cfg.default_take_profit_pct = 12.0

        cfg.last_evolution_summary = "手动重置为初始基准配置"

        cfg.updated_at = bj_now()

    weights = db.query(StrategyWeightRecord).all()

    for w in weights:

        w.weight = 50

        w.is_active = True

        w.fuse_reason = "已重置为基准运行状态"

        w.updated_at = bj_now()

    db.commit()

    from services.screener_tracker import ScreenerTrackerService

    return ScreenerTrackerService.get_strategy_weights_and_config(db)

