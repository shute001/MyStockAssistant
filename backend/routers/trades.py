import math
import io
import re
import pandas as pd
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from database import get_db, TradeRecord, Position, Stock, bj_now
from services.market_data import MarketDataService


router = APIRouter(prefix="/trades", tags=["Trade Records"])

class TradeCreatePayload(BaseModel):
    symbol: str
    name: Optional[str] = None
    trade_type: str = "BUY"  # "BUY" | "SELL"
    price: float
    volume: int
    fee: Optional[float] = 0.0
    strategy_reason: Optional[str] = None
    trade_date: Optional[str] = None  # YYYY-MM-DD HH:MM:SS or YYYY-MM-DD
    sync_to_position: Optional[bool] = True
    is_planned: Optional[bool] = True
    trade_tag: Optional[str] = "计划内执行"

class TradeBatchItem(BaseModel):
    symbol: str
    name: Optional[str] = None
    trade_type: str = "BUY"
    price: float
    volume: int
    fee: Optional[float] = 0.0
    strategy_reason: Optional[str] = None
    trade_date: Optional[str] = None
    is_planned: Optional[bool] = True
    trade_tag: Optional[str] = "计划内执行"

class TradeBatchPayload(BaseModel):
    items: List[TradeBatchItem]
    deduplicate_mode: Optional[str] = "SKIP"  # "SKIP" (自动跳过) | "OVERWRITE" (覆盖更新) | "ALLOW_ALL" (允许重复)
    sync_to_position: Optional[bool] = True


class BatchDeletePayload(BaseModel):
    ids: List[int]

class TradeUpdatePayload(BaseModel):
    strategy_reason: Optional[str] = None
    trade_date: Optional[str] = None
    price: Optional[float] = None
    volume: Optional[int] = None
    is_planned: Optional[bool] = None
    trade_tag: Optional[str] = None

class ClipboardParsePayload(BaseModel):
    text: str


def parse_datetime_flexible(dt_val: Optional[Any]) -> datetime:
    """Flexible datetime parser for trade dates in Chinese delivery slips & broker exports"""
    if dt_val is None or pd.isna(dt_val):
        return bj_now()
    if isinstance(dt_val, datetime):
        return dt_val.replace(tzinfo=None)
    if isinstance(dt_val, pd.Timestamp):
        return dt_val.to_pydatetime().replace(tzinfo=None)
    
    s = str(dt_val).strip()
    if not s or s.lower() in ('nan', 'nat', 'none'):
        return bj_now()

    # Strip trailing '.0' from float strings like '20260907.0'
    if re.match(r'^\d+\.0$', s):
        s = s[:-2]

    # Standardize separators in date strings
    s = s.replace("年", "-").replace("月", "-").replace("日", " ").replace("/", "-").replace(".", "-")
    s = re.sub(r'\s+', ' ', s).strip()

    # 1. Try explicit strptime patterns
    patterns = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y%m%d %H:%M:%S",
        "%Y%m%d %H:%M",
        "%Y%m%d %H%M%S",
        "%Y%m%d%H%M%S",
        "%Y%m%d",
    ]
    for fmt in patterns:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass

    # 2. Extract components via regex
    date_match = re.search(r'(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})', s)
    time_match = re.search(r'(\d{1,2}):(\d{2})(?::(\d{2}))?', s)
    time_match_6digit = re.search(r'\b(\d{2})(\d{2})(\d{2})\b', s) if not time_match else None

    if date_match:
        y, m, d = int(date_match.group(1)), int(date_match.group(2)), int(date_match.group(3))
        hh, mm, ss = 0, 0, 0
        if time_match:
            hh = int(time_match.group(1))
            mm = int(time_match.group(2))
            ss = int(time_match.group(3)) if time_match.group(3) else 0
        elif time_match_6digit:
            hh = int(time_match_6digit.group(1))
            mm = int(time_match_6digit.group(2))
            ss = int(time_match_6digit.group(3))
        try:
            return datetime(y, m, d, hh, mm, ss)
        except ValueError:
            pass

    return bj_now()



