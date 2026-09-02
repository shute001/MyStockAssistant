import re
import pandas as pd
from typing import List, Dict, Any
from services.market_data import MarketDataService

class FlushImporterService:
    """Flush (同花顺) Portfolio & Watchlist Import Engine"""

    @staticmethod
    def parse_clipboard_text(text: str) -> List[Dict[str, Any]]:
        """
        Parse raw text pasted from Flush desktop client or web clipboard.
        Example line format:
        "600519 贵州茅台 100 1650.50 1680.00 165050.00 2950.00 1.79%"
        "000001 平安银行 500 11.20 12.00 5600.00 400.00 7.14%"
        """
        items = []
        lines = text.strip().split("\n")

        # Regular Expressions matching stock/ETF code (6 digits) and name
        # Matches: [Symbol] [Name] [Volume/Count] [Cost Price]
        regex_pattern = re.compile(
            r'([01345689]\d{5})\s+([\u4e00-\u9fa5A-Za-z0-9\*]+)(?:\s+([\d\.,]+))?(?:\s+([\d\.,]+))?'
        )

        for line in lines:
            line = line.strip()
            if not line:
                continue

            match = regex_pattern.search(line)
            if match:
                symbol = match.group(1).zfill(6)
                name = match.group(2).strip()
                
                # Default volume and cost price if not captured
                volume = 0
                cost_price = 0.0

                raw_vol = match.group(3)
                raw_cost = match.group(4)

                if raw_vol:
                    try:
                        volume = int(float(raw_vol.replace(',', '')))
                    except ValueError:
                        volume = 0

                if raw_cost:
                    try:
                        cost_price = float(raw_cost.replace(',', ''))
                    except ValueError:
                        cost_price = 0.0

                items.append({
                    "symbol": symbol,
                    "name": name,
                    "current_volume": volume,
                    "cost_price": cost_price,
                    "raw_text": line
                })

        return MarketDataService.enrich_stock_names(items)

    @staticmethod
    def parse_sel_file(file_content: bytes) -> List[Dict[str, Any]]:
        """
        Parse Flush (同花顺) custom watchlist binary file (.sel format).
        Flush .sel files store stock and ETF codes in binary format (ASCII / GBK 6-digit codes).
        """
        items = []
        seen_symbols = set()

        # Regex matching 6-digit A-share stock & ETF symbols (starting with 0,1,3,4,5,6,8,9)
        # Supports optional market prefixes SH, SZ, BJ
        pattern = re.compile(rb'(?:SH|SZ|BJ)?([01345689]\d{5})', re.IGNORECASE)
        matches = pattern.findall(file_content)

        for match in matches:
            symbol = match.decode('ascii', errors='ignore').zfill(6)
            if symbol not in seen_symbols:
                seen_symbols.add(symbol)
                items.append({
                    "symbol": symbol,
                    "name": f"股票{symbol}",
                    "current_volume": 0,
                    "cost_price": 0.0
                })

        return MarketDataService.enrich_stock_names(items)

    @staticmethod
    def parse_file(file_content: bytes, filename: str) -> List[Dict[str, Any]]:
        """Parse exported file from Flush client (.sel, .csv, .xlsx, .xls, .txt)"""
        filename_lower = filename.lower()
        
        # Handle Flush .sel binary file
        if filename_lower.endswith(".sel"):
            return FlushImporterService.parse_sel_file(file_content)

        # Handle CSV / Excel / Text files
        items = []
        try:
            if filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
                df = pd.read_excel(file_content)
            elif filename_lower.endswith(".txt"):
                text = file_content.decode("gbk", errors="ignore")
                return FlushImporterService.parse_clipboard_text(text)
            else:
                # Flush CSV files are often encoded in GBK or GB2312
                try:
                    df = pd.read_csv(pd.io.common.BytesIO(file_content), encoding="gbk")
                except Exception:
                    df = pd.read_csv(pd.io.common.BytesIO(file_content), encoding="utf-8-sig")

            # Standardize column headers
            columns = [str(col).strip() for col in df.columns]
            df.columns = columns

            symbol_col = next((col for col in columns if "代码" in col or "Symbol" in col), None)
            name_col = next((col for col in columns if "名称" in col or "Name" in col), None)
            vol_col = next((col for col in columns if "数量" in col or "持仓" in col or "Volume" in col), None)
            cost_col = next((col for col in columns if "成本" in col or "Cost" in col), None)

            if not symbol_col:
                # Fallback binary/text parsing if CSV column headers not matched
                text = file_content.decode("gbk", errors="ignore")
                return FlushImporterService.parse_clipboard_text(text)

            for _, row in df.iterrows():
                symbol_raw = str(row[symbol_col]).strip().split(".")[0]
                if not symbol_raw.isdigit() or len(symbol_raw) > 6:
                    continue
                symbol = symbol_raw.zfill(6)
                name = str(row[name_col]).strip() if name_col and pd.notna(row[name_col]) else f"股票{symbol}"
                
                volume = 0
                if vol_col and pd.notna(row[vol_col]):
                    try:
                        volume = int(float(str(row[vol_col]).replace(",", "")))
                    except ValueError:
                        volume = 0

                cost_price = 0.0
                if cost_col and pd.notna(row[cost_col]):
                    try:
                        cost_price = float(str(row[cost_col]).replace(",", ""))
                    except ValueError:
                        cost_price = 0.0

                items.append({
                    "symbol": symbol,
                    "name": name,
                    "current_volume": volume,
                    "cost_price": cost_price
                })
        except Exception as e:
            # Fallback binary/text extraction if standard parser fails
            return FlushImporterService.parse_sel_file(file_content)

        return items
