import logging
import datetime
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import urllib.request
import urllib.parse
import codecs
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import StockKline, Watchlist, Position, Stock, SessionLocal, bj_now

logger = logging.getLogger(__name__)

# Attempt to import akshare and pandas_ta
try:
    import akshare as ak
    HAS_AKSHARE = True
except ImportError:
    HAS_AKSHARE = False
    logger.warning("AkShare not installed. Running in fallback mode.")

try:
    import pandas_ta as ta
    HAS_PANDAS_TA = True
except ImportError:
    HAS_PANDAS_TA = False

class MarketDataService:
    """A-Share Market Data & Quantitative Indicators Service with 1-Year Local Storage Engine"""

    _quote_health: Dict[str, Any] = {
        "status": "unknown",
        "source": "Tencent Finance",
        "updated_at": None,
        "message": "尚未请求行情"
    }
    _kline_health: Dict[str, Any] = {
        "status": "unknown",
        "source": None,
        "updated_at": None,
        "message": "尚未请求 K 线"
    }

    _STOCK_NAME_CACHE: Dict[str, str] = {
        "600519": "贵州茅台",
        "000001": "平安银行",
        "300750": "宁德时代",
        "688001": "华兴源创",
        "000002": "万科A",
        "600036": "招商银行",
        "601318": "中国平安",
        "002475": "立讯精密",
        "688981": "中芯国际",
        "159883": "医疗器械ETF",
        "512480": "半导体ETF",
        "512690": "酒ETF",
        "515030": "新能源车ETF",
        "601127": "赛力斯",
        "300059": "东方财富",
        "300308": "中际旭创"
    }

    @staticmethod
    def format_symbol(symbol: str) -> str:
        """Format 6-digit stock code"""
        symbol = str(symbol).strip()
        if len(symbol) < 6:
            symbol = symbol.zfill(6)
        return symbol

    @staticmethod
    def _now_text() -> str:
        return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")

    @classmethod
    def get_data_health(cls) -> Dict[str, Dict[str, Any]]:
        """Return non-price metadata so clients can distinguish live, delayed and mock data."""
        return {
            "quote": dict(cls._quote_health),
            "kline": dict(cls._kline_health)
        }

    @staticmethod
    def get_symbol_prefix_and_market(symbol: str) -> tuple[str, str]:
        """
        Returns (prefix, market) for Stocks & ETF Funds.
        Prefixes: 'sh', 'sz', 'bj'
        Market: '1' (Shanghai), '0' (Shenzhen/Beijing)
        """
        s = str(symbol).strip().zfill(6)
        if s.startswith("5") or s.startswith("6") or s.startswith("9"):
            return "sh", "1"
        elif s.startswith("1") or s.startswith("0") or s.startswith("3") or s.startswith("2"):
            return "sz", "0"
        else:
            return "bj", "0"

    @classmethod
    def get_stock_name(cls, symbol: str) -> str:
        """Resolve A-share stock & ETF symbol to real Chinese name using Tencent Finance API"""
        symbol = cls.format_symbol(symbol)
        if symbol in cls._STOCK_NAME_CACHE:
            return cls._STOCK_NAME_CACHE[symbol]

        prefix, _ = cls.get_symbol_prefix_and_market(symbol)
        url = f"http://qt.gtimg.cn/q=s_{prefix}{symbol}"

        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            res = urllib.request.urlopen(req, timeout=3).read().decode('gbk', errors='ignore')
            parts = res.split('~')
            if len(parts) > 2 and parts[1].strip():
                name = parts[1].strip()
                cls._STOCK_NAME_CACHE[symbol] = name
                return name
        except Exception as e:
            logger.warning(f"Failed to fetch stock/ETF name for {symbol}: {e}")

        return f"代码{symbol}"

    @classmethod
    def search_stock_by_query(cls, query: str) -> List[Dict[str, str]]:
        """
        Smart stock & ETF fuzzy search engine using Tencent Smartbox API.
        Resolves arbitrary stock names (e.g., '茅台', '立讯精密', '医疗器械ETF') or codes (e.g., '688981')
        into canonical 6-digit symbols and human-friendly names in milliseconds.
        """
        query = str(query).strip()
        if not query:
            return []

        # 1. Direct match if 6-digit code
        if query.isdigit() and len(query) == 6:
            name = cls.get_stock_name(query)
            return [{"symbol": query, "name": name, "type": "GP-A"}]

        # 2. Check in-memory cache
        for sym, n in cls._STOCK_NAME_CACHE.items():
            if query == n or (len(query) >= 2 and query in n):
                return [{"symbol": sym, "name": n, "type": "GP-A"}]

        # 3. Call Tencent Smartbox API
        try:
            encoded_q = urllib.parse.quote(query)
            url = f"http://smartbox.gtimg.cn/s3/?t=all&q={encoded_q}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            res = urllib.request.urlopen(req, timeout=3).read().decode('gbk', errors='ignore')
            
            raw = res.split('"')[1] if '"' in res else ""
            results = []
            for part in raw.split('^'):
                fields = part.split('~')
                if len(fields) >= 5:
                    prefix, code, name, pinyin, stype = fields[0], fields[1], fields[2], fields[3], fields[4]
                    try:
                        name = codecs.decode(name, 'unicode_escape')
                    except Exception:
                        pass
                    # Filter for A-shares, ETFs, LOFs, indices
                    if any(k in stype for k in ['GP', 'ETF', 'LOF', 'KJ']):
                        code = cls.format_symbol(code)
                        cls._STOCK_NAME_CACHE[code] = name
                        results.append({"symbol": code, "name": name, "type": stype})
            return results[:6]
        except Exception as e:
            logger.warning(f"Error searching stock by query '{query}': {e}")
            return []

    @classmethod
    def enrich_stock_names(cls, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Batch enrich stock/ETF names in import list if missing or default"""
        for item in items:
            symbol = item.get("symbol", "")
            current_name = item.get("name", "")
            if not current_name or current_name.startswith("股票") or current_name.startswith("代码") or current_name == symbol:
                item["name"] = cls.get_stock_name(symbol)
        return items

    @classmethod
    def get_batch_realtime_quotes(cls, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """Fetch batch real-time prices for Stocks & ETFs in 1 request (50ms)"""
        if not symbols:
            return {}

        formatted_symbols = [cls.format_symbol(s) for s in symbols]
        items = []
        for s in formatted_symbols:
            prefix, _ = cls.get_symbol_prefix_and_market(s)
            items.append(f"s_{prefix}{s}")

        url = f"http://qt.gtimg.cn/q={','.join(items)}"
        results = {}
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            res = urllib.request.urlopen(req, timeout=4).read().decode('gbk', errors='ignore')
            lines = res.strip().split(';')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                parts = line.split('~')
                if len(parts) > 5 and parts[2]:
                    name = parts[1].strip()
                    code = parts[2].zfill(6)
                    price = float(parts[3])
                    pct = float(parts[5])
                    if name:
                        cls._STOCK_NAME_CACHE[code] = name
                    results[code] = {
                        "symbol": code,
                        "name": name,
                        "current_price": price,
                        "pct_chg": f"{pct:+.2f}%",
                        "pct_chg_num": pct
                    }
            cls._quote_health = {
                "status": "live" if results else "unavailable",
                "source": "Tencent Finance",
                "updated_at": cls._now_text(),
                "message": "" if results else "行情源未返回有效报价"
            }
        except Exception as e:
            logger.warning(f"Error fetching batch quotes: {e}")
            cls._quote_health = {
                "status": "unavailable",
                "source": "Tencent Finance",
                "updated_at": cls._now_text(),
                "message": "实时行情暂不可用，界面价格可能使用成本价或空值"
            }

        return results

    @classmethod
    def get_realtime_quote(cls, symbol: str) -> Dict[str, Any]:
        """Fetch accurate real-time stock/ETF price and percentage change"""
        symbol = cls.format_symbol(symbol)
        quotes = cls.get_batch_realtime_quotes([symbol])
        if symbol in quotes:
            return quotes[symbol]
        return {
            "symbol": symbol,
            "name": cls.get_stock_name(symbol),
            "current_price": 0.0,
            "pct_chg": "0.00%",
            "pct_chg_num": 0.0
        }

    @classmethod
    def _fetch_remote_kline(cls, symbol: str, days: int = 365) -> pd.DataFrame:
        """Fetch forward-split-adjusted (qfq) daily K-lines from Tencent / EastMoney API"""
        symbol = cls.format_symbol(symbol)
        prefix, _ = cls.get_symbol_prefix_and_market(symbol)
        
        # 1. Tencent Finance qfq API
        url = f"http://proxy.finance.qq.com/ifzq/appstock/app/fqkline/get?param={prefix}{symbol},day,,,{days},qfq"
        df = pd.DataFrame()
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'http://finance.qq.com/'
            }
            req = urllib.request.Request(url, headers=headers)
            res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
            data = res.get("data", {}).get(f"{prefix}{symbol}", {})
            klines = data.get("qfqday") or data.get("day", [])
            records = []
            for bar in klines:
                close_p = float(bar[2])
                open_p = float(bar[1])
                records.append({
                    "date": bar[0],
                    "symbol": symbol,
                    "open": open_p,
                    "close": close_p,
                    "high": float(bar[3]),
                    "low": float(bar[4]),
                    "volume": int(float(bar[5])) if len(bar) > 5 else 0,
                    "amount": round(close_p * (int(float(bar[5])) if len(bar) > 5 else 0), 2),
                    "pct_chg": round((close_p - open_p) / open_p * 100, 2) if open_p > 0 else 0.0,
                    "turnover": 0.0
                })
            if records:
                df = pd.DataFrame(records)
        except Exception as e:
            logger.error(f"Error fetching Tencent K-line for {symbol}: {e}")

        # 2. Fallback to Eastmoney REST API
        if df.empty:
            _, market = cls.get_symbol_prefix_and_market(symbol)
            secid = f"{market}.{symbol}"
            url_em = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt={days}"
            try:
                req = urllib.request.Request(url_em, headers={'User-Agent': 'Mozilla/5.0'})
                res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
                data = res.get("data") if res and isinstance(res, dict) else None
                klines = data.get("klines", []) if data and isinstance(data, dict) else []
                records = []
                for line in klines:
                    parts = line.split(',')
                    records.append({
                        "date": parts[0],
                        "symbol": symbol,
                        "open": float(parts[1]),
                        "close": float(parts[2]),
                        "high": float(parts[3]),
                        "low": float(parts[4]),
                        "volume": int(parts[5]),
                        "amount": float(parts[6]),
                        "pct_chg": float(parts[8]),
                        "turnover": float(parts[10]) if len(parts) > 10 else 0.0
                    })
                if records:
                    df = pd.DataFrame(records)
            except Exception as e:
                logger.error(f"Error fetching Eastmoney K-line for {symbol}: {e}")

        # 3. Fallback to realistic mock if offline
        if df.empty:
            df = cls._generate_mock_kline(symbol, days)

        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

        df = df.sort_values("date").reset_index(drop=True)

        # Update latest bar with real-time price if market open
        quote = cls.get_realtime_quote(symbol)
        if quote["current_price"] > 0 and len(df) > 0:
            df.at[df.index[-1], "close"] = quote["current_price"]
            df.at[df.index[-1], "pct_chg"] = quote["pct_chg_num"]

        # Calculate comprehensive technical metrics (MA5~250, MACD, KDJ, RSI, BOLL, Volume MA)
        df = cls._calculate_indicators(df)
        return df

    @classmethod
    def _calculate_indicators(cls, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate comprehensive MA, MACD, KDJ, RSI, BOLL, and Volume Ratio metrics"""
        if df.empty:
            return df

        df["close"] = df["close"].astype(float)
        df["high"] = df["high"].astype(float)
        df["low"] = df["low"].astype(float)
        df["open"] = df["open"].astype(float)
        df["volume"] = df["volume"].astype(float)

        # 1. Moving Averages: Short (5, 10, 20), Mid (60, 120), Long/Annual (250)
        df["ma5"] = df["close"].rolling(window=5).mean().round(2)
        df["ma10"] = df["close"].rolling(window=10).mean().round(2)
        df["ma20"] = df["close"].rolling(window=20).mean().round(2)
        df["ma60"] = df["close"].rolling(window=60).mean().round(2)
        df["ma120"] = df["close"].rolling(window=120).mean().round(2)
        df["ma250"] = df["close"].rolling(window=250).mean().round(2)

        # 2. MACD (EMA12, EMA26, Signal 9)
        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        df["macd_dif"] = (ema12 - ema26).round(3)
        df["macd_dea"] = df["macd_dif"].ewm(span=9, adjust=False).mean().round(3)
        df["macd_hist"] = ((df["macd_dif"] - df["macd_dea"]) * 2).round(3)

        # 3. KDJ (9, 3, 3)
        low_min = df["low"].rolling(9).min()
        high_max = df["high"].rolling(9).max()
        rsv = (df["close"] - low_min) / (high_max - low_min + 1e-8) * 100
        
        k = [50.0]
        d = [50.0]
        for val in rsv.iloc[1:]:
            if np.isnan(val):
                val = 50.0
            k_val = (2/3) * k[-1] + (1/3) * val
            d_val = (2/3) * d[-1] + (1/3) * k_val
            k.append(k_val)
            d.append(d_val)
            
        df["kdj_k"] = [round(x, 2) for x in k]
        df["kdj_d"] = [round(x, 2) for x in d]
        df["kdj_j"] = [round(3 * kv - 2 * dv, 2) for kv, dv in zip(k, d)]

        # 4. RSI (6, 12, 24)
        delta = df["close"].diff()
        for period in [6, 12, 24]:
            gain = (delta.where(delta > 0, 0.0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0.0)).rolling(window=period).mean()
            rs = gain / (loss + 1e-8)
            df[f"rsi{period}"] = (100 - (100 / (1 + rs))).round(2)

        # 5. BOLL (20, 2)
        boll_mid = df["close"].rolling(window=20).mean()
        boll_std = df["close"].rolling(window=20).std()
        df["boll_mid"] = boll_mid.round(2)
        df["boll_up"] = (boll_mid + 2 * boll_std).round(2)
        df["boll_down"] = (boll_mid - 2 * boll_std).round(2)

        # 6. Volume MA & Volume Ratio (vol_ratio = Vol / Vol_MA5)
        df["vol_ma5"] = df["volume"].rolling(window=5).mean().round(0)
        df["vol_ma10"] = df["volume"].rolling(window=10).mean().round(0)
        df["vol_ratio"] = (df["volume"] / (df["vol_ma5"] + 1e-8)).round(2)

        return df

    @classmethod
    def _prepare_stock_kline_records(cls, symbol: str, days: int = 365) -> Dict[str, Any]:
        """Fetch remote K-line data, compute indicators, and prepare StockKline ORM instances without DB session."""
        symbol = cls.format_symbol(symbol)
        stk_name = cls.get_stock_name(symbol)
        try:
            df = cls._fetch_remote_kline(symbol, days=days)
            if df.empty:
                return {
                    "symbol": symbol,
                    "name": stk_name,
                    "synced_count": 0,
                    "status": "error",
                    "message": "无法获取远程K线数据",
                    "records": []
                }

            records_to_insert = []
            for _, row in df.iterrows():
                kline_obj = StockKline(
                    symbol=symbol,
                    date=str(row["date"]),
                    open=float(row.get("open", 0.0)),
                    close=float(row.get("close", 0.0)),
                    high=float(row.get("high", 0.0)),
                    low=float(row.get("low", 0.0)),
                    volume=int(row.get("volume", 0)),
                    amount=float(row.get("amount", 0.0)),
                    pct_chg=float(row.get("pct_chg", 0.0)),
                    turnover=float(row.get("turnover", 0.0)),
                    ma5=float(row["ma5"]) if pd.notna(row.get("ma5")) else None,
                    ma10=float(row["ma10"]) if pd.notna(row.get("ma10")) else None,
                    ma20=float(row["ma20"]) if pd.notna(row.get("ma20")) else None,
                    ma60=float(row["ma60"]) if pd.notna(row.get("ma60")) else None,
                    ma120=float(row["ma120"]) if pd.notna(row.get("ma120")) else None,
                    ma250=float(row["ma250"]) if pd.notna(row.get("ma250")) else None,
                    macd_dif=float(row["macd_dif"]) if pd.notna(row.get("macd_dif")) else None,
                    macd_dea=float(row["macd_dea"]) if pd.notna(row.get("macd_dea")) else None,
                    macd_hist=float(row["macd_hist"]) if pd.notna(row.get("macd_hist")) else None,
                    kdj_k=float(row["kdj_k"]) if pd.notna(row.get("kdj_k")) else None,
                    kdj_d=float(row["kdj_d"]) if pd.notna(row.get("kdj_d")) else None,
                    kdj_j=float(row["kdj_j"]) if pd.notna(row.get("kdj_j")) else None,
                    rsi6=float(row["rsi6"]) if pd.notna(row.get("rsi6")) else None,
                    rsi12=float(row["rsi12"]) if pd.notna(row.get("rsi12")) else None,
                    rsi24=float(row["rsi24"]) if pd.notna(row.get("rsi24")) else None,
                    boll_up=float(row["boll_up"]) if pd.notna(row.get("boll_up")) else None,
                    boll_mid=float(row["boll_mid"]) if pd.notna(row.get("boll_mid")) else None,
                    boll_down=float(row["boll_down"]) if pd.notna(row.get("boll_down")) else None,
                    vol_ratio=float(row["vol_ratio"]) if pd.notna(row.get("vol_ratio")) else None,
                    created_at=bj_now()
                )
                records_to_insert.append(kline_obj)

            return {
                "symbol": symbol,
                "name": stk_name,
                "synced_count": len(records_to_insert),
                "date_range": f"{df.iloc[0]['date']} ~ {df.iloc[-1]['date']}",
                "status": "success",
                "records": records_to_insert
            }
        except Exception as e:
            logger.error(f"Error preparing klines for {symbol}: {e}")
            return {
                "symbol": symbol,
                "name": stk_name,
                "synced_count": 0,
                "status": "error",
                "message": str(e),
                "records": []
            }

    @classmethod
    def sync_stock_klines_to_db(cls, db: Session, symbol: str, days: int = 365) -> Dict[str, Any]:
        """
        Pull 1-year forward-split K-lines and technical indicators into SQLite 'stock_klines' table.
        Performs upsert to guarantee persistence and eliminate redundant API calls.
        """
        prep = cls._prepare_stock_kline_records(symbol, days=days)
        if prep["status"] != "success":
            prep.pop("records", None)
            return prep

        records = prep.pop("records", [])
        symbol = prep["symbol"]
        try:
            db.query(StockKline).filter(StockKline.symbol == symbol).delete()
            db.bulk_save_objects(records)
            db.commit()
            return prep
        except Exception as e:
            db.rollback()
            logger.error(f"Error saving klines for {symbol}: {e}")
            return {
                "symbol": symbol,
                "name": prep.get("name"),
                "synced_count": 0,
                "status": "error",
                "message": str(e)
            }

    @classmethod
    def sync_all_watchlists_klines(cls, db: Session, days: int = 365, max_workers: int = 6) -> Dict[str, Any]:
        """Batch sync 1-year historical K-lines for all watchlists & positions into SQLite database concurrently"""
        t0 = time.time()
        watchlists = db.query(Watchlist).all()
        positions = db.query(Position).all()
        
        all_symbols = sorted(list(set([w.symbol for w in watchlists] + [p.symbol for p in positions])))
        if not all_symbols:
            return {"total": 0, "synced": 0, "elapsed_seconds": 0.0, "details": []}

        actual_workers = min(max_workers, max(1, len(all_symbols)))
        logger.info(f"Starting concurrent K-line sync for {len(all_symbols)} symbols with {actual_workers} workers...")

        # 1. Concurrent fetching and indicator calculation (no SQLite operations inside threads)
        fetched_results = []
        with ThreadPoolExecutor(max_workers=actual_workers) as executor:
            future_to_sym = {executor.submit(cls._prepare_stock_kline_records, sym, days): sym for sym in all_symbols}
            for future in as_completed(future_to_sym):
                try:
                    res = future.result()
                    fetched_results.append(res)
                except Exception as exc:
                    sym = future_to_sym[future]
                    logger.error(f"Worker generated an exception for {sym}: {exc}")
                    fetched_results.append({
                        "symbol": sym,
                        "name": cls.get_stock_name(sym),
                        "synced_count": 0,
                        "status": "error",
                        "message": str(exc),
                        "records": []
                    })

        # 2. Sequential atomic database persistence in main thread (prevents SQLite locking conflicts)
        success_symbols = []
        all_records_to_insert = []
        details = []

        for item in fetched_results:
            records = item.pop("records", [])
            if item.get("status") == "success" and records:
                success_symbols.append(item["symbol"])
                all_records_to_insert.extend(records)
            details.append(item)

        if success_symbols and all_records_to_insert:
            try:
                # Safe batch deletion in chunks to avoid SQLite variable limits
                for i in range(0, len(success_symbols), 500):
                    chunk = success_symbols[i:i + 500]
                    db.query(StockKline).filter(StockKline.symbol.in_(chunk)).delete(synchronize_session=False)
                
                db.bulk_save_objects(all_records_to_insert)
                db.commit()
                logger.info(f"Successfully saved {len(all_records_to_insert)} klines for {len(success_symbols)} symbols.")
            except Exception as e:
                db.rollback()
                logger.error(f"Error bulk saving klines to SQLite: {e}")
                for d in details:
                    if d.get("symbol") in success_symbols:
                        d["status"] = "error"
                        d["message"] = f"DB write error: {e}"
                        d["synced_count"] = 0

        successful_count = sum(1 for d in details if d.get("status") == "success")
        elapsed = round(time.time() - t0, 2)
        logger.info(f"Concurrent K-line sync finished: {successful_count}/{len(all_symbols)} succeeded in {elapsed}s.")

        return {
            "total": len(all_symbols),
            "synced": successful_count,
            "elapsed_seconds": elapsed,
            "details": details
        }

    @classmethod
    def get_stock_kline(cls, symbol: str, days: int = 60, db: Optional[Session] = None) -> pd.DataFrame:
        """
        Fetch stock/ETF daily K-line.
        Local Database First: checks SQLite 'stock_klines' table; if missing or stale,
        fetches remote data, writes to database, and returns calculated indicators.
        """
        symbol = cls.format_symbol(symbol)
        
        # 1. Try local database if Session provided
        if db is not None:
            try:
                db_records = db.query(StockKline).filter(
                    StockKline.symbol == symbol
                ).order_by(StockKline.date.asc()).all()

                if len(db_records) >= min(days, 30):
                    # Convert to DataFrame
                    records = []
                    for r in db_records:
                        records.append({
                            "date": r.date, "symbol": r.symbol, "open": r.open, "close": r.close,
                            "high": r.high, "low": r.low, "volume": r.volume, "amount": r.amount,
                            "pct_chg": r.pct_chg, "turnover": r.turnover, "ma5": r.ma5, "ma10": r.ma10,
                            "ma20": r.ma20, "ma60": r.ma60, "ma120": r.ma120, "ma250": r.ma250,
                            "macd_dif": r.macd_dif, "macd_dea": r.macd_dea, "macd_hist": r.macd_hist,
                            "kdj_k": r.kdj_k, "kdj_d": r.kdj_d, "kdj_j": r.kdj_j,
                            "rsi6": r.rsi6, "rsi12": r.rsi12, "rsi24": r.rsi24,
                            "boll_up": r.boll_up, "boll_mid": r.boll_mid, "boll_down": r.boll_down,
                            "vol_ratio": r.vol_ratio
                        })
                    df = pd.DataFrame(records)
                    return df.tail(days).reset_index(drop=True).replace({np.nan: None})
            except Exception as e:
                logger.warning(f"Failed to read kline from DB for {symbol}: {e}")

        # 2. Fetch remote and sync to DB
        df = cls._fetch_remote_kline(symbol, days=max(days, 365))
        if db is not None and not df.empty:
            cls.sync_stock_klines_to_db(db, symbol, days=365)

        return df.tail(days).reset_index(drop=True).replace({np.nan: None})

    @classmethod
    def get_stock_indicators_summary(cls, symbol: str, name: str = "", db: Optional[Session] = None) -> Dict[str, Any]:
        """
        Generate deep quantitative indicator summary for LLM analysis.
        Includes:
        1. Real-time quote & intraday performance
        2. Annual macro context (1-year price percentile, MA120/MA250 annual line status, 1-year high/low)
        3. Oscillators & Momentum (MACD, KDJ, RSI6/12/24, BOLL upper/mid/lower)
        4. Volume MA & Volume Ratio (vol_ratio)
        5. Recent 10-day K-line sequence (OHLCV, entity pattern, volume amplification)
        6. Quantitative morphology pattern synthesis
        """
        symbol = cls.format_symbol(symbol)
        quote = cls.get_realtime_quote(symbol)
        # Fetch 365 days to ensure annual MA250 and 1-year high/low percentiles are exact
        df = cls.get_stock_kline(symbol, days=365, db=db)
        
        if df.empty:
            return {"symbol": symbol, "name": name or cls.get_stock_name(symbol), "error": "No market data available"}

        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) > 1 else latest

        real_price = quote["current_price"] if quote["current_price"] > 0 else round(float(latest["close"]), 2)
        real_pct_chg = quote["pct_chg"] if quote["current_price"] > 0 else f"{round(float(latest.get('pct_chg', 0)), 2)}%"
        real_name = quote["name"] if (quote.get("name") and not quote["name"].startswith("股票")) else (name or cls.get_stock_name(symbol))

        # 1-Year Range & Price Percentile
        high_1y = round(float(df["high"].max()), 2)
        low_1y = round(float(df["low"].min()), 2)
        price_range = high_1y - low_1y
        price_percentile_1y = round(((real_price - low_1y) / (price_range + 1e-8)) * 100, 1) if price_range > 0 else 50.0

        # Moving Averages (Short, Mid, Annual)
        ma5 = round(float(latest.get("ma5") or real_price), 2)
        ma10 = round(float(latest.get("ma10") or real_price), 2)
        ma20 = round(float(latest.get("ma20") or real_price), 2)
        ma60 = round(float(latest.get("ma60") or real_price), 2)
        ma120 = round(float(latest.get("ma120") or real_price), 2) if latest.get("ma120") else None
        ma250 = round(float(latest.get("ma250") or real_price), 2) if latest.get("ma250") else None

        # MA trend judgment
        ma_trend = "多头排列 (强势拉升)" if ma5 > ma10 > ma20 else ("空头排列 (弱势寻底)" if ma5 < ma10 < ma20 else "均线粘合震荡整理")
        annual_line_status = "位于年线(MA250)上方，牛市多头格局" if (ma250 and real_price >= ma250) else ("跌破年线(MA250)，防范大级别熊市下行" if ma250 else "上市不足一年")

        # MACD Status
        macd_hist = round(float(latest.get("macd_hist") or 0.0), 3)
        prev_macd_hist = round(float(prev.get("macd_hist") or 0.0), 3)
        macd_dif = round(float(latest.get("macd_dif") or 0.0), 3)
        macd_dea = round(float(latest.get("macd_dea") or 0.0), 3)

        if macd_hist > 0 and prev_macd_hist <= 0:
            macd_status = "MACD零轴下方/附近金叉启动 (买点确认信号)"
        elif macd_hist < 0 and prev_macd_hist >= 0:
            macd_status = "MACD高位死叉成型 (阶段性顶部预警)"
        elif macd_hist > 0 and macd_hist > prev_macd_hist:
            macd_status = "MACD红柱连续放大，多头加速扩散"
        elif macd_hist > 0 and macd_hist <= prev_macd_hist:
            macd_status = "MACD红柱收敛，短线动能出现背离分歧"
        elif macd_hist < 0 and macd_hist < prev_macd_hist:
            macd_status = "MACD绿柱扩散，空头主导下跌"
        else:
            macd_status = "MACD绿柱收缩，止跌企稳迹象"

        # KDJ Status
        kdj_k = round(float(latest.get("kdj_k") or 50.0), 2)
        kdj_d = round(float(latest.get("kdj_d") or 50.0), 2)
        kdj_j = round(float(latest.get("kdj_j") or 50.0), 2)
        if kdj_j < 15:
            kdj_status = "KDJ极度超跌超卖区 (随时引发探底反弹)"
        elif kdj_j > 85:
            kdj_status = "KDJ严重超买钝化区 (严禁追高，警惕冲高回落)"
        elif kdj_k > kdj_d and float(prev.get("kdj_k", 50)) <= float(prev.get("kdj_d", 50)):
            kdj_status = "KDJ低位金叉成型"
        else:
            kdj_status = "KDJ中位常态运行"

        # RSI Status
        rsi6 = round(float(latest.get("rsi6") or 50.0), 2)
        rsi12 = round(float(latest.get("rsi12") or 50.0), 2)
        rsi24 = round(float(latest.get("rsi24") or 50.0), 2)
        if rsi6 > 80:
            rsi_status = "RSI超买区 (逼近短期天花板)"
        elif rsi6 < 20:
            rsi_status = "RSI超跌区 (极具博反弹赔率)"
        elif rsi6 > 55:
            rsi_status = "RSI位于强势多头区间 (买盘活跃)"
        else:
            rsi_status = "RSI弱势整理中"

        # BOLL Status
        boll_up = round(float(latest.get("boll_up") or real_price * 1.1), 2)
        boll_mid = round(float(latest.get("boll_mid") or real_price), 2)
        boll_down = round(float(latest.get("boll_down") or real_price * 0.9), 2)
        if real_price >= boll_up:
            boll_status = "强势触碰/突破布林带上轨 (超强攻或加速赶顶)"
        elif real_price <= boll_down:
            boll_status = "跌破布林带下轨 (严重超跌，关注中轨回抽)"
        elif real_price > boll_mid:
            boll_status = "运行于布林带中轨上方 (多头防守中轨)"
        else:
            boll_status = "运行于布林带中轨下方 (受中轨反压)"

        # Volume & Volume Ratio
        vol_ratio = round(float(latest.get("vol_ratio") or 1.0), 2)
        if vol_ratio >= 1.8:
            vol_status = f"显著放量突破 (量比 {vol_ratio}x 5日均量，主力介入)"
        elif vol_ratio >= 1.2:
            vol_status = f"温和放量 (量比 {vol_ratio}x)"
        elif vol_ratio <= 0.65:
            vol_status = f"缩量洗盘/回踩 (量比仅 {vol_ratio}x，抛压衰竭)"
        else:
            vol_status = f"平量运行 (量比 {vol_ratio}x)"

        # Extract Recent 10-Day K-Line Detailed Sequence
        recent_10_df = df.tail(10)
        recent_klines = []
        for _, row in recent_10_df.iterrows():
            c_p = float(row["close"])
            o_p = float(row["open"])
            h_p = float(row["high"])
            l_p = float(row["low"])
            p_chg = float(row.get("pct_chg", 0.0))
            v_rat = float(row.get("vol_ratio", 1.0))
            
            # Entity morphology description
            entity_pct = abs(c_p - o_p) / (o_p + 1e-8) * 100
            if p_chg > 4.5:
                candle_type = "大阳线突破"
            elif p_chg > 1.5:
                candle_type = "中阳线上攻"
            elif p_chg < -4.5:
                candle_type = "大阴线杀跌"
            elif p_chg < -1.5:
                candle_type = "中阴线回调"
            elif (h_p - max(o_p, c_p)) > 2 * (abs(c_p - o_p) + 1e-4):
                candle_type = "冲高长上影线 (压力显现)"
            elif (min(o_p, c_p) - l_p) > 2 * (abs(c_p - o_p) + 1e-4):
                candle_type = "探底长下影线 (支撑强劲)"
            else:
                candle_type = "窄幅小阳小阴/十字星"

            recent_klines.append({
                "date": str(row["date"]),
                "open": round(o_p, 2),
                "close": round(c_p, 2),
                "high": round(h_p, 2),
                "low": round(l_p, 2),
                "pct_chg": f"{p_chg:+.2f}%",
                "vol_ratio": f"{v_rat:.2f}x",
                "candle_pattern": candle_type
            })

        # Pattern Synthesis
        up_count = sum(1 for k in recent_klines[-3:] if "+" in k["pct_chg"])
        pattern_synthesis = []
        if up_count == 3:
            pattern_synthesis.append("近3日连续收阳 (多头接力形态)")
        elif up_count == 0:
            pattern_synthesis.append("近3日连续收阴 (空头下挫形态)")
        
        if real_price > ma20 and prev.get("close", 0) <= prev.get("ma20", 0):
            pattern_synthesis.append("放量突破20日生命线")
        elif real_price >= ma5 and abs(real_price - ma5) / (ma5 + 1e-8) < 0.01:
            pattern_synthesis.append("回踩5日均线企稳支撑")

        kline_pattern_summary = "；".join(pattern_synthesis) if pattern_synthesis else "沿短期均线波段运行"

        return {
            "symbol": symbol,
            "name": real_name,
            "date": str(latest["date"]),
            "current_price": real_price,
            "pct_chg": real_pct_chg,
            "open": round(float(latest["open"]), 2),
            "high": round(float(latest["high"]), 2),
            "low": round(float(latest["low"]), 2),
            "volume": int(latest["volume"]),
            "turnover": f"{round(float(latest.get('turnover', 0)), 2)}%",
            "vol_ratio": vol_ratio,
            "vol_status": vol_status,
            # Annual Context
            "high_1y": high_1y,
            "low_1y": low_1y,
            "price_percentile_1y": f"{price_percentile_1y}%",
            "annual_line_status": annual_line_status,
            # Moving Averages
            "ma5": ma5,
            "ma10": ma10,
            "ma20": ma20,
            "ma60": ma60,
            "ma120": ma120,
            "ma250": ma250,
            "ma_trend": ma_trend,
            # Oscillators
            "macd_dif": macd_dif,
            "macd_dea": macd_dea,
            "macd_hist": macd_hist,
            "macd_status": macd_status,
            "kdj_k": kdj_k,
            "kdj_d": kdj_d,
            "kdj_j": kdj_j,
            "kdj_status": kdj_status,
            "rsi6": rsi6,
            "rsi12": rsi12,
            "rsi24": rsi24,
            "rsi_status": rsi_status,
            "boll_up": boll_up,
            "boll_mid": boll_mid,
            "boll_down": boll_down,
            "boll_status": boll_status,
            "support_price": round(float(df.tail(30)["low"].min()), 2),
            "resistance_price": round(float(df.tail(30)["high"].max()), 2),
            # Detailed sequences
            "recent_10_klines": recent_klines,
            "kline_pattern_summary": kline_pattern_summary
        }

    @classmethod
    def _generate_mock_kline(cls, symbol: str, days: int = 60) -> pd.DataFrame:
        """Generate realistic mock stock price data if network/API is offline"""
        quote = cls.get_realtime_quote(symbol)
        np.random.seed(int(symbol) if symbol.isdigit() else 600519)
        
        base_price = quote["current_price"] if quote["current_price"] > 0 else (100.0 + (int(symbol) % 200) if symbol.isdigit() else 1600.0)
        
        dates = [
            (datetime.datetime.now() - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(days, 0, -1)
        ]
        
        prices = [base_price]
        for _ in range(days - 1):
            change = np.random.normal(0.001, 0.02)
            prices.append(prices[-1] * (1 + change))
            
        records = []
        for i, date in enumerate(dates):
            close = prices[i]
            open_p = close * (1 + np.random.uniform(-0.01, 0.01))
            high = max(open_p, close) * (1 + np.random.uniform(0, 0.015))
            low = min(open_p, close) * (1 - np.random.uniform(0, 0.015))
            volume = int(np.random.uniform(50000, 500000))
            pct_chg = round((close - (prices[i-1] if i > 0 else close)) / (prices[i-1] if i > 0 else close) * 100, 2)
            
            records.append({
                "date": date, "symbol": symbol, "open": open_p, 
                "close": close, "high": high, "low": low, 
                "volume": volume, "amount": volume * close, 
                "pct_chg": pct_chg, "turnover": round(np.random.uniform(0.5, 4.0), 2)
            })
            
        return pd.DataFrame(records)

    @classmethod
    def get_market_macro_context(cls) -> Dict[str, Any]:
        """
        Fetch real-time A-Share Market Macro Overview:
        1. Major Indices (上证指数, 深证成指, 创业板指, 科创50)
        2. Top Gaining Sectors (热门领涨板块排行)
        3. Real-time Financial & Market News Headlines (大盘与板块热点资讯)
        """
        context = {
            "indices": [],
            "hot_sectors": [],
            "latest_news": [],
            "meta": {
                "updated_at": cls._now_text(),
                "status": "live",
                "fallback_sections": []
            }
        }
        
        # 1. Major Indices Quotes (Shanghai, Shenzhen, ChiNext, STAR50)
        try:
            url_indices = "http://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_sh688008"
            req = urllib.request.Request(url_indices, headers={'User-Agent': 'Mozilla/5.0'})
            res = urllib.request.urlopen(req, timeout=3).read().decode('gbk', errors='ignore')
            
            name_map = {
                "s_sh000001": "上证指数",
                "s_sz399001": "深证成指",
                "s_sz399006": "创业板指",
                "s_sh688008": "科创50"
            }
            
            for line in res.strip().split(';'):
                if '~' in line:
                    parts = line.split('~')
                    if len(parts) > 5:
                        raw_code = parts[0].split('=')[0].replace('v_', '').strip()
                        name = name_map.get(raw_code, parts[1].strip())
                        price = float(parts[3])
                        pct = float(parts[5])
                        context["indices"].append({
                            "name": name,
                            "symbol": raw_code.replace('s_', ''),
                            "price": price,
                            "pct_chg": f"{pct:+.2f}%",
                            "pct_num": pct
                        })
        except Exception as e:
            logger.warning(f"Error fetching major indices: {e}")

        if not context["indices"]:
            context["meta"]["fallback_sections"].append("指数")
            context["indices"] = [
                {"name": "上证指数", "symbol": "sh000001", "price": 3050.0, "pct_chg": "+0.15%", "pct_num": 0.15},
                {"name": "深证成指", "symbol": "sz399001", "price": 9500.0, "pct_chg": "+0.32%", "pct_num": 0.32},
                {"name": "创业板指", "symbol": "sz399006", "price": 1850.0, "pct_chg": "+0.45%", "pct_num": 0.45},
                {"name": "科创50", "symbol": "sh688008", "price": 820.0, "pct_chg": "-0.10%", "pct_num": -0.10}
            ]

        # 2. Industry Sector Heat / Top Gaining Sectors
        try:
            url_sec = "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6&po=1&np=1&fields=f12,f14,f3,f62&fid=f3&fs=m:90+t:2+f:!50"
            req = urllib.request.Request(url_sec, headers={'User-Agent': 'Mozilla/5.0'})
            res_raw = urllib.request.urlopen(req, timeout=3).read().decode('utf-8', errors='ignore')
            data = json.loads(res_raw)
            diff = data.get("data", {}).get("diff", [])
            for d in diff:
                sec_name = d.get("f14")
                pct_val = d.get("f3", 0) / 100.0 if isinstance(d.get("f3"), (int, float)) else 0.0
                if sec_name and pct_val > -100:
                    context["hot_sectors"].append({
                        "name": sec_name,
                        "pct_chg": f"{pct_val:+.2f}%",
                        "pct_num": pct_val
                    })
        except Exception as e:
            logger.warning(f"Error fetching hot sectors: {e}")

        if not context["hot_sectors"]:
            context["meta"]["fallback_sections"].append("板块")
            context["hot_sectors"] = [
                {"name": "半导体/芯片", "pct_chg": "+2.50%", "pct_num": 2.50},
                {"name": "高股息/红利", "pct_chg": "+1.80%", "pct_num": 1.80},
                {"name": "新能源汽车", "pct_chg": "+1.20%", "pct_num": 1.20}
            ]

        # 3. Sina Financial Roll News Headlines
        try:
            import re
            url_news = "https://feed.mix.sina.com.cn/api/roll/get?pageid=155&lid=1686&num=6"
            req = urllib.request.Request(url_news, headers={'User-Agent': 'Mozilla/5.0'})
            res_raw = urllib.request.urlopen(req, timeout=3).read().decode('utf-8', errors='ignore')
            data = json.loads(res_raw)
            items = data.get("result", {}).get("data", []) or []
            for item in items:
                t = item.get("title")
                if t:
                    clean_t = re.sub(r'<[^>]+>', '', t).strip()
                    if clean_t and len(clean_t) > 5:
                        context["latest_news"].append(clean_t)
        except Exception as e:
            logger.warning(f"Error fetching financial news: {e}")

        if not context["latest_news"]:
            context["meta"]["fallback_sections"].append("快讯")
            context["latest_news"] = [
                "央行维持流动性合理充裕，多重政策利好提振市场信心",
                "科技与高股息板块获主力资金持续净流入",
                "主力资金聚焦核心龙头，多只热门 ETF 获买盘加仓"
            ]

        if context["meta"]["fallback_sections"]:
            context["meta"]["status"] = "partial_fallback"
        return context

    @classmethod
    def format_macro_prompt_block(cls, context: Dict[str, Any]) -> str:
        """Format market macro overview into clear Markdown block for LLM Prompts"""
        indices_list = context.get("indices", [])
        sectors_list = context.get("hot_sectors", [])
        news_list = context.get("latest_news", [])

        indices_str = " | ".join([f"**{i['name']}**: {i['price']} ({i['pct_chg']})" for i in indices_list])
        sectors_str = "、".join([f"**{s['name']}** ({s['pct_chg']})" for s in sectors_list[:6]])
        news_str = "\n".join([f"- {n}" for n in news_list[:5]])
        meta = context.get("meta", {})
        fallback_sections = meta.get("fallback_sections", [])
        data_quality_note = (
            f"\n> ⚠️ 数据质量提示：{ '、'.join(fallback_sections) }暂不可用，相关内容为演示回退数据；不得据此给出买卖、仓位或价格建议。\n"
            if fallback_sections else "\n> 数据时间：" + str(meta.get("updated_at", "未知")) + "。\n"
        )

        block = f"""## 🌐 【全市场大盘情绪、领涨热点板块与宏观新闻背景】

### 📊 1. 今日大盘主要指数表现：
{indices_str}

### 🔥 2. 当前主力资金领涨与最热板块：
{sectors_str}

### 📰 3. 最新财经与市场重大新闻消息面：
{news_str}
{data_quality_note}
"""
        return block