def calculate_trade_ledger(records: List[TradeRecord]) -> dict:
    """Calculate cash flow, win rate, P/L ratio, expectancy, and FIFO realised P&L"""
    lots: dict[str, list[list[float]]] = {}
    realised_pnl = 0.0
    unmatched_sell_volume = 0
    total_fees = 0.0
    net_cash_flow = 0.0
    matched_pnls: list[float] = []

    planned_count = 0
    for trade in records:
        if getattr(trade, 'is_planned', True):
            planned_count += 1

        volume = max(int(trade.volume or 0), 0)
        fee = float(trade.fee or 0.0)
        amount = float(trade.amount or 0.0)
        total_fees += fee
        symbol_lots = lots.setdefault(trade.symbol, [])

        if trade.trade_type == "BUY":
            unit_cost = (amount + fee) / volume if volume else 0.0
            symbol_lots.append([float(volume), unit_cost])
            net_cash_flow -= amount + fee
            continue

        net_cash_flow += amount - fee
        remaining = volume
        matched_cost = 0.0
        while remaining > 0 and symbol_lots:
            lot_volume, unit_cost = symbol_lots[0]
            matched = min(remaining, int(lot_volume))
            matched_cost += matched * unit_cost
            lot_volume -= matched
            remaining -= matched
            if lot_volume <= 0:
                symbol_lots.pop(0)
            else:
                symbol_lots[0][0] = lot_volume

        matched_volume = volume - remaining
        if remaining:
            unmatched_sell_volume += remaining

        matched_proceeds = (amount - fee) * matched_volume / volume if volume else 0.0
        trade_pnl = matched_proceeds - matched_cost
        realised_pnl += trade_pnl
        if matched_volume > 0:
            matched_pnls.append(trade_pnl)

    # Compute Win Rate, Profit/Loss Ratio & Expectancy
    winning_trades = [p for p in matched_pnls if p > 0]
    losing_trades = [p for p in matched_pnls if p < 0]
    
    total_matched = len(matched_pnls)
    win_rate = round((len(winning_trades) / total_matched * 100), 1) if total_matched > 0 else 0.0
    avg_win = (sum(winning_trades) / len(winning_trades)) if winning_trades else 0.0
    avg_loss = (abs(sum(losing_trades)) / len(losing_trades)) if losing_trades else 0.0

    pnl_ratio = round(avg_win / avg_loss, 2) if avg_loss > 0 else (99.0 if avg_win > 0 else 0.0)
    expectancy = round(((win_rate / 100) * avg_win) - ((1 - win_rate / 100) * avg_loss), 2)
    planned_ratio = round(planned_count / len(records) * 100, 1) if records else 100.0

    return {
        "realized_pnl": round(realised_pnl, 2),
        "net_cash_flow": round(net_cash_flow, 2),
        "total_fees": round(total_fees, 2),
        "unmatched_sell_volume": unmatched_sell_volume,
        "win_rate": win_rate,
        "profit_loss_ratio": pnl_ratio,
        "expectancy": expectancy,
        "planned_ratio": planned_ratio,
        "total_closed_trades": total_matched
    }


