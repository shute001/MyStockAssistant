from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from database import get_db, Stock, Position, Watchlist
from services.market_data import MarketDataService

router = APIRouter(prefix="/stocks", tags=["Stocks & Portfolio"])

# Pydantic Schemas
class PositionCreate(BaseModel):
    symbol: str
    name: Optional[str] = None
    cost_price: float
    current_volume: int
    strategy_tag: Optional[str] = "长线持有"

class WatchlistCreate(BaseModel):
    symbol: str
    name: Optional[str] = None
    category: Optional[str] = "观察池"
    target_buy_price: Optional[float] = None
    stop_loss_price: Optional[float] = None
    remark: Optional[str] = None

@router.get("/positions")
def get_positions(db: Session = Depends(get_db)):
    """Fetch all holding positions with real-time indicators in ultra-fast batch mode"""
    positions = db.query(Position).all()
    if not positions:
        return []

    symbols = [pos.symbol for pos in positions]
    batch_quotes = MarketDataService.get_batch_realtime_quotes(symbols)
    result = []

    for pos in positions:
        stock = db.query(Stock).filter(Stock.symbol == pos.symbol).first()
        quote = batch_quotes.get(pos.symbol, {})
        real_name = quote.get("name") or (stock.name if stock and not stock.name.startswith("股票") else MarketDataService.get_stock_name(pos.symbol))

        if not stock:
            stock = Stock(symbol=pos.symbol, name=real_name)
            db.add(stock)
            db.commit()
        elif stock.name.startswith("股票") or stock.name != real_name:
            stock.name = real_name
            db.commit()

        current_price = quote.get("current_price") or pos.cost_price
        pct_chg = quote.get("pct_chg", "0.00%")
        total_cost = pos.cost_price * pos.current_volume
        current_value = current_price * pos.current_volume
        profit_loss = current_value - total_cost
        profit_ratio = (profit_loss / total_cost * 100) if total_cost > 0 else 0.0

        result.append({
            "id": pos.id,
            "symbol": pos.symbol,
            "name": real_name,
            "cost_price": pos.cost_price,
            "current_volume": pos.current_volume,
            "strategy_tag": pos.strategy_tag,
            "current_price": current_price,
            "total_cost": round(total_cost, 2),
            "current_value": round(current_value, 2),
            "profit_loss": round(profit_loss, 2),
            "profit_ratio": round(profit_ratio, 2),
            "pct_chg": pct_chg,
            "ma_trend": "多头震荡",
            "macd_status": "看多" if quote.get("pct_chg_num", 0) >= 0 else "回调",
            "support_price": round(current_price * 0.95, 2),
            "resistance_price": round(current_price * 1.05, 2)
        })
    return result

@router.post("/positions")
def create_position(item: PositionCreate, db: Session = Depends(get_db)):
    """Add or update a stock position"""
    symbol = MarketDataService.format_symbol(item.symbol)
    stock_name = item.name if (item.name and not item.name.startswith("股票")) else MarketDataService.get_stock_name(symbol)
    
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        stock = Stock(symbol=symbol, name=stock_name)
        db.add(stock)
        db.commit()
    elif stock.name.startswith("股票"):
        stock.name = stock_name
        db.commit()

    pos = db.query(Position).filter(Position.symbol == symbol).first()
    if pos:
        pos.cost_price = item.cost_price
        pos.current_volume = item.current_volume
        if item.strategy_tag:
            pos.strategy_tag = item.strategy_tag
    else:
        pos = Position(
            symbol=symbol,
            cost_price=item.cost_price,
            current_volume=item.current_volume,
            strategy_tag=item.strategy_tag or "长线持有"
        )
        db.add(pos)

    db.commit()
    db.refresh(pos)
    return {"status": "success", "id": pos.id}

@router.delete("/positions/{pos_id}")
def delete_position(pos_id: int, db: Session = Depends(get_db)):
    """Delete a holding position"""
    pos = db.query(Position).filter(Position.id == pos_id).first()
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    db.delete(pos)
    db.commit()
    return {"status": "success"}

@router.get("/watchlists")
def get_watchlists(db: Session = Depends(get_db)):
    """Fetch all watchlist items with real-time indicators in ultra-fast batch mode"""
    watchlists = db.query(Watchlist).all()
    if not watchlists:
        return []

    symbols = [w.symbol for w in watchlists]
    batch_quotes = MarketDataService.get_batch_realtime_quotes(symbols)
    result = []

    for w in watchlists:
        stock = db.query(Stock).filter(Stock.symbol == w.symbol).first()
        quote = batch_quotes.get(w.symbol, {})
        real_name = quote.get("name") or (stock.name if stock and not stock.name.startswith("股票") else MarketDataService.get_stock_name(w.symbol))

        if not stock:
            stock = Stock(symbol=w.symbol, name=real_name)
            db.add(stock)
            db.commit()
        elif stock.name.startswith("股票") or stock.name != real_name:
            stock.name = real_name
            db.commit()

        current_price = quote.get("current_price") or 0.0
        pct_chg = quote.get("pct_chg", "0.00%")

        result.append({
            "id": w.id,
            "symbol": w.symbol,
            "name": real_name,
            "category": w.category,
            "target_buy_price": w.target_buy_price,
            "stop_loss_price": w.stop_loss_price,
            "remark": w.remark,
            "current_price": current_price,
            "pct_chg": pct_chg,
            "ma_trend": "关注支撑",
            "macd_status": "看多" if quote.get("pct_chg_num", 0) >= 0 else "调整",
            "support_price": round(current_price * 0.95, 2) if current_price > 0 else None,
            "resistance_price": round(current_price * 1.05, 2) if current_price > 0 else None
        })
    return result

