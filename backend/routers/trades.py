import math
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

class TradeBatchItem(BaseModel):
    symbol: str
    name: Optional[str] = None
    trade_type: str = "BUY"
    price: float
    volume: int
    fee: Optional[float] = 0.0
    strategy_reason: Optional[str] = None
    trade_date: Optional[str] = None

class TradeBatchPayload(BaseModel):
    items: List[TradeBatchItem]
    deduplicate_mode: Optional[str] = "SKIP"  # "SKIP" (自动跳过) | "OVERWRITE" (覆盖更新) | "ALLOW_ALL" (允许重复)
    sync_to_position: Optional[bool] = True


class BatchDeletePayload(BaseModel):
    ids: List[int]

class UpdateReasonPayload(BaseModel):
    strategy_reason: str

class ClipboardParsePayload(BaseModel):
    text: str


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
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""
        })

    return {
        "stats": {
            "total_trades": total_trades,
            "buy_count": buy_count,
            "sell_count": sell_count,
            "total_buy_amount": round(total_buy_amount, 2),
            "total_sell_amount": round(total_sell_amount, 2)
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
    t_date = bj_now()
    if payload.trade_date:
        try:
            if " " in payload.trade_date.strip():
                t_date = datetime.strptime(payload.trade_date.strip(), "%Y-%m-%d %H:%M:%S")
            else:
                t_date = datetime.strptime(payload.trade_date.strip(), "%Y-%m-%d")
        except ValueError:
            t_date = bj_now()

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
        t_date = bj_now()
        if item.trade_date:
            try:
                if " " in item.trade_date.strip():
                    t_date = datetime.strptime(item.trade_date.strip(), "%Y-%m-%d %H:%M:%S")
                else:
                    t_date = datetime.strptime(item.trade_date.strip(), "%Y-%m-%d")
            except ValueError:
                t_date = bj_now()

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

@router.put("/{trade_id}/reason")
def update_trade_reason(trade_id: int, payload: UpdateReasonPayload, db: Session = Depends(get_db)):
    """Update strategy reason / reflection note for a trade record"""
    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail="Trade record not found")

    trade.strategy_reason = payload.strategy_reason.strip()
    db.commit()
    return {"status": "success", "trade_id": trade_id, "strategy_reason": trade.strategy_reason}

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
    Matches lines containing: [Date] [Buy/Sell] [Symbol] [Name] [Price] [Volume]
    """
    lines = payload.text.strip().split("\n")
    items = []

    # Regex matching: Date, Buy/Sell, Symbol, Name, Price, Volume
    trade_regex = re.compile(
        r'(\d{4}[-/.]\d{2}[-/.]\d{2})?\s*(买入|卖出|证券买入|证券卖出|BUY|SELL)?\s*([01345689]\d{5})\s+([\u4e00-\u9fa5A-Za-z0-9\*]+)\s+([\d\.,]+)\s+([\d\.,]+)'
    )

    for line in lines:
        line_str = line.strip()
        if not line_str:
            continue

        match = trade_regex.search(line_str)
        if match:
            date_str = match.group(1) or datetime.now().strftime("%Y-%m-%d")
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
    """Parse exported Flush (同花顺) trade records file (.xls, .csv, .txt)"""
    content = await file.read()
    items = []
    
    text = ""
    for enc in ["gb18030", "gbk", "utf-8-sig", "utf-8"]:
        try:
            text = content.decode(enc)
            if "成交" in text or "证券代码" in text or "买入" in text or "卖出" in text:
                break
        except Exception:
            continue

    if text:
        lines = text.strip().split("\n")
        header_line = lines[0]
        delimiter = "\t" if "\t" in header_line else ("," if "," in header_line else None)

        for line in lines[1:]:
            parts = [p.strip() for p in (line.split(delimiter) if delimiter else line.split())]
            if len(parts) < 6:
                continue
            
            try:
                # Expecting format: [Date, Time, Code, Name, Action, Volume, Price, Amount, ...]
                d_raw = parts[0]
                t_raw = parts[1] if len(parts) > 1 else "00:00:00"
                sym_raw = parts[2]
                name_raw = parts[3]
                action_raw = parts[4]
                vol_raw = parts[5]
                price_raw = parts[6] if len(parts) > 6 else "0.0"

                if not sym_raw.isdigit() or len(sym_raw) > 6:
                    continue
                symbol = sym_raw.zfill(6)
                stock_name = name_raw if name_raw else MarketDataService.get_stock_name(symbol)

                trade_type = "SELL" if ("卖" in action_raw or "SELL" in action_raw.upper()) else "BUY"
                volume = int(float(vol_raw.replace(",", "")))
                price = float(price_raw.replace(",", ""))

                if len(d_raw) == 8 and d_raw.isdigit():
                    d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}"
                else:
                    d_fmt = d_raw

                full_date_str = f"{d_fmt} {t_raw}".strip()

                items.append({
                    "symbol": symbol,
                    "name": stock_name,
                    "trade_type": trade_type,
                    "price": price,
                    "volume": volume,
                    "amount": round(price * volume, 2),
                    "trade_date": full_date_str,
                    "strategy_reason": f"同花顺交割单导出"
                })
            except Exception:
                continue

    return {"status": "success", "count": len(items), "items": items}

