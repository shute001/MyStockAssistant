import logging
import datetime
import json
import urllib.request
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional

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
    """A-Share Market Data Service using AkShare & pandas-ta"""

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
        "601318": "中国平安"
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
    def get_stock_kline(cls, symbol: str, days: int = 60) -> pd.DataFrame:
        """Fetch stock/ETF daily K-line and compute indicators using Tencent Finance REST API"""
        symbol = cls.format_symbol(symbol)
        prefix, _ = cls.get_symbol_prefix_and_market(symbol)
        
        url = f"http://proxy.finance.qq.com/ifzq/appstock/app/fqkline/get?param={prefix}{symbol},day,,,{days},qfq"
        df = pd.DataFrame()
        kline_source = "Tencent Finance"
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'http://finance.qq.com/'
            }
            req = urllib.request.Request(url, headers=headers)
            res = json.loads(urllib.request.urlopen(req, timeout=4).read().decode('utf-8'))
            data = res.get("data", {}).get(f"{prefix}{symbol}", {})
            klines = data.get("qfqday") or data.get("day", [])
            records = []
            for bar in klines:
                close_p = float(bar[2])
                open_p = float(bar[1])
                records.append({
                    "date": bar[0],
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

        # Fallback to Eastmoney REST API if Tencent fails
        if df.empty:
            kline_source = "Eastmoney"
            _, market = cls.get_symbol_prefix_and_market(symbol)
            secid = f"{market}.{symbol}"
            url_em = f"http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt={days}"
            try:
                req = urllib.request.Request(url_em, headers={'User-Agent': 'Mozilla/5.0'})
                res = json.loads(urllib.request.urlopen(req, timeout=4).read().decode('utf-8'))
                data = res.get("data") if res and isinstance(res, dict) else None
                klines = data.get("klines", []) if data and isinstance(data, dict) else []


                records = []
                for line in klines:
                    parts = line.split(',')
                    records.append({
                        "date": parts[0],
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

        # Fallback to mock data if all APIs fail
        if df.empty:
            kline_source = "模拟数据"
            df = cls._generate_mock_kline(symbol, days)

        cls._kline_health = {
            "status": "mock" if kline_source == "模拟数据" else "live",
            "source": kline_source,
            "updated_at": cls._now_text(),
            "message": "网络行情不可用，当前图表仅用于界面演示，不能作为交易依据" if kline_source == "模拟数据" else ""
        }

        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

        # Sort chronological
        df = df.sort_values("date").reset_index(drop=True)

        # Update latest bar with accurate real-time quote if available
        quote = cls.get_realtime_quote(symbol)
        if quote["current_price"] > 0 and len(df) > 0:
            df.at[df.index[-1], "close"] = quote["current_price"]
            df.at[df.index[-1], "pct_chg"] = quote["pct_chg_num"]
        
        # Calculate Technical Indicators
        df = cls._calculate_indicators(df)
        
        # Return specified number of recent days, replacing NaN with None for JSON compliance
        df_result = df.tail(days).reset_index(drop=True)
        return df_result.replace({np.nan: None})

    @classmethod
    def get_stock_indicators_summary(cls, symbol: str, name: str = "") -> Dict[str, Any]:
        """Generate a concise indicator summary payload for LLM analysis"""
        quote = cls.get_realtime_quote(symbol)
        df = cls.get_stock_kline(symbol, days=30)
        
        if df.empty:
            return {"symbol": symbol, "name": name, "error": "No market data available"}

        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) > 1 else latest

        # Use real-time price & name if quote succeeded
        real_price = quote["current_price"] if quote["current_price"] > 0 else round(float(latest["close"]), 2)
        real_pct_chg = quote["pct_chg"] if quote["current_price"] > 0 else f"{round(float(latest.get('pct_chg', 0)), 2)}%"
        real_name = quote["name"] if (quote.get("name") and not quote["name"].startswith("股票")) else (name or f"股票{symbol}")

        # Support & Resistance Calculation (30-day min/max)
        support_price = round(df["low"].min(), 2)
        resistance_price = round(df["high"].max(), 2)

        # MACD Status
        macd_status = "平稳"
        if latest.get("macd_hist", 0) > 0 and prev.get("macd_hist", 0) <= 0:
            macd_status = "MACD低位金叉 (看多信号)"
        elif latest.get("macd_hist", 0) < 0 and prev.get("macd_hist", 0) >= 0:
            macd_status = "MACD高位死叉 (看空信号)"
        elif latest.get("macd_hist", 0) > 0:
            macd_status = "MACD多头扩散"
        elif latest.get("macd_hist", 0) < 0:
            macd_status = "MACD空头排列"

        # Moving Average Trend
        ma5, ma10, ma20 = latest.get("ma5", 0), latest.get("ma10", 0), latest.get("ma20", 0)
        ma_trend = "多头排列" if ma5 > ma10 > ma20 else ("空头排列" if ma5 < ma10 < ma20 else "震荡整理")

        return {
            "symbol": symbol,
            "name": real_name,
            "date": latest["date"],
            "current_price": real_price,
            "open": round(float(latest["open"]), 2),
            "high": round(float(latest["high"]), 2),
            "low": round(float(latest["low"]), 2),
            "pct_chg": real_pct_chg,
            "turnover": f"{round(float(latest.get('turnover', 0)), 2)}%",
            "volume": int(latest["volume"]),
            "ma5": round(float(ma5), 2),
            "ma10": round(float(ma10), 2),
            "ma20": round(float(ma20), 2),
            "ma_trend": ma_trend,
            "macd_dif": round(float(latest.get("macd_dif", 0)), 3),
            "macd_dea": round(float(latest.get("macd_dea", 0)), 3),
            "macd_hist": round(float(latest.get("macd_hist", 0)), 3),
            "macd_status": macd_status,
            "kdj_k": round(float(latest.get("kdj_k", 50)), 2),
            "kdj_d": round(float(latest.get("kdj_d", 50)), 2),
            "kdj_j": round(float(latest.get("kdj_j", 50)), 2),
            "support_price": support_price,
            "resistance_price": resistance_price
        }

    @classmethod
    def _calculate_indicators(cls, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate MA, MACD, KDJ, BOLL technical metrics"""
        df["close"] = df["close"].astype(float)
        df["high"] = df["high"].astype(float)
        df["low"] = df["low"].astype(float)
        df["open"] = df["open"].astype(float)

        # MA
        df["ma5"] = df["close"].rolling(window=5).mean()
        df["ma10"] = df["close"].rolling(window=10).mean()
        df["ma20"] = df["close"].rolling(window=20).mean()
        df["ma60"] = df["close"].rolling(window=60).mean()

        # MACD (EMA12, EMA26, Signal 9)
        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        df["macd_dif"] = ema12 - ema26
        df["macd_dea"] = df["macd_dif"].ewm(span=9, adjust=False).mean()
        df["macd_hist"] = (df["macd_dif"] - df["macd_dea"]) * 2

        # KDJ (9, 3, 3)
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
            
        df["kdj_k"] = k
        df["kdj_d"] = d
        df["kdj_j"] = 3 * df["kdj_k"] - 2 * df["kdj_d"]

        return df

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