@router.post("/watchlists")
def create_watchlist(item: WatchlistCreate, db: Session = Depends(get_db)):
    """Add a stock to watchlist"""
    symbol = MarketDataService.format_symbol(item.symbol)
    stock_name = item.name if (item.name and not item.name.startswith("股票")) else MarketDataService.get_stock_name(symbol)
    
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        stock = Stock(symbol=symbol, name=stock_name)
        db.add(stock)
        db.commit()
    elif stock.name.startswith("股票"):
        stock.name = stock_name
        db.commit()

    w = db.query(Watchlist).filter(Watchlist.symbol == symbol).first()
    if not w:
        w = Watchlist(
            symbol=symbol,
            category=item.category or "观察池",
            target_buy_price=item.target_buy_price,
            stop_loss_price=item.stop_loss_price,
            remark=item.remark
        )
        db.add(w)
        db.commit()
        db.refresh(w)
    return {"status": "success", "id": w.id}

@router.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    """Fetch distinct sector/category summary statistics for watchlist stocks"""
    watchlists = db.query(Watchlist).all()
    stats: Dict[str, int] = {}
    for w in watchlists:
        cat = w.category or "默认自选"
        stats[cat] = stats.get(cat, 0) + 1
    
    categories = [{"name": cat, "count": count} for cat, count in stats.items()]
    # Ensure "全部自选" is at top
    total_count = len(watchlists)
    return {
        "total_count": total_count,
        "categories": categories
    }

class CategoryUpdateItem(BaseModel):
    category: str

class CategoryRenameItem(BaseModel):
    old_name: str
    new_name: str

@router.put("/watchlists/{w_id}/category")
def update_watchlist_category(w_id: int, item: CategoryUpdateItem, db: Session = Depends(get_db)):
    """Relocate a watchlist stock to a new sector/category"""
    w = db.query(Watchlist).filter(Watchlist.id == w_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    w.category = item.category.strip() or "默认自选"
    db.commit()
    return {"status": "success", "id": w_id, "new_category": w.category}

@router.put("/categories/rename")
def rename_category(item: CategoryRenameItem, db: Session = Depends(get_db)):
    """Rename a sector/category across all watchlist stocks"""
    if not item.old_name or not item.new_name:
        raise HTTPException(status_code=400, detail="Invalid category names")
    
    items = db.query(Watchlist).filter(Watchlist.category == item.old_name).all()
    for w in items:
        w.category = item.new_name.strip()
    db.commit()
    return {"status": "success", "updated_count": len(items)}

class BatchDeletePayload(BaseModel):
    ids: List[int]

class BatchCategoryRelocatePayload(BaseModel):
    ids: List[int]
    category: str

@router.post("/watchlists/batch-delete")
def batch_delete_watchlists(payload: BatchDeletePayload, db: Session = Depends(get_db)):
    """Batch delete watchlist items by IDs"""
    if not payload.ids:
        return {"status": "success", "deleted_count": 0}
    deleted = db.query(Watchlist).filter(Watchlist.id.in_(payload.ids)).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted_count": deleted}

@router.post("/positions/batch-delete")
def batch_delete_positions(payload: BatchDeletePayload, db: Session = Depends(get_db)):
    """Batch delete position items by IDs"""
    if not payload.ids:
        return {"status": "success", "deleted_count": 0}
    deleted = db.query(Position).filter(Position.id.in_(payload.ids)).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted_count": deleted}

@router.post("/watchlists/batch-relocate")
def batch_relocate_watchlists(payload: BatchCategoryRelocatePayload, db: Session = Depends(get_db)):
    """Batch relocate selected watchlist items to a target category"""
    if not payload.ids:
        return {"status": "success", "updated_count": 0}
    target_cat = payload.category.strip() or "默认自选"
    updated = db.query(Watchlist).filter(Watchlist.id.in_(payload.ids)).update({"category": target_cat}, synchronize_session=False)
    db.commit()
    return {"status": "success", "updated_count": updated}

@router.delete("/categories/{category_name}/purge")
def purge_entire_category(category_name: str, db: Session = Depends(get_db)):
    """Purge and delete an entire sector category AND all contained stocks"""
    deleted = db.query(Watchlist).filter(Watchlist.category == category_name).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "deleted_stocks_count": deleted}

@router.delete("/categories/{category_name}")
def delete_category(category_name: str, db: Session = Depends(get_db)):
    """Delete a sector category and reset its stocks to '默认自选'"""
    items = db.query(Watchlist).filter(Watchlist.category == category_name).all()
    for w in items:
        w.category = "默认自选"
    db.commit()
    return {"status": "success", "reset_count": len(items)}

@router.delete("/watchlists/{w_id}")
def delete_watchlist(w_id: int, db: Session = Depends(get_db)):
    """Delete a watchlist item"""
    w = db.query(Watchlist).filter(Watchlist.id == w_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(w)
    db.commit()
    return {"status": "success"}

@router.get("/{symbol}/kline")
def get_kline(symbol: str, days: int = Query(60, ge=10, le=250)):
    """Get K-line candlestick and technical indicator dataset for chart display"""
    df = MarketDataService.get_stock_kline(symbol, days=days)
    return df.to_dict(orient="records")
