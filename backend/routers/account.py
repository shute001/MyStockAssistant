from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, AccountFund, Position, Stock, bj_now
from services.market_data import MarketDataService

router = APIRouter(prefix="/account", tags=["Account Funds"])

class AccountFundPayload(BaseModel):
    total_assets: float
    available_cash: float
    cash_balance: Optional[float] = 0.0
    withdrawable_cash: Optional[float] = 0.0
    frozen_amount: Optional[float] = 0.0

def get_account_fund_summary(db: Session) -> dict:
    """Calculate Flush-style 9-cell account capital metrics with real-time stock valuation"""
    fund = db.query(AccountFund).first()
    if not fund:
        fund = AccountFund(
            total_assets=195305.74,
            available_cash=67316.68,
            cash_balance=314.13,
            withdrawable_cash=314.13,
            frozen_amount=-67002.55,
            updated_at=bj_now()
        )
        db.add(fund)
        db.commit()
        db.refresh(fund)

    positions = db.query(Position).all()
    symbols = [p.symbol for p in positions]
    quotes = MarketDataService.get_batch_realtime_quotes(symbols) if symbols else {}

    market_value = 0.0
    holding_pnl = 0.0
    daily_pnl = 0.0

    for p in positions:
        if not p.current_volume or p.current_volume <= 0:
            continue
        q = quotes.get(p.symbol, {})
        current_p = q.get("current_price") or p.cost_price or 0.0
        pct_chg_num = q.get("pct_chg_num", 0.0) or 0.0

        pos_val = current_p * p.current_volume
        pos_pnl = (current_p - (p.cost_price or 0.0)) * p.current_volume
        pos_daily_pnl = pos_val * (pct_chg_num / 100.0)

        market_value += pos_val
        holding_pnl += pos_pnl
        daily_pnl += pos_daily_pnl

    total_assets = fund.total_assets if (fund.total_assets or 0) > 0 else ((fund.available_cash or 0) + market_value)
    position_ratio = round((market_value / total_assets * 100), 2) if total_assets > 0 else 0.0
    daily_pnl_pct = round((daily_pnl / total_assets * 100), 2) if total_assets > 0 else 0.0

    return {
        "cash_balance": round(fund.cash_balance or 0.0, 2),
        "withdrawable_cash": round(fund.withdrawable_cash or 0.0, 2),
        "holding_pnl": round(holding_pnl, 2),
        "frozen_amount": round(fund.frozen_amount or 0.0, 2),
        "market_value": round(market_value, 2),
        "daily_pnl": round(daily_pnl, 2),
        "available_cash": round(fund.available_cash or 0.0, 2),
        "total_assets": round(total_assets, 2),
        "daily_pnl_pct": f"{daily_pnl_pct:+.2f}%",
        "position_ratio": f"{position_ratio:.2f}%",
        "position_ratio_num": position_ratio,
        "updated_at": fund.updated_at.strftime("%Y-%m-%d %H:%M:%S") if fund.updated_at else "—"
    }

@router.get("/funds")
def get_account_funds(db: Session = Depends(get_db)):
    """Fetch Flush-style account capital summary"""
    return get_account_fund_summary(db)

@router.post("/funds")
@router.put("/funds")
def update_account_funds(payload: AccountFundPayload, db: Session = Depends(get_db)):
    """Update user account funds (total assets, available cash, cash balance, etc.)"""
    fund = db.query(AccountFund).first()
    if not fund:
        fund = AccountFund()
        db.add(fund)

    fund.total_assets = payload.total_assets
    fund.available_cash = payload.available_cash
    fund.cash_balance = payload.cash_balance if payload.cash_balance is not None else fund.cash_balance
    fund.withdrawable_cash = payload.withdrawable_cash if payload.withdrawable_cash is not None else fund.withdrawable_cash
    fund.frozen_amount = payload.frozen_amount if payload.frozen_amount is not None else fund.frozen_amount
    fund.updated_at = bj_now()

    db.commit()
    return {"status": "success", "funds": get_account_fund_summary(db)}
