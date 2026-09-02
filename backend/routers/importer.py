from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from database import get_db, Stock, Position, Watchlist
from services.importer import FlushImporterService
from services.market_data import MarketDataService

router = APIRouter(prefix="/import", tags=["Flush Importer"])

class TextImportRequest(BaseModel):
    text: str
    target_type: str = "POSITION"  # "POSITION" or "WATCHLIST"

class ConfirmImportItem(BaseModel):
    symbol: str
    name: str
    cost_price: float = 0.0
    current_volume: int = 0
    target_type: str = "POSITION"
    category: Optional[str] = "同花顺板块"

class ConfirmImportPayload(BaseModel):
    items: List[ConfirmImportItem]

@router.post("/parse-text")
def parse_text(payload: TextImportRequest):
    """Parse text/clipboard copy paste from Flush client"""
    items = FlushImporterService.parse_clipboard_text(payload.text)
    return {"status": "success", "count": len(items), "items": items, "default_category": "剪贴板导入"}

@router.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    """Parse exported Flush .sel binary, CSV, Excel or TXT file"""
    content = await file.read()
    try:
        # Extract filename without extension for auto category naming (e.g. 半导体龙头.sel -> 半导体龙头)
        import os
        base_name = os.path.splitext(file.filename)[0]
        items = FlushImporterService.parse_file(content, file.filename)
        return {"status": "success", "count": len(items), "items": items, "default_category": base_name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/confirm")
def confirm_import(payload: ConfirmImportPayload, db: Session = Depends(get_db)):
    """Batch write parsed import items into SQLite database"""
    imported_count = 0
    for item in payload.items:
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

        category = item.category if item.category else "同花顺板块"

        if item.target_type == "POSITION" and item.current_volume > 0:
            pos = db.query(Position).filter(Position.symbol == symbol).first()
            if pos:
                pos.cost_price = item.cost_price if item.cost_price > 0 else pos.cost_price
                pos.current_volume = item.current_volume
            else:
                pos = Position(
                    symbol=symbol,
                    cost_price=item.cost_price,
                    current_volume=item.current_volume,
                    strategy_tag="同花顺导入"
                )
                db.add(pos)
        else:
            # Clean up 0-volume Position if present
            pos = db.query(Position).filter(Position.symbol == symbol).first()
            if pos and item.current_volume <= 0:
                db.delete(pos)

            # Move or keep in Watchlist
            w = db.query(Watchlist).filter(Watchlist.symbol == symbol).first()
            if not w:
                w = Watchlist(symbol=symbol, category=category if category != "同花顺板块" else "历史清仓股")
                db.add(w)
            elif category and category != "同花顺板块":
                w.category = category


        imported_count += 1

    db.commit()
    return {"status": "success", "imported_count": imported_count}
