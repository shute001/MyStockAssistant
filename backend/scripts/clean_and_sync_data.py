import os
import sys
from pathlib import Path

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

# Add backend directory to sys.path and switch working directory
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

import sqlite3
import pandas as pd
from database import SessionLocal, Stock, Watchlist, Position, StockKline
from services.market_data import MarketDataService

def clean_database():
    db = SessionLocal()
    try:
        print("=" * 60)
        print("  1. 正在清理无效占位标的 830000...")
        print("=" * 60)
        
        # 1. Clean 830000
        del_klines = db.query(StockKline).filter(StockKline.symbol == "830000").delete()
        del_watch = db.query(Watchlist).filter(Watchlist.symbol == "830000").delete()
        del_pos = db.query(Position).filter(Position.symbol == "830000").delete()
        del_stock = db.query(Stock).filter(Stock.symbol == "830000").delete()
        db.commit()
        print(f"  -> 已清理 830000: klines={del_klines}, watchlists={del_watch}, positions={del_pos}, stocks={del_stock}")

        print("\n" + "=" * 60)
        print("  2. 正在去重自选池 (watchlists 重复条目合并)...")
        print("=" * 60)
        
        all_watchlists = db.query(Watchlist).order_by(Watchlist.id.asc()).all()
        sym_map = {}
        duplicates_removed = 0

        for w in all_watchlists:
            sym = w.symbol.strip()
            if sym not in sym_map:
                sym_map[sym] = w
            else:
                # Merge categories into first record
                first_w = sym_map[sym]
                cats = [c.strip() for c in (first_w.category or "").split(",") if c.strip()]
                new_cats = [c.strip() for c in (w.category or "").split(",") if c.strip()]
                for nc in new_cats:
                    if nc not in cats:
                        cats.append(nc)
                first_w.category = ",".join(cats)
                if not first_w.remark and w.remark:
                    first_w.remark = w.remark
                # Delete duplicate
                db.delete(w)
                duplicates_removed += 1

        db.commit()
        print(f"  -> 自选池去重完成，已合并删除 {duplicates_removed} 条重复记录！当前唯一自选标的数: {len(sym_map)}")

        print("\n" + "=" * 60)
        print("  3. 正在同步持仓标的与重点自选标的的最新 K 线 (至最新交易日与真实换手率)...")
        print("=" * 60)

        # Get positions and watchlists
        positions = db.query(Position).filter(Position.current_volume > 0).all()
        pos_symbols = [p.symbol for p in positions]
        
        watchlists = db.query(Watchlist).all()
        watch_symbols = [w.symbol for w in watchlists]

        # Prioritize positions and top watchlists
        all_target_symbols = list(dict.fromkeys(pos_symbols + watch_symbols))
        expected_date = MarketDataService.get_latest_trading_date()
        print(f"  -> 目标标的总数: {len(all_target_symbols)}, 期望最新交易日: {expected_date}")

        success_count = 0
        for i, sym in enumerate(all_target_symbols):
            res = MarketDataService.sync_stock_klines_to_db(db, sym, days=365)
            if res.get("status") == "success":
                success_count += 1
                if i < 15 or sym in pos_symbols:
                    print(f"  [{i+1}/{len(all_target_symbols)}] 同步成功: {sym} {res.get('name')} -> {res.get('date_range')}")
            else:
                print(f"  [{i+1}/{len(all_target_symbols)}] 同步失败: {sym} -> {res.get('message')}")

        print(f"\n  -> K线同步完成: {success_count}/{len(all_target_symbols)} 成功更新至最新！")

    finally:
        db.close()

if __name__ == "__main__":
    clean_database()