@router.get("")
def get_trade_records(
    search: Optional[str] = None,
    symbol: Optional[str] = None,
    trade_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=200),
    limit: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Fetch trade history log with multi-criteria filtering, pagination, and exact database statistics"""
    query = db.query(TradeRecord)

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter((TradeRecord.symbol.like(term)) | (TradeRecord.name.like(term)))
    elif symbol:
        formatted_sym = MarketDataService.format_symbol(symbol)
        query = query.filter(TradeRecord.symbol == formatted_sym)

    if trade_type and trade_type.upper() in ["BUY", "SELL"]:
        query = query.filter(TradeRecord.trade_type == trade_type.upper())

    if start_date and start_date.strip():
        try:
            s_dt = datetime.strptime(start_date.strip(), "%Y-%m-%d")
            query = query.filter(TradeRecord.trade_date >= s_dt)
        except ValueError:
            pass

    if end_date and end_date.strip():
        try:
            e_dt = datetime.strptime(f"{end_date.strip()} 23:59:59", "%Y-%m-%d %H:%M:%S")
            query = query.filter(TradeRecord.trade_date <= e_dt)
        except ValueError:
            pass

    # 1. Compute exact summary metrics across the ENTIRE matching dataset (not limited by pagination)
    total_trades = query.count()

    buy_stats = query.filter(TradeRecord.trade_type == "BUY").with_entities(
        func.count(TradeRecord.id),
        func.coalesce(func.sum(TradeRecord.amount), 0.0)
    ).first()

    sell_stats = query.filter(TradeRecord.trade_type == "SELL").with_entities(
        func.count(TradeRecord.id),
        func.coalesce(func.sum(TradeRecord.amount), 0.0)
    ).first()

    buy_count = buy_stats[0] if buy_stats else 0
    total_buy_amount = float(buy_stats[1]) if buy_stats else 0.0

    sell_count = sell_stats[0] if sell_stats else 0
    total_sell_amount = float(sell_stats[1]) if sell_stats else 0.0
    ledger = calculate_trade_ledger(query.order_by(TradeRecord.trade_date.asc(), TradeRecord.id.asc()).all())

    # Determine pagination parameters
    effective_page_size = limit if (limit and limit > 0) else page_size
    total_pages = max(1, math.ceil(total_trades / effective_page_size))
    offset = (page - 1) * effective_page_size

    # 2. Fetch paginated records for rendering table rows
    records = query.order_by(TradeRecord.trade_date.desc(), TradeRecord.id.desc()).offset(offset).limit(effective_page_size).all()

    items = []
    for r in records:
        items.append({
            "id": r.id,
            "symbol": r.symbol,
            "name": r.name,
            "trade_type": r.trade_type,
            "price": r.price,
            "volume": r.volume,
            "amount": r.amount,
            "fee": r.fee,
            "trade_date": r.trade_date.strftime("%Y-%m-%d %H:%M:%S") if r.trade_date else "",
            "strategy_reason": r.strategy_reason or "",
            "is_planned": getattr(r, 'is_planned', True),
            "trade_tag": getattr(r, 'trade_tag', '计划内执行') or '计划内执行',
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""
        })

    return {
        "stats": {
            "total_trades": total_trades,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "total_buy_amount": round(total_buy_amount, 2),
            "total_sell_amount": round(total_sell_amount, 2),
            **ledger
        },
        "pagination": {
            "page": page,
            "page_size": effective_page_size,
            "total_trades": total_trades,
            "total_pages": total_pages
        },
        "items": items
    }




@router.post("")
def create_trade_record(payload: TradeCreatePayload, db: Session = Depends(get_db)):
    """Create a new trade log record and optionally synchronize position"""
    symbol = MarketDataService.format_symbol(payload.symbol)
    stock_name = payload.name if (payload.name and not payload.name.startswith("股票")) else MarketDataService.get_stock_name(symbol)

    # Ensure Stock entity exists
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        stock = Stock(symbol=symbol, name=stock_name)
        db.add(stock)
        db.commit()

    # Parse trade_date
    t_date = parse_datetime_flexible(payload.trade_date)

    amount = round(payload.price * payload.volume, 2)
    trade = TradeRecord(
        symbol=symbol,
        name=stock_name,
        trade_type=payload.trade_type.upper(),
        price=payload.price,
        volume=payload.volume,
        amount=amount,
        fee=payload.fee or 0.0,
        strategy_reason=payload.strategy_reason,
        is_planned=payload.is_planned if payload.is_planned is not None else True,
        trade_tag=payload.trade_tag or ("计划内执行" if (payload.is_planned is None or payload.is_planned) else "计划外冲动"),
        trade_date=t_date,
        created_at=bj_now()
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)

    # Optionally Sync to Position table
    if payload.sync_to_position:
        pos = db.query(Position).filter(Position.symbol == symbol).first()
        if payload.trade_type.upper() == "BUY":
            if pos:
                # Weighted average cost price
                new_total_vol = pos.current_volume + payload.volume
                if new_total_vol > 0:
                    new_cost = ((pos.cost_price * pos.current_volume) + (payload.price * payload.volume)) / new_total_vol
                    pos.cost_price = round(new_cost, 3)
                    pos.current_volume = new_total_vol
            else:
                pos = Position(
                    symbol=symbol,
                    cost_price=payload.price,
                    current_volume=payload.volume,
                    strategy_tag="建仓买入"
                )
                db.add(pos)
        elif payload.trade_type.upper() == "SELL":
            if pos:
                new_vol = max(0, pos.current_volume - payload.volume)
                if new_vol == 0:
                    db.delete(pos)
                else:
                    pos.current_volume = new_vol
        db.commit()

    return {"status": "success", "trade_id": trade.id, "symbol": symbol, "name": stock_name}

@router.post("/batch")
def batch_create_trades(payload: TradeBatchPayload, db: Session = Depends(get_db)):
    """Batch create trade records using high-performance bulk database insert with smart deduplication"""
    if not payload.items:
        return {"status": "success", "count": 0, "skipped_count": 0, "overwritten_count": 0}

    mode = payload.deduplicate_mode.upper() if payload.deduplicate_mode else "SKIP"

    # Pre-fetch existing stocks into a dictionary to avoid n+1 DB queries
    existing_stocks = {s.symbol: s for s in db.query(Stock).all()}
    new_stocks = []

    # Pre-fetch existing trades for fast memory deduplication
    existing_trades = db.query(TradeRecord).all()
    existing_trade_keys = {}
    for tr in existing_trades:
        dt_key = tr.trade_date.strftime("%Y-%m-%d %H:%M:%S") if tr.trade_date else ""
        date_only_key = tr.trade_date.strftime("%Y-%m-%d") if tr.trade_date else ""
        # Support both exact timestamp match and same-day trade match
        key_exact = (tr.symbol, tr.trade_type.upper(), round(tr.price, 3), tr.volume, dt_key)
        key_day = (tr.symbol, tr.trade_type.upper(), round(tr.price, 3), tr.volume, date_only_key)
        existing_trade_keys[key_exact] = tr
        existing_trade_keys[key_day] = tr

    trades_to_add = []
    skipped_count = 0
    overwritten_count = 0

    for item in payload.items:
        symbol = MarketDataService.format_symbol(item.symbol)
        stock_name = item.name if (item.name and not item.name.startswith("股票")) else MarketDataService.get_stock_name(symbol)

        if symbol not in existing_stocks:
            stock = Stock(symbol=symbol, name=stock_name)
            existing_stocks[symbol] = stock
            new_stocks.append(stock)

        # Parse trade_date
        t_date = parse_datetime_flexible(item.trade_date)

        dt_exact_str = t_date.strftime("%Y-%m-%d %H:%M:%S")
        dt_day_str = t_date.strftime("%Y-%m-%d")
        
        trade_key_exact = (symbol, item.trade_type.upper(), round(item.price, 3), item.volume, dt_exact_str)
        trade_key_day = (symbol, item.trade_type.upper(), round(item.price, 3), item.volume, dt_day_str)

        existing_record = existing_trade_keys.get(trade_key_exact) or existing_trade_keys.get(trade_key_day)

        if existing_record and mode != "ALLOW_ALL":
            if mode == "SKIP":
                skipped_count += 1
                continue
            elif mode == "OVERWRITE":
                existing_record.price = item.price
                existing_record.volume = item.volume
                existing_record.amount = round(item.price * item.volume, 2)
                existing_record.fee = item.fee or 0.0
                if item.strategy_reason:
                    existing_record.strategy_reason = item.strategy_reason
                existing_record.is_planned = item.is_planned if item.is_planned is not None else True
                if item.trade_tag:
                    existing_record.trade_tag = item.trade_tag
                overwritten_count += 1
                continue

        amount = round(item.price * item.volume, 2)
        new_tr = TradeRecord(
            symbol=symbol,
            name=stock_name,
            trade_type=item.trade_type.upper(),
            price=item.price,
            volume=item.volume,
            amount=amount,
            fee=item.fee or 0.0,
            strategy_reason=item.strategy_reason or "交割单批量导入",
            is_planned=item.is_planned if item.is_planned is not None else True,
            trade_tag=item.trade_tag or ("计划内执行" if (item.is_planned is None or item.is_planned) else "计划外冲动"),
            trade_date=t_date,
            created_at=bj_now()
        )
        trades_to_add.append(new_tr)
        # Register in memory lookup
        existing_trade_keys[trade_key_exact] = new_tr
        existing_trade_keys[trade_key_day] = new_tr

    if new_stocks:
        db.add_all(new_stocks)
        db.commit()

    if trades_to_add:
        db.add_all(trades_to_add)

    db.commit()

    # Optional: Sync affected symbols to Position table
    if payload.sync_to_position and trades_to_add:
        affected_symbols = {t.symbol for t in trades_to_add}
        for sym in affected_symbols:
            all_records = db.query(TradeRecord).filter(TradeRecord.symbol == sym).order_by(TradeRecord.trade_date.asc(), TradeRecord.id.asc()).all()
            vol = 0
            total_cost_spent = 0.0
            for r in all_records:
                if r.trade_type == "BUY":
                    vol += r.volume
                    total_cost_spent += r.price * r.volume
                elif r.trade_type == "SELL":
                    if vol > 0:
                        cost_per_share = total_cost_spent / vol
                        vol = max(0, vol - r.volume)
                        total_cost_spent = vol * cost_per_share
                    else:
                        vol = 0
                        total_cost_spent = 0.0

            avg_cost = round(total_cost_spent / vol, 3) if vol > 0 else 0.0

            pos = db.query(Position).filter(Position.symbol == sym).first()
            if vol > 0:
                if pos:
                    pos.current_volume = vol
                    pos.cost_price = avg_cost
                    pos.strategy_tag = "当前持仓"
                else:
                    pos = Position(
                        symbol=sym,
                        cost_price=avg_cost,
                        current_volume=vol,
                        strategy_tag="建仓买入"
                    )
                    db.add(pos)
            else:
                if pos:
                    pos.current_volume = 0
                    pos.strategy_tag = "历史清仓"
        db.commit()

    return {
        "status": "success",
        "count": len(trades_to_add),
        "skipped_count": skipped_count,
        "overwritten_count": overwritten_count
    }


@router.post("/batch-delete")
def batch_delete_trades(payload: BatchDeletePayload, db: Session = Depends(get_db)):
    """Batch delete trade records by list of IDs"""
    if not payload.ids:
        return {"status": "success", "count": 0}

    count = db.query(TradeRecord).filter(TradeRecord.id.in_(payload.ids)).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "count": count}

@router.post("/clear-all")
@router.delete("/clear-all")
def clear_all_trades(db: Session = Depends(get_db)):
    """Clear all historical trade records from database"""
    count = db.query(TradeRecord).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted_count": count}


@router.put("/{trade_id}")
@router.put("/{trade_id}/reason")
def update_trade_record(trade_id: int, payload: TradeUpdatePayload, db: Session = Depends(get_db)):
    """Update trade record fields including strategy reason, trade date/time, price, volume, and tags"""
    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade record not found")

    if payload.strategy_reason is not None:
        trade.strategy_reason = payload.strategy_reason.strip()

    if payload.trade_date is not None and payload.trade_date.strip():
        t_date = parse_datetime_flexible(payload.trade_date)
        trade.trade_date = t_date

    if payload.price is not None:
        trade.price = payload.price
        trade.amount = round(payload.price * (trade.volume or 0), 2)

    if payload.volume is not None:
        trade.volume = payload.volume
        trade.amount = round((trade.price or 0.0) * payload.volume, 2)

    if payload.is_planned is not None:
        trade.is_planned = payload.is_planned

    if payload.trade_tag is not None:
        trade.trade_tag = payload.trade_tag

    db.commit()
    db.refresh(trade)
    return {
        "status": "success",
        "trade_id": trade_id,
        "strategy_reason": trade.strategy_reason,
        "trade_date": trade.trade_date.strftime("%Y-%m-%d %H:%M:%S") if trade.trade_date else ""
    }

@router.delete("/{trade_id}")
def delete_trade_record(trade_id: int, db: Session = Depends(get_db)):


    """Delete a trade record"""
    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade record not found")
    db.delete(trade)
    db.commit()
    return {"status": "success", "deleted_id": trade_id}

@router.post("/parse-clipboard")
def parse_trade_clipboard(payload: ClipboardParsePayload):
    """
    Parse trade log text copied from Flush (同花顺) or broker trading software.
    Matches lines containing: [Date/Time] [Buy/Sell] [Symbol] [Name] [Price] [Volume]
    """
    lines = payload.text.strip().split("\n")
    items = []

    trade_regex = re.compile(
        r'((?:\d{4}[-/.]\d{2}[-/.]\d{2}|\d{8})\s*(?:\d{2}:\d{2}(?::\d{2})?|\d{6})?|\d{2}:\d{2}:\d{2})?\s*(买入|卖出|证券买入|证券卖出|BUY|SELL)?\s*([01345689]\d{5})\s+([\u4e00-\u9fa5A-Za-z0-9\*]+)\s+([\d\.,]+)\s+([\d\.,]+)'
    )

    for line in lines:
        line_str = line.strip()
        if not line_str:
            continue

        match = trade_regex.search(line_str)
        if match:
            raw_dt = match.group(1) or ""
            dt_obj = parse_datetime_flexible(raw_dt) if raw_dt else bj_now()
            date_str = dt_obj.strftime("%Y-%m-%d %H:%M:%S")

            raw_action = match.group(2) or "买入"
            symbol = match.group(3).zfill(6)
            name = match.group(4).strip()
            raw_price = match.group(5)
            raw_vol = match.group(6)

            trade_type = "SELL" if ("卖" in raw_action or "SELL" in raw_action.upper()) else "BUY"
            try:
                price = float(raw_price.replace(",", ""))
                volume = int(float(raw_vol.replace(",", "")))
            except ValueError:
                continue

            items.append({
                "symbol": symbol,
                "name": name,
                "trade_type": trade_type,
                "price": price,
                "volume": volume,
                "amount": round(price * volume, 2),
                "trade_date": date_str,
                "raw_text": line_str
            })

    return {"status": "success", "count": len(items), "items": items}

@router.post("/upload-file")
async def upload_trade_file(file: UploadFile = File(...)):
    """Parse exported Flush (同花顺) trade records file (.xls, .csv, .txt, .xlsx)"""
    content = await file.read()
    raw_text = ""
    for enc in ["gb18030", "gbk", "utf-8-sig", "utf-8", "cp936"]:
        try:
            raw_text = content.decode(enc)
            if raw_text:
                break
        except Exception:
            continue

    df = None
    filename_lower = file.filename.lower() if file.filename else ""

    # 1. Try HTML table parsing (Flush .xls files are often HTML <table> tables!)
    if "<table" in raw_text.lower():
        try:
            dfs = pd.read_html(io.StringIO(raw_text))
            if dfs:
                df = dfs[0]
        except Exception:
            pass

    # 2. Try Excel file reading if pd.read_html didn't produce df
    if (df is None or df.empty) and (filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")):
        try:
            df = pd.read_excel(io.BytesIO(content))
        except Exception:
            pass

    # 3. Try CSV / TSV text parsing with Pandas
    if df is None or df.empty:
        for enc in ["gbk", "gb18030", "utf-8-sig", "utf-8"]:
            try:
                df = pd.read_csv(io.BytesIO(content), encoding=enc, sep=None, engine="python")
                if df is not None and not df.empty:
                    break
            except Exception:
                continue

    items = []

    # 4. Dynamic column detection & DataFrame row extraction
    if df is not None and not df.empty:
        header_row_idx = None
        for idx in range(min(15, len(df))):
            row_vals = [str(val).strip() for val in df.iloc[idx].values if pd.notna(val)]
            if any("代码" in v or "Symbol" in v or ("证券" in v and "代码" in v) for v in row_vals):
                header_row_idx = idx
                break

        if header_row_idx is not None:
            df.columns = [str(x).strip() for x in df.iloc[header_row_idx].values]
            df = df.iloc[header_row_idx + 1:].reset_index(drop=True)

        columns = [str(col).strip() for col in df.columns]
        df.columns = columns

        # Check column types for Format 2 (Flush daily summary / 对账单 with separate 买入数量 / 卖出数量)
        buy_vol_col = next((col for col in columns if "买入" in col and ("数量" in col or "股数" in col)), None)
        sell_vol_col = next((col for col in columns if "卖出" in col and ("数量" in col or "股数" in col)), None)
        buy_price_col = next((col for col in columns if "买入" in col and ("均价" in col or "价格" in col or "单价" in col)), None)
        sell_price_col = next((col for col in columns if "卖出" in col and ("均价" in col or "价格" in col or "单价" in col)), None)
        buy_amt_col = next((col for col in columns if "买入" in col and "金额" in col), None)
        sell_amt_col = next((col for col in columns if "卖出" in col and "金额" in col), None)

        action_col = next((col for col in columns if any(k in col for k in ["操作", "买卖标志", "买卖方向", "类别", "Action"]) and col not in [buy_vol_col, sell_vol_col]), None)

        date_col = next((col for col in columns if "日期" in col or "Date" in col), None)
        time_col = next((col for col in columns if ("时间" in col or "Time" in col) and col != date_col), None)
        if not date_col and time_col:
            date_col = time_col
            time_col = None

        if not date_col:
            date_col = next((col for col in columns if "时间" in col or "Date" in col or "Time" in col), None)

        symbol_col = next((col for col in columns if "代码" in col or "Symbol" in col), None)
        name_col = next((col for col in columns if "名称" in col or "Name" in col), None)
        fee_col = next((col for col in columns if "费用" in col or "佣金" in col or "手续费" in col or "Fee" in col), None)

        if symbol_col:
            # Format 2 Mode: Separate 买入数量 and 卖出数量 columns (Flush summary sheet / 对账单)
            if (buy_vol_col or sell_vol_col) and not action_col:
                for _, row in df.iterrows():
                    symbol_raw = str(row[symbol_col]).strip().split(".")[0] if pd.notna(row[symbol_col]) else ""
                    if not symbol_raw.isdigit() or len(symbol_raw) > 6:
                        continue
                    symbol = symbol_raw.zfill(6)
                    name = str(row[name_col]).strip() if name_col and pd.notna(row[name_col]) else MarketDataService.get_stock_name(symbol)

                    d_str = str(row[date_col]).strip() if date_col and pd.notna(row[date_col]) else ""
                    t_str = str(row[time_col]).strip() if time_col and pd.notna(row[time_col]) else ""
                    combined_dt = f"{d_str} {t_str}".strip()
                    full_dt = parse_datetime_flexible(combined_dt).strftime("%Y-%m-%d %H:%M:%S") if combined_dt else bj_now().strftime("%Y-%m-%d %H:%M:%S")

                    b_vol = 0
                    if buy_vol_col and pd.notna(row[buy_vol_col]):
                        try:
                            b_vol = int(abs(float(str(row[buy_vol_col]).replace(",", ""))))
                        except ValueError:
                            b_vol = 0

                    s_vol = 0
                    if sell_vol_col and pd.notna(row[sell_vol_col]):
                        try:
                            s_vol = int(abs(float(str(row[sell_vol_col]).replace(",", ""))))
                        except ValueError:
                            s_vol = 0

                    fee = 0.0
                    if fee_col and pd.notna(row[fee_col]):
                        try:
                            fee = abs(float(str(row[fee_col]).replace(",", "")))
                        except ValueError:
                            fee = 0.0

                    if b_vol > 0:
                        b_price = 0.0
                        if buy_price_col and pd.notna(row[buy_price_col]):
                            try:
                                b_price = float(str(row[buy_price_col]).replace(",", ""))
                            except ValueError:
                                b_price = 0.0
                        if b_price == 0 and buy_amt_col and pd.notna(row[buy_amt_col]):
                            try:
                                b_price = float(str(row[buy_amt_col]).replace(",", "")) / b_vol
                            except Exception:
                                b_price = 0.0

                        items.append({
                            "symbol": symbol,
                            "name": name,
                            "trade_type": "BUY",
                            "price": round(b_price, 3),
                            "volume": b_vol,
                            "amount": round(b_price * b_vol, 2),
                            "fee": round(fee * (b_vol / (b_vol + s_vol)), 2) if (b_vol + s_vol) > 0 else fee,
                            "trade_date": full_dt,
                            "strategy_reason": "同花顺对账单导出"
                        })

                    if s_vol > 0:
                        s_price = 0.0
                        if sell_price_col and pd.notna(row[sell_price_col]):
                            try:
                                s_price = float(str(row[sell_price_col]).replace(",", ""))
                            except ValueError:
                                s_price = 0.0
                        if s_price == 0 and sell_amt_col and pd.notna(row[sell_amt_col]):
                            try:
                                s_price = float(str(row[sell_amt_col]).replace(",", "")) / s_vol
                            except Exception:
                                s_price = 0.0

                        items.append({
                            "symbol": symbol,
                            "name": name,
                            "trade_type": "SELL",
                            "price": round(s_price, 3),
                            "volume": s_vol,
                            "amount": round(s_price * s_vol, 2),
                            "fee": round(fee * (s_vol / (b_vol + s_vol)), 2) if (b_vol + s_vol) > 0 else fee,
                            "trade_date": full_dt,
                            "strategy_reason": "同花顺对账单导出"
                        })

            # Format 1 Mode: Single 操作 column (Flush detail slip / 交割明细)
            else:
                vol_col = next((col for col in columns if "数量" in col or "股数" in col or "成交量" in col or "Volume" in col), None)
                price_col = next((col for col in columns if "均价" in col or "价格" in col or "成交价" in col or "单价" in col or "Price" in col), None)

                for _, row in df.iterrows():
                    symbol_raw = str(row[symbol_col]).strip().split(".")[0] if pd.notna(row[symbol_col]) else ""
                    if not symbol_raw.isdigit() or len(symbol_raw) > 6:
                        continue
                    symbol = symbol_raw.zfill(6)
                    name = str(row[name_col]).strip() if name_col and pd.notna(row[name_col]) else MarketDataService.get_stock_name(symbol)

                    action_raw = str(row[action_col]).strip() if action_col and pd.notna(row[action_col]) else "买入"
                    trade_type = "SELL" if ("卖" in action_raw or "SELL" in action_raw.upper()) else "BUY"

                    volume = 0
                    if vol_col and pd.notna(row[vol_col]):
                        try:
                            volume = int(abs(float(str(row[vol_col]).replace(",", ""))))
                        except ValueError:
                            volume = 0

                    if volume <= 0:
                        continue

                    price = 0.0
                    if price_col and pd.notna(row[price_col]):
                        try:
                            price = float(str(row[price_col]).replace(",", ""))
                        except ValueError:
                            price = 0.0

                    fee = 0.0
                    if fee_col and pd.notna(row[fee_col]):
                        try:
                            fee = abs(float(str(row[fee_col]).replace(",", "")))
                        except ValueError:
                            fee = 0.0

                    d_str = str(row[date_col]).strip() if date_col and pd.notna(row[date_col]) else ""
                    t_str = str(row[time_col]).strip() if time_col and pd.notna(row[time_col]) else ""
                    combined_dt = f"{d_str} {t_str}".strip()
                    full_dt = parse_datetime_flexible(combined_dt).strftime("%Y-%m-%d %H:%M:%S") if combined_dt else bj_now().strftime("%Y-%m-%d %H:%M:%S")

                    items.append({
                        "symbol": symbol,
                        "name": name,
                        "trade_type": trade_type,
                        "price": price,
                        "volume": volume,
                        "amount": round(price * volume, 2),
                        "fee": fee,
                        "trade_date": full_dt,
                        "strategy_reason": "同花顺交割单导出"
                    })

    # 5. Universal Regex Fallback for text files if DataFrame yielded 0 items
    if not items and raw_text:
        lines = raw_text.strip().split("\n")
        trade_regex = re.compile(
            r'((?:\d{4}[-/.]\d{2}[-/.]\d{2}|\d{8})\s*(?:\d{2}:\d{2}(?::\d{2})?|\d{6})?|\d{2}:\d{2}:\d{2})?\s*(买入|卖出|证券买入|证券卖出|BUY|SELL)?\s*([01345689]\d{5})\s+([\u4e00-\u9fa5A-Za-z0-9\*]+)\s+([\d\.,]+)\s+([\d\.,]+)'
        )

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            match = trade_regex.search(line_str)
            if match:
                raw_dt = match.group(1) or ""
                dt_obj = parse_datetime_flexible(raw_dt) if raw_dt else bj_now()
                full_dt = dt_obj.strftime("%Y-%m-%d %H:%M:%S")

                raw_action = match.group(2) or "买入"
                symbol = match.group(3).zfill(6)
                name = match.group(4).strip()
                raw_price = match.group(5)
                raw_vol = match.group(6)

                trade_type = "SELL" if ("卖" in raw_action or "SELL" in raw_action.upper()) else "BUY"
                try:
                    price = float(raw_price.replace(",", ""))
                    volume = int(abs(float(raw_vol.replace(",", ""))))
                except ValueError:
                    continue

                if volume <= 0:
                    continue

                items.append({
                    "symbol": symbol,
                    "name": name,
                    "trade_type": trade_type,
                    "price": price,
                    "volume": volume,
                    "amount": round(price * volume, 2),
                    "fee": 0.0,
                    "trade_date": full_dt,
                    "strategy_reason": f"同花顺交割单导入"
                })

    return {"status": "success", "count": len(items), "items": items}
