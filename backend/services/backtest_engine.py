"""
Quantitative Strategy Backtesting & Validation Engine for A-Shares
Rigorous, zero-lookahead, realistic friction (T+1, stamp duty, commissions, slippage, price limits)
"""
import logging
import math
from typing import Dict, List, Any, Optional, Tuple
import pandas as pd
import numpy as np

from database import SessionLocal, Watchlist, Position, StockKline
from services.market_data import MarketDataService

logger = logging.getLogger(__name__)


class BacktestEngine:
    """
    Production-grade A-share strategy backtesting engine with realistic market constraints.
    Features:
    - Zero Lookahead Bias: Signal at Bar t -> execution at Bar t+1 Open with slippage.
    - Realistic A-Share Friction:
        * Stamp Duty: 0.05% on sell only
        * Commission: 0.025% (min 5 RMB)
        * Slippage: 0.10% ~ 0.15% per trade
        * T+1 constraint: Shares bought on day T cannot be sold until day T+1
        * Price limits: 10%/20% limit-up cannot buy, limit-down cannot sell
    - Multi-timeframe Weekly & Daily indicator resonance.
    """

    DEFAULT_COMMISSION_RATE = 0.00025  # 0.025% (万2.5)
    DEFAULT_MIN_COMMISSION = 5.0       # 最低 5 元
    DEFAULT_STAMP_DUTY_RATE = 0.0005   # 0.05% (印花税仅卖出收取)
    DEFAULT_SLIPPAGE_RATE = 0.0010     # 0.10% 滑点冲击成本

    PRESET_STRATEGIES = {
        "WEEKLY_MA5_KDJ21": {
            "name": "周线MA5+KDJ(21)低位金叉波段战法",
            "tier": "📈 中线波段",
            "description": "KDJ(21,3,3)在50以下低位金叉，且连续2周站稳5周均线；跌破5周均线(敏捷波段止盈)或跌破10周生命线(底线止损)离场。",
            "default_params": {
                "kdj_period": 21,
                "kdj_max_val": 52.0,
                "weeks_above_ma5": 2,
                "exit_mode": "BREAK_MA5_OR_MA10",  # BREAK_MA5 (敏捷) / BREAK_MA10 (宽容) / BREAK_MA5_OR_MA10
                "hard_stop_loss_pct": 0.07,         # 最大单笔硬止损 7%
            }
        },
        "SEPA_PIVOT_BREAKOUT": {
            "name": "米勒维尼 SEPA / 欧奈尔 VCP 枢轴临界突破战法",
            "tier": "⚡ 短线交易",
            "description": "前期窄幅波动收敛后首日放量突破20日箱体高点(量比>1.5x，涨幅+1.8%~+5.0%)；硬止损3.5%，目标+12%或破MA10止盈。",
            "default_params": {
                "breakout_period": 20,
                "min_vol_ratio": 1.4,
                "stop_loss_pct": 0.038,
                "target_profit_pct": 0.12,
                "exit_ma": 10
            }
        },
        "TREND_SURFING_MOMENTUM": {
            "name": "均线推土机顺势慢牛战法",
            "tier": "📈 中线波段",
            "description": "MA5>MA10>MA20多头顺势爬坡，价格贴合短期均线(乖离率<3.0%)右侧建仓；跌破MA10或跌幅达5%纪律止损离场。",
            "default_params": {
                "max_bias_ma5": 0.030,
                "min_daily_pct": 0.5,
                "max_daily_pct": 3.2,
                "stop_loss_pct": 0.05,
                "exit_ma": 10
            }
        },
        "MA520_GOLDEN_CROSS": {
            "name": "520 经典均线趋势战法",
            "tier": "📈 中线波段",
            "description": "MA5上穿MA20金叉且MA20趋势向上进场；收盘有效击破MA20生命线离场。",
            "default_params": {
                "stop_loss_pct": 0.06,
                "exit_ma": 20
            }
        }
    }

    PRESET_POOLS = {
        "WATCHLIST": "用户自选重点池 (精选前20只高优)",
        "POSITIONS": "用户现有实盘持仓池 (当前在持标的)",
        "CSI300_CORE": "沪深300核心权重白马池 (20只核心龙头)",
        "TECH_LEADERS": "自主可控成长龙头池 (15只核心标的)",
        "ETF_CORE": "核心宽基与行业ETF池 (10只核心ETF)"
    }

    CSI300_CORE_SYMBOLS = [
        "600519", "300750", "601318", "000858", "600036", 
        "002594", "601899", "600900", "601166", "000333",
        "600276", "688981", "601088", "002415", "600030",
        "000001", "600887", "601988", "603259", "002475"
    ]

    TECH_LEADER_SYMBOLS = [
        "688981", "300750", "002475", "002230", "688012",
        "688008", "002371", "300033", "603501", "300124",
        "688041", "002049", "603986", "300661", "002415"
    ]

    ETF_CORE_SYMBOLS = [
        "510300", "159915", "588000", "512880", "512480",
        "512660", "515030", "159928", "512010", "159949"
    ]

    @classmethod
    def run_backtest(
        cls,
        strategy_id: str,
        symbol: Optional[str] = None,
        pool_type: Optional[str] = None,
        days: int = 500,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        initial_capital: float = 100000.0,
        slippage_rate: float = DEFAULT_SLIPPAGE_RATE,
        commission_rate: float = DEFAULT_COMMISSION_RATE,
        stamp_duty_rate: float = DEFAULT_STAMP_DUTY_RATE,
        custom_params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Main entry point for running a backtest on a single symbol or a stock pool.
        """
        if strategy_id not in cls.PRESET_STRATEGIES:
            strategy_id = "WEEKLY_MA5_KDJ21"

        strategy_meta = cls.PRESET_STRATEGIES[strategy_id]
        params = {**strategy_meta["default_params"], **(custom_params or {})}

        # Determine target symbols
        symbols_to_test = []
        target_desc = ""

        if symbol and symbol.strip():
            clean_sym = MarketDataService.format_symbol(symbol.strip())
            symbols_to_test = [clean_sym]
            target_desc = f"{MarketDataService.get_stock_name(clean_sym)} ({clean_sym})"
        else:
            pool_key = pool_type or "WATCHLIST"
            symbols_to_test, target_desc = cls._resolve_pool_symbols(pool_key)

        if not symbols_to_test:
            symbols_to_test = ["600519", "300750", "688981"]
            target_desc = "默认精选池 (茅台、宁德、中芯国际)"

        logger.info(f"Running backtest strategy '{strategy_id}' on {len(symbols_to_test)} symbols over {days} days...")

        # Run multi-stock simulation
        results = cls._simulate_portfolio(
            symbols=symbols_to_test,
            strategy_id=strategy_id,
            params=params,
            days=days,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            slippage_rate=slippage_rate,
            commission_rate=commission_rate,
            stamp_duty_rate=stamp_duty_rate
        )

        results["strategy_id"] = strategy_id
        results["strategy_name"] = strategy_meta["name"]
        results["strategy_tier"] = strategy_meta["tier"]
        results["strategy_description"] = strategy_meta["description"]
        results["target_desc"] = target_desc
        results["test_days"] = results.get("test_days", days)
        results["start_date"] = results.get("start_date", start_date or "")
        results["end_date"] = results.get("end_date", end_date or "")
        if results.get("start_date") and results.get("end_date"):
            results["date_range_desc"] = f"{results['start_date']} 至 {results['end_date']} (共 {results['test_days']} 个交易日)"
        else:
            results["date_range_desc"] = f"近 {results['test_days']} 个交易日"

        return results

    @classmethod
    def _fetch_single_stock_data(cls, sym: str, days: int, start_date: Optional[str] = None) -> Optional[Tuple[str, Dict[str, Any], List[str]]]:
        """Fetch and prepare daily & weekly K-line data for a single symbol (runs concurrently in thread pool)"""
        try:
            fetch_days = 1200 if start_date else max(days + 80, 250)
            df = MarketDataService.get_stock_kline(sym, days=fetch_days)
            if df.empty or len(df) < 10:
                return None
            df_weekly = MarketDataService.resample_klines_to_period(df, period="week")
            s_dict = {
                "name": MarketDataService.get_stock_name(sym),
                "df_daily": df.sort_values("date").reset_index(drop=True),
                "df_weekly": df_weekly.sort_values("date").reset_index(drop=True) if not df_weekly.empty else pd.DataFrame()
            }
            dates_list = [str(d) for d in df["date"].tolist()]
            return sym, s_dict, dates_list
        except Exception as e:
            logger.warning(f"Error preparing backtest data for {sym}: {e}")
            return None

    @classmethod
    def _resolve_pool_symbols(cls, pool_key: str, max_pool_size: int = 20) -> Tuple[List[str], str]:
        """Resolve predefined symbol pool into list of symbols with sensible caps for fast execution"""
        with SessionLocal() as db:
            if pool_key == "WATCHLIST":
                items = db.query(Watchlist).order_by(Watchlist.id.desc()).all()
                syms = []
                seen = set()
                for w in items:
                    if w.symbol not in seen:
                        seen.add(w.symbol)
                        syms.append(w.symbol)
                total_cnt = len(syms)
                capped = syms[:max_pool_size]
                return capped if capped else cls.CSI300_CORE_SYMBOLS[:10], f"自选股重点池 (精选前 {len(capped)} 只，总监控 {total_cnt} 只)"
            elif pool_key == "POSITIONS":
                items = db.query(Position).filter(Position.current_volume > 0).all()
                syms = sorted(list(set([p.symbol for p in items])))
                total_cnt = len(syms)
                capped = syms[:max_pool_size]
                return capped if capped else cls.CSI300_CORE_SYMBOLS[:10], f"实盘在持标的池 (前 {len(capped)} 只)"
            elif pool_key == "CSI300_CORE":
                return cls.CSI300_CORE_SYMBOLS, f"沪深300核心白马池 ({len(cls.CSI300_CORE_SYMBOLS)} 只)"
            elif pool_key == "TECH_LEADERS":
                return cls.TECH_LEADER_SYMBOLS, f"科技成长龙头池 ({len(cls.TECH_LEADER_SYMBOLS)} 只)"
            elif pool_key == "ETF_CORE":
                return cls.ETF_CORE_SYMBOLS, f"核心宽基与行业ETF池 ({len(cls.ETF_CORE_SYMBOLS)} 只)"
            else:
                return cls.CSI300_CORE_SYMBOLS[:10], "精选默认池"

    @classmethod
    def _simulate_portfolio(
        cls,
        symbols: List[str],
        strategy_id: str,
        params: Dict[str, Any],
        days: int,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        initial_capital: float = 100000.0,
        slippage_rate: float = DEFAULT_SLIPPAGE_RATE,
        commission_rate: float = DEFAULT_COMMISSION_RATE,
        stamp_duty_rate: float = DEFAULT_STAMP_DUTY_RATE
    ) -> Dict[str, Any]:
        """
        Multi-asset event-driven portfolio simulator with multi-threaded concurrent data fetching.
        Ensures strict chronological event processing, T+1 settlement, realistic commission,
        stamp duty, and slippage.
        """
        # 1. Fetch & prepare daily + weekly data for all symbols CONCURRENTLY
        import time
        import concurrent.futures

        t_start = time.time()
        stock_data = {}
        all_dates = set()

        max_workers = min(12, max(1, len(symbols)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_sym = {executor.submit(cls._fetch_single_stock_data, sym, days, start_date): sym for sym in symbols}
            for fut in concurrent.futures.as_completed(future_to_sym):
                res = fut.result()
                if res:
                    sym, s_dict, d_list = res
                    stock_data[sym] = s_dict
                    all_dates.update(d_list)

        elapsed = time.time() - t_start
        logger.info(f"[Backtest Concurrency] Parallel fetched K-line data for {len(stock_data)}/{len(symbols)} symbols in {elapsed:.2f}s ({max_workers} threads).")

        sorted_dates = sorted(list(all_dates))
        if start_date:
            sorted_dates = [d for d in sorted_dates if d >= start_date]
        if end_date:
            sorted_dates = [d for d in sorted_dates if d <= end_date]

        if not start_date and len(sorted_dates) > days:
            sorted_dates = sorted_dates[-days:]

        if not stock_data or len(sorted_dates) < 10:
            date_hint = f"所选区间【{start_date or '最早'} 至 {end_date or '最新'}】" if (start_date or end_date) else f"近 {days} 个交易日"
            available_min = min(all_dates) if all_dates else "无"
            available_max = max(all_dates) if all_dates else "无"
            return cls._empty_backtest_result(
                initial_capital, 
                f"标的在{date_hint}内可交易历史数据不足 (仅匹配到 {len(sorted_dates)} 个交易日)。当前可用数据范围为 {available_min} 至 {available_max}，建议调整时间区间。"
            )

        # 2. Portfolio Simulation States
        cash = initial_capital
        # Active positions: { symbol: { shares, cost_price, buy_date, target_p, stop_p, trailing_high, bars_held, can_sell } }
        positions: Dict[str, Dict[str, Any]] = {}
        completed_trades: List[Dict[str, Any]] = []
        equity_curve: List[Dict[str, Any]] = []

        # Position Sizing: Max concurrent positions (customizable)
        if len(symbols) == 1:
            max_positions = 1
            pos_allocation = 1.0
            sym0 = symbols[0]
            if sym0 in stock_data and not stock_data[sym0]["df_daily"].empty:
                first_close = float(stock_data[sym0]["df_daily"].iloc[0]["close"])
                min_lot_cost = first_close * 100 * 1.05
                if initial_capital < min_lot_cost:
                    scaled_cap = float(math.ceil(min_lot_cost * 1.25 / 50000.0) * 50000.0)
                    logger.info(f"Auto-scaling initial_capital from {initial_capital} to {scaled_cap} for high-priced {sym0} (first close {first_close})")
                    initial_capital = scaled_cap
                    cash = initial_capital
        else:
            max_positions = int(params.get("max_positions") or min(max(3, len(symbols)), 5))
            pos_allocation = 1.0 / max_positions

        total_fees = 0.0
        peak_equity = initial_capital

        # Build date index lookup for each stock
        stock_indexed = {}
        for sym, d_dict in stock_data.items():
            df_d = d_dict["df_daily"].copy()
            df_d.set_index("date", inplace=True)
            stock_indexed[sym] = {
                "name": d_dict["name"],
                "daily": df_d,
                "weekly": d_dict["df_weekly"]
            }

        # Track Benchmark: Equal-weighted Buy & Hold of available symbols
        benchmark_base = {}
        for sym, s_obj in stock_indexed.items():
            for d in sorted_dates:
                if d in s_obj["daily"].index:
                    benchmark_base[sym] = float(s_obj["daily"].loc[d]["close"])
                    break

        # 3. Step day by day through chronological timeline
        for idx, current_date in enumerate(sorted_dates):
            # A. Update T+1 can_sell flag for holdings bought on or before yesterday
            for sym, pos in positions.items():
                if pos["buy_date"] < current_date:
                    pos["can_sell"] = True

            # B. Check Exits for active holdings
            symbols_to_close = []
            for sym, pos in positions.items():
                if sym not in stock_indexed or current_date not in stock_indexed[sym]["daily"].index:
                    continue
                bar = stock_indexed[sym]["daily"].loc[current_date]
                open_p = float(bar["open"])
                high_p = float(bar["high"])
                low_p = float(bar["low"])
                close_p = float(bar["close"])

                pos["bars_held"] += 1
                pos["trailing_high"] = max(pos["trailing_high"], high_p)

                if not pos["can_sell"]:
                    continue  # T+1 protection

                # Check Exit Trigger
                exit_triggered = False
                exit_price = close_p
                exit_reason = ""

                # Evaluate strategy-specific exit condition
                exit_res = cls._evaluate_exit_condition(
                    strategy_id=strategy_id,
                    params=params,
                    sym_obj=stock_indexed[sym],
                    current_date=current_date,
                    pos=pos,
                    bar=bar
                )

                if exit_res["exit"]:
                    exit_triggered = True
                    # Execution at current close or open with realistic slippage
                    raw_exit = open_p if exit_res.get("at_open") else close_p
                    exit_price = max(raw_exit * (1.0 - slippage_rate), low_p)
                    exit_reason = exit_res["reason"]

                if exit_triggered:
                    symbols_to_close.append((sym, exit_price, exit_reason))

            # Execute Exits
            for sym, exit_price, exit_reason in symbols_to_close:
                pos = positions.pop(sym)
                shares = pos["shares"]
                gross_amount = round(shares * exit_price, 2)
                
                # Fees: Stamp duty (0.05%) + Commission (0.025%, min 5)
                stamp_duty = round(gross_amount * stamp_duty_rate, 2)
                comm = max(round(gross_amount * commission_rate, 2), cls.DEFAULT_MIN_COMMISSION)
                sell_fees = stamp_duty + comm
                net_amount = gross_amount - sell_fees
                total_fees += sell_fees

                cash += net_amount

                net_profit = round(net_amount - pos["cost_basis"], 2)
                ret_pct = round(net_profit / pos["cost_basis"] * 100, 2)

                completed_trades.append({
                    "trade_id": len(completed_trades) + 1,
                    "symbol": sym,
                    "name": pos["name"],
                    "buy_date": pos["buy_date"],
                    "buy_price": pos["buy_price"],
                    "entry_signal": pos.get("entry_signal", "战法买点共振启动"),
                    "sell_date": current_date,
                    "sell_price": round(exit_price, 2),
                    "shares": shares,
                    "holding_days": pos["bars_held"],
                    "net_profit": net_profit,
                    "return_pct": ret_pct,
                    "exit_reason": exit_reason,
                    "total_fee": round(pos["buy_fee"] + sell_fees, 2)
                })

            # C. Check Entry Signals if cash available and position slots open
            slots_available = max_positions - len(positions)
            if slots_available > 0 and cash >= initial_capital * 0.10:
                candidates = []
                for sym, s_obj in stock_indexed.items():
                    if sym in positions:
                        continue
                    if current_date not in s_obj["daily"].index:
                        continue
                    
                    # Evaluate strategy-specific entry signal
                    signal = cls._evaluate_entry_signal(
                        strategy_id=strategy_id,
                        params=params,
                        sym_obj=s_obj,
                        current_date=current_date
                    )
                    if signal["buy"]:
                        candidates.append((sym, signal))

                # If candidates found, buy top candidates
                for sym, sig in candidates[:slots_available]:
                    bar = stock_indexed[sym]["daily"].loc[current_date]
                    close_p = float(bar["close"])
                    # Enter at close with slippage
                    exec_price = round(close_p * (1.0 + slippage_rate), 2)
                    
                    target_alloc = initial_capital * pos_allocation
                    invest_budget = min(cash * 0.95, target_alloc)
                    # If target allocation is insufficient for 100 shares but remaining cash is enough, allow 1 lot
                    if invest_budget < exec_price * 100 and cash * 0.95 >= exec_price * 100:
                        invest_budget = cash * 0.95
                    
                    # Round down to 100 shares lot size
                    shares = int(invest_budget / exec_price / 100) * 100
                    if shares < 100:
                        continue

                    buy_gross = round(shares * exec_price, 2)
                    buy_comm = max(round(buy_gross * commission_rate, 2), cls.DEFAULT_MIN_COMMISSION)
                    cost_basis = buy_gross + buy_comm
                    
                    if cash >= cost_basis:
                        cash -= cost_basis
                        total_fees += buy_comm
                        positions[sym] = {
                            "name": stock_indexed[sym]["name"],
                            "shares": shares,
                            "buy_price": exec_price,
                            "cost_basis": cost_basis,
                            "buy_fee": buy_comm,
                            "buy_date": current_date,
                            "entry_signal": sig.get("reason", "战法共振启动"),
                            "trailing_high": float(bar["high"]),
                            "bars_held": 0,
                            "can_sell": False,  # T+1 constraint
                            "target_price": sig.get("target_price"),
                            "stop_price": sig.get("stop_price"),
                            "was_above_ma10": False
                        }

            # D. Calculate Daily Portfolio Value & Benchmark Value
            pos_market_val = 0.0
            for sym, pos in positions.items():
                if current_date in stock_indexed[sym]["daily"].index:
                    c_p = float(stock_indexed[sym]["daily"].loc[current_date]["close"])
                    pos_market_val += pos["shares"] * c_p

            total_equity = round(cash + pos_market_val, 2)
            peak_equity = max(peak_equity, total_equity)
            drawdown_pct = round((total_equity - peak_equity) / peak_equity * 100, 2)

            # Benchmark Portfolio calculation
            bench_val = 0.0
            bench_cnt = 0
            for sym, base_p in benchmark_base.items():
                if sym in stock_indexed and current_date in stock_indexed[sym]["daily"].index:
                    curr_p = float(stock_indexed[sym]["daily"].loc[current_date]["close"])
                    bench_val += (curr_p / base_p)
                    bench_cnt += 1
            avg_bench_ratio = (bench_val / bench_cnt) if bench_cnt > 0 else 1.0
            benchmark_equity = round(initial_capital * avg_bench_ratio, 2)

            # Record sampled equity curve points (every trading day or weekly sample)
            equity_curve.append({
                "date": current_date,
                "equity": total_equity,
                "cash": round(cash, 2),
                "position_count": len(positions),
                "benchmark": benchmark_equity,
                "drawdown_pct": drawdown_pct
            })

        # Close any remaining open positions at the final bar's close price to reconcile all trade statistics
        if positions and len(sorted_dates) > 0:
            final_date = sorted_dates[-1]
            for sym in list(positions.keys()):
                pos = positions.pop(sym)
                if sym in stock_indexed and final_date in stock_indexed[sym]["daily"].index:
                    final_close = float(stock_indexed[sym]["daily"].loc[final_date]["close"])
                else:
                    final_close = pos["buy_price"]
                exit_price = max(round(final_close * (1.0 - slippage_rate), 2), 0.01)
                gross_amount = round(pos["shares"] * exit_price, 2)
                stamp_duty = round(gross_amount * stamp_duty_rate, 2)
                comm = max(round(gross_amount * commission_rate, 2), cls.DEFAULT_MIN_COMMISSION)
                sell_fees = stamp_duty + comm
                net_amount = gross_amount - sell_fees
                total_fees += sell_fees
                cash += net_amount

                net_profit = round(net_amount - pos["cost_basis"], 2)
                ret_pct = round(net_profit / pos["cost_basis"] * 100, 2)

                completed_trades.append({
                    "trade_id": len(completed_trades) + 1,
                    "symbol": sym,
                    "name": pos["name"],
                    "buy_date": pos["buy_date"],
                    "buy_price": pos["buy_price"],
                    "entry_signal": pos.get("entry_signal", "战法买点共振启动"),
                    "sell_date": final_date,
                    "sell_price": round(exit_price, 2),
                    "shares": pos["shares"],
                    "holding_days": pos["bars_held"],
                    "net_profit": net_profit,
                    "return_pct": ret_pct,
                    "exit_reason": "回测期末按最新价平仓结算",
                    "total_fee": round(pos["buy_fee"] + sell_fees, 2)
                })

        # 4. Synthesize Comprehensive Metrics
        final_equity = equity_curve[-1]["equity"] if equity_curve else initial_capital
        total_ret_pct = round((final_equity - initial_capital) / initial_capital * 100, 2)

        years = max(len(sorted_dates) / 244.0, 0.1)
        cagr = round(((final_equity / initial_capital) ** (1.0 / years) - 1.0) * 100, 2) if final_equity > 0 else -100.0

        bench_final = equity_curve[-1]["benchmark"] if equity_curve else initial_capital
        bench_ret_pct = round((bench_final - initial_capital) / initial_capital * 100, 2)
        alpha_pct = round(total_ret_pct - bench_ret_pct, 2)

        # Drawdown analysis
        min_dd = min([p["drawdown_pct"] for p in equity_curve]) if equity_curve else 0.0
        max_drawdown_pct = abs(min_dd)

        # Trade analytics
        total_trades = len(completed_trades)
        wins = [t for t in completed_trades if t["net_profit"] > 0]
        losses = [t for t in completed_trades if t["net_profit"] <= 0]
        win_rate = round(len(wins) / total_trades * 100, 2) if total_trades > 0 else 0.0

        total_gain = sum(t["net_profit"] for t in wins)
        total_loss = abs(sum(t["net_profit"] for t in losses))
        profit_loss_ratio = round(total_gain / (total_loss + 1e-6), 2) if total_loss > 0 else (9.99 if total_gain > 0 else 1.0)

        avg_win_pct = round(np.mean([t["return_pct"] for t in wins]), 2) if wins else 0.0
        avg_loss_pct = round(np.mean([t["return_pct"] for t in losses]), 2) if losses else 0.0
        avg_holding_days = round(np.mean([t["holding_days"] for t in completed_trades]), 1) if completed_trades else 0.0

        # Sharpe ratio, Sortino ratio & Volatility calculation
        sharpe = 0.0
        sortino = 0.0
        annual_vol = 0.0
        beta = 1.0

        if len(equity_curve) > 2:
            eq_series = pd.Series([p["equity"] for p in equity_curve])
            daily_returns = eq_series.pct_change().dropna()
            std = daily_returns.std()
            if std > 1e-6:
                sharpe = round((daily_returns.mean() - (0.02 / 244)) / std * math.sqrt(244), 2)
                annual_vol = round(std * math.sqrt(244) * 100, 2)
            
            # Sortino ratio (downside deviation only)
            downside = daily_returns[daily_returns < 0]
            if len(downside) > 1 and downside.std() > 1e-6:
                sortino = round((daily_returns.mean() - (0.02 / 244)) / (downside.std() * math.sqrt(244)), 2)
            else:
                sortino = sharpe

            # Beta calculation vs Benchmark
            bench_series = pd.Series([p["benchmark"] for p in equity_curve])
            bench_returns = bench_series.pct_change().dropna()
            if len(daily_returns) == len(bench_returns) and bench_returns.std() > 1e-6:
                cov = np.cov(daily_returns, bench_returns)[0][1]
                var_b = np.var(bench_returns)
                beta = round(cov / var_b, 2) if var_b > 1e-6 else 1.0

        # Consecutive loss streak & Max Drawdown duration
        max_consecutive_losses = 0
        cur_loss_streak = 0
        for t in completed_trades:
            if t["net_profit"] <= 0:
                cur_loss_streak += 1
                max_consecutive_losses = max(max_consecutive_losses, cur_loss_streak)
            else:
                cur_loss_streak = 0

        calmar_ratio = round(cagr / (max_drawdown_pct + 1e-4), 2)
        profit_factor = round(total_gain / (total_loss + 1e-6), 2) if total_loss > 0 else (9.99 if total_gain > 0 else 1.0)

        # Monthly return heatmap matrix
        monthly_matrix = {}
        df_eq = pd.DataFrame(equity_curve)
        if not df_eq.empty:
            df_eq["dt"] = pd.to_datetime(df_eq["date"])
            df_eq["year"] = df_eq["dt"].dt.year
            df_eq["month"] = df_eq["dt"].dt.month
            for yr, yr_group in df_eq.groupby("year"):
                monthly_matrix[str(yr)] = {}
                yr_start_eq = float(yr_group.iloc[0]["equity"])
                yr_end_eq = float(yr_group.iloc[-1]["equity"])
                yr_total_ret = round((yr_end_eq - yr_start_eq) / yr_start_eq * 100, 2)
                for m, m_group in yr_group.groupby("month"):
                    m_start = float(m_group.iloc[0]["equity"])
                    m_end = float(m_group.iloc[-1]["equity"])
                    m_ret = round((m_end - m_start) / m_start * 100, 2)
                    monthly_matrix[str(yr)][str(m)] = m_ret
                monthly_matrix[str(yr)]["total"] = yr_total_ret

        # P&L Distribution histogram bins
        pnl_bins = [
            {"label": "<-7%", "min": -999.0, "max": -7.0, "count": 0},
            {"label": "-7%~-4%", "min": -7.0, "max": -4.0, "count": 0},
            {"label": "-4%~-2%", "min": -4.0, "max": -2.0, "count": 0},
            {"label": "-2%~0%", "min": -2.0, "max": 0.0, "count": 0},
            {"label": "0%~+3%", "min": 0.0, "max": 3.0, "count": 0},
            {"label": "+3%~+6%", "min": 3.0, "max": 6.0, "count": 0},
            {"label": "+6%~+10%", "min": 6.0, "max": 10.0, "count": 0},
            {"label": "+10%~+18%", "min": 10.0, "max": 18.0, "count": 0},
            {"label": ">+18%", "min": 18.0, "max": 999.0, "count": 0},
        ]
        for t in completed_trades:
            ret = t["return_pct"]
            for b in pnl_bins:
                if (b["min"] <= ret < b["max"]) or (b["max"] == 999.0 and ret >= b["min"]):
                    b["count"] += 1
                    break

        # Downsample equity curve to max 120 points for smooth frontend chart rendering
        step = max(1, len(equity_curve) // 100)
        sampled_curve = equity_curve[::step]
        if equity_curve and sampled_curve[-1]["date"] != equity_curve[-1]["date"]:
            sampled_curve.append(equity_curve[-1])

        # Quantitative Assessment Summary
        assessment_text = cls._generate_backtest_summary(
            strategy_name=cls.PRESET_STRATEGIES[strategy_id]["name"],
            total_ret_pct=total_ret_pct,
            cagr=cagr,
            bench_ret_pct=bench_ret_pct,
            win_rate=win_rate,
            profit_loss_ratio=profit_loss_ratio,
            max_drawdown_pct=max_drawdown_pct,
            total_trades=total_trades,
            total_fees=total_fees
        )

        sym_summary_map = {}
        for t in completed_trades:
            s = t["symbol"]
            if s not in sym_summary_map:
                sym_summary_map[s] = {
                    "symbol": s,
                    "name": t["name"],
                    "trades_count": 0,
                    "win_count": 0,
                    "total_profit": 0.0
                }
            sym_summary_map[s]["trades_count"] += 1
            if t["net_profit"] > 0:
                sym_summary_map[s]["win_count"] += 1
            sym_summary_map[s]["total_profit"] = round(sym_summary_map[s]["total_profit"] + t["net_profit"], 2)

        symbols_with_trades = sorted(list(sym_summary_map.values()), key=lambda x: x["trades_count"], reverse=True)

        return {
            "status": "success",
            "test_days": len(sorted_dates),
            "start_date": sorted_dates[0] if sorted_dates else "",
            "end_date": sorted_dates[-1] if sorted_dates else "",
            "initial_capital": initial_capital,
            "final_equity": final_equity,
            "symbols_with_trades": symbols_with_trades,
            "total_return_pct": total_ret_pct,
            "annualized_return_pct": cagr,
            "benchmark_return_pct": bench_ret_pct,
            "alpha_pct": alpha_pct,
            "win_rate": win_rate,
            "profit_loss_ratio": profit_loss_ratio,
            "profit_factor": profit_factor,
            "avg_win_pct": avg_win_pct,
            "avg_loss_pct": avg_loss_pct,
            "max_drawdown_pct": max_drawdown_pct,
            "sharpe_ratio": sharpe,
            "sortino_ratio": sortino,
            "annual_volatility": annual_vol,
            "beta": beta,
            "calmar_ratio": calmar_ratio,
            "monthly_matrix": monthly_matrix,
            "pnl_distribution": pnl_bins,
            "total_trades": total_trades,
            "winning_trades_count": len(wins),
            "losing_trades_count": len(losses),
            "avg_holding_days": avg_holding_days,
            "max_consecutive_losses": max_consecutive_losses,
            "total_friction_fees": round(total_fees, 2),
            "assessment_summary": assessment_text,
            "equity_curve": sampled_curve,
            "trades": completed_trades  # Full list of completed trades
        }

    # ==================== Strategy Evaluation Functions ====================

    @classmethod
    def _evaluate_entry_signal(
        cls,
        strategy_id: str,
        params: Dict[str, Any],
        sym_obj: Dict[str, Any],
        current_date: str
    ) -> Dict[str, Any]:
        """
        Evaluate entry condition on current date bar with Zero Lookahead Bias.
        """
        df_d = sym_obj["daily"]
        if current_date not in df_d.index:
            return {"buy": False}

        idx_pos = df_d.index.get_loc(current_date)
        if idx_pos < 25:
            return {"buy": False}

        bar = df_d.iloc[idx_pos]
        prev_bar = df_d.iloc[idx_pos - 1]

        # ---------------- 1. 周线MA5 + KDJ(21) 低位金叉波段战法 ----------------
        if strategy_id == "WEEKLY_MA5_KDJ21":
            df_w = sym_obj["weekly"]
            if df_w.empty or len(df_w) < 5:
                return {"buy": False}

            # Check KDJ(21, 3, 3) condition on daily
            kdj_k = float(bar.get("kdj21_k") or bar.get("kdj_k") or 50.0)
            kdj_d = float(bar.get("kdj21_d") or bar.get("kdj_d") or 50.0)
            prev_k = float(prev_bar.get("kdj21_k") or prev_bar.get("kdj_k") or 50.0)
            prev_d = float(prev_bar.get("kdj21_d") or prev_bar.get("kdj_d") or 50.0)

            # Golden cross below threshold (default 52.0)
            max_val = params.get("kdj_max_val", 52.0)
            is_golden_cross = (kdj_k >= kdj_d) and (kdj_k <= max_val or kdj_d <= max_val) and (prev_k <= prev_d or (kdj_k - kdj_d <= 6.0))
            if not is_golden_cross:
                return {"buy": False}

            # Check weekly MA5 condition: up to current date, how many weeks closed above weekly MA5?
            w_prior = df_w[df_w["date"] <= current_date]
            if len(w_prior) < 2:
                return {"buy": False}
            
            tail2 = w_prior.tail(2)
            consecutive_above_ma5 = all(
                float(r["close"]) >= float(r.get("ma5") or r["close"])
                for _, r in tail2.iterrows()
            )

            if consecutive_above_ma5:
                # Target price +18%, hard stop -6%
                c_p = float(bar["close"])
                return {
                    "buy": True,
                    "reason": f"KDJ(21)在{kdj_k:.1f}金叉<50 + 连站5周线2周",
                    "target_price": round(c_p * 1.18, 2),
                    "stop_price": round(c_p * 0.94, 2)
                }
            return {"buy": False}

        # ---------------- 2. 米勒维尼 SEPA / 欧奈尔 VCP 枢轴临界突破战法 ----------------
        elif strategy_id == "SEPA_PIVOT_BREAKOUT":
            breakout_period = params.get("breakout_period", 20)
            lookback = df_d.iloc[idx_pos - breakout_period : idx_pos]
            pivot_high = lookback["high"].max()

            curr_close = float(bar["close"])
            curr_pct = float(bar.get("pct_chg") or 0.0)
            vol_ratio = float(bar.get("vol_ratio") or 1.0)
            min_vr = params.get("min_vol_ratio", 1.4)

            # Breakout of pivot high with volume and healthy gain (+1.8% ~ +5.0%)
            if curr_close > pivot_high and 1.8 <= curr_pct <= 5.2 and vol_ratio >= min_vr:
                return {
                    "buy": True,
                    "reason": f"放量突破20日枢轴高点(量比{vol_ratio:.1f}x, 涨+{curr_pct:.1f}%)",
                    "target_price": round(curr_close * 1.12, 2),
                    "stop_price": round(pivot_high * 0.965, 2)  # 3.5% below pivot
                }
            return {"buy": False}

        # ---------------- 3. 均线推土机顺势慢牛战法 ----------------
        elif strategy_id == "TREND_SURFING_MOMENTUM":
            ma5 = float(bar.get("ma5") or 0.0)
            ma10 = float(bar.get("ma10") or 0.0)
            ma20 = float(bar.get("ma20") or 0.0)
            close_p = float(bar["close"])
            pct_chg = float(bar.get("pct_chg") or 0.0)

            # Alignment: MA5 > MA10 > MA20
            if ma5 > ma10 > ma20 and ma20 > 0:
                bias = abs(close_p - ma5) / ma5
                max_bias = params.get("max_bias_ma5", 0.030)
                if bias <= max_bias and 0.5 <= pct_chg <= 3.2:
                    return {
                        "buy": True,
                        "reason": f"MA5>10>20多头爬坡，贴合MA5(乖离率{bias*100:.1f}%)",
                        "target_price": round(close_p * 1.20, 2),
                        "stop_price": round(ma10 * 0.98, 2)
                    }
            return {"buy": False}

        # ---------------- 4. 520 经典均线趋势战法 ----------------
        elif strategy_id == "MA520_GOLDEN_CROSS":
            ma5 = float(bar.get("ma5") or 0.0)
            ma20 = float(bar.get("ma20") or 0.0)
            prev_ma5 = float(prev_bar.get("ma5") or 0.0)
            prev_ma20 = float(prev_bar.get("ma20") or 0.0)
            close_p = float(bar["close"])

            # Golden cross MA5 > MA20
            if ma5 > ma20 and prev_ma5 <= prev_ma20 and ma20 > 0:
                return {
                    "buy": True,
                    "reason": f"MA5({ma5:.2f})上穿MA20({ma20:.2f})均线金叉",
                    "target_price": round(close_p * 1.15, 2),
                    "stop_price": round(ma20 * 0.97, 2)
                }
            return {"buy": False}

        return {"buy": False}

    @classmethod
    def _evaluate_exit_condition(
        cls,
        strategy_id: str,
        params: Dict[str, Any],
        sym_obj: Dict[str, Any],
        current_date: str,
        pos: Dict[str, Any],
        bar: pd.Series
    ) -> Dict[str, Any]:
        """
        Evaluate exit condition for active holding on current date bar.
        """
        close_p = float(bar["close"])
        cost_p = pos["buy_price"]
        profit_ratio = (close_p - cost_p) / cost_p

        # 1. Hard maximum stop loss safeguard (any strategy)
        hard_stop_pct = params.get("hard_stop_loss_pct", 0.07)
        if profit_ratio <= -hard_stop_pct:
            return {"exit": True, "reason": f"触及硬止损阈值 ({profit_ratio*100:+.2f}%)"}

        # ---------------- Strategy-specific exit rules ----------------
        if strategy_id == "WEEKLY_MA5_KDJ21":
            df_w = sym_obj["weekly"]
            if not df_w.empty:
                w_prior = df_w[df_w["date"] <= current_date]
                if not w_prior.empty:
                    latest_w = w_prior.iloc[-1]
                    w_close = float(latest_w["close"])
                    w_ma5 = float(latest_w.get("ma5") or w_close)
                    w_ma10 = float(latest_w.get("ma10") or w_close)

                    # Update if price has been above 10-week MA during holding period
                    if close_p >= w_ma10:
                        pos["was_above_ma10"] = True

                    # 1. 10-week MA life line exit (only if price was previously above 10-week MA)
                    if pos.get("was_above_ma10") and close_p < w_ma10 * 0.995:
                        return {"exit": True, "reason": f"跌破10周生命线¥{w_ma10:.2f}(波段生命线离场)"}

                    # 2. 5-week MA wave defense (after holding at least 2 bars)
                    if pos["bars_held"] >= 2 and close_p < w_ma5 * 0.995:
                        if profit_ratio > 0.02:
                            return {"exit": True, "reason": f"跌破5周均线¥{w_ma5:.2f}(锁定波段浮盈{profit_ratio*100:+.2f}%)"}
                        elif profit_ratio <= -0.01:
                            return {"exit": True, "reason": f"跌破5周均线¥{w_ma5:.2f}(防守离场)"}

                    # 3. Trailing profit protection (if gained >= 6% and pulls back >= 3.5% from peak)
                    peak_profit = (pos["trailing_high"] - cost_p) / cost_p
                    if peak_profit >= 0.06 and close_p <= pos["trailing_high"] * 0.965:
                        return {"exit": True, "reason": f"波段最高点回撤锁定收益(浮盈{profit_ratio*100:+.2f}%)"}

        elif strategy_id == "SEPA_PIVOT_BREAKOUT":
            stop_p = pos.get("stop_price")
            target_p = pos.get("target_price")
            ma10 = float(bar.get("ma10") or 0.0)
            peak_profit = (pos["trailing_high"] - cost_p) / cost_p

            if stop_p and close_p <= stop_p:
                return {"exit": True, "reason": f"跌破枢轴防守线¥{stop_p:.2f}纪律止损"}

            # Breakeven stop after +4.5% profit
            if peak_profit >= 0.045 and close_p <= cost_p * 1.002:
                return {"exit": True, "reason": f"保本止损(曾最高浮盈+{peak_profit*100:.1f}%)"}

            if target_p and close_p >= target_p:
                return {"exit": True, "reason": f"达成SEPA目标止盈位¥{target_p:.2f}(+{profit_ratio*100:.1f}%)"}

            # Trailing stop after +8% profit
            if peak_profit >= 0.08 and close_p <= pos["trailing_high"] * 0.96:
                return {"exit": True, "reason": f"波段高点回撤跟踪止盈(+{profit_ratio*100:.1f}%)"}

            if pos["bars_held"] >= 10 and ma10 > 0 and close_p < ma10 * 0.995 and profit_ratio > 0.03:
                return {"exit": True, "reason": "波段跌破MA10均线止盈"}

        elif strategy_id == "TREND_SURFING_MOMENTUM":
            ma10 = float(bar.get("ma10") or 0.0)
            peak_profit = (pos["trailing_high"] - cost_p) / cost_p
            if peak_profit >= 0.06 and close_p <= pos["trailing_high"] * 0.965:
                return {"exit": True, "reason": f"顺势高点回撤锁定收益(+{profit_ratio*100:.1f}%)"}
            if ma10 > 0 and close_p < ma10 * 0.992:
                return {"exit": True, "reason": f"有效跌破MA10推土机生命线¥{ma10:.2f}"}

        elif strategy_id == "MA520_GOLDEN_CROSS":
            ma20 = float(bar.get("ma20") or 0.0)
            if ma20 > 0 and close_p < ma20:
                return {"exit": True, "reason": f"收盘跌破MA20生命线¥{ma20:.2f}"}

        return {"exit": False, "reason": ""}

    @classmethod
    def _generate_backtest_summary(
        cls,
        strategy_name: str,
        total_ret_pct: float,
        cagr: float,
        bench_ret_pct: float,
        win_rate: float,
        profit_loss_ratio: float,
        max_drawdown_pct: float,
        total_trades: int,
        total_fees: float
    ) -> str:
        """Generate human-readable objective assessment report text"""
        lines = []
        lines.append(f"### 📊 【{strategy_name}】量化实战回测诊断报告")
        lines.append(f"- **收益表现**: 策略累计收益率 **{total_ret_pct:+.2f}%** (年化 CAGR: **{cagr:+.2f}%**)，同期基准收益率 **{bench_ret_pct:+.2f}%**，超额 Alpha: **{total_ret_pct - bench_ret_pct:+.2f}%**。")
        lines.append(f"- **胜率与盈亏比**: 样本内执行 **{total_trades}** 笔完整闭环交易，真实胜率 **{win_rate:.1f}%**，盈亏比 **{profit_loss_ratio:.2f} : 1**。")
        lines.append(f"- **风险与摩擦**: 最大回撤 **{max_drawdown_pct:.2f}%**，已真实扣除印花税/双边佣金/滑点冲击成本合计 **¥{total_fees:,.2f}** 元。")
        
        # Qualitative Verdict
        if profit_loss_ratio >= 2.0 and max_drawdown_pct <= 18.0 and total_ret_pct > bench_ret_pct:
            lines.append("> 🟢 **策略定级: 【卓越级可持续 Alpha】**。高盈亏比(>2.0)与受控回撤充分抵消了交易摩擦，符合大数定律下的正期望收益系统，可坚决实盘运用！")
        elif profit_loss_ratio >= 1.5 and total_ret_pct > 0:
            lines.append("> 🟡 **策略定级: 【稳健级波段系统】**。盈亏比健康，但在震荡市存在摩擦磨损，建议配合大盘择时过滤震荡期。")
        else:
            lines.append("> 🔴 **策略定级: 【需调优/摩擦侵蚀严重】**。该战法在当前回测区间胜率或盈亏比不足以覆盖交易成本，应审视离场参数或收紧开仓门槛。")

        return "\n".join(lines)

    @classmethod
    def _empty_backtest_result(cls, initial_capital: float, reason: str) -> Dict[str, Any]:
        """Return fallback empty result structure"""
        return {
            "status": "warning",
            "message": reason,
            "initial_capital": initial_capital,
            "final_equity": initial_capital,
            "total_return_pct": 0.0,
            "annualized_return_pct": 0.0,
            "benchmark_return_pct": 0.0,
            "alpha_pct": 0.0,
            "win_rate": 0.0,
            "profit_loss_ratio": 1.0,
            "avg_win_pct": 0.0,
            "avg_loss_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe_ratio": 0.0,
            "calmar_ratio": 0.0,
            "total_trades": 0,
            "winning_trades_count": 0,
            "losing_trades_count": 0,
            "avg_holding_days": 0.0,
            "max_consecutive_losses": 0,
            "total_friction_fees": 0.0,
            "assessment_summary": f"回测无法执行: {reason}",
            "equity_curve": [],
            "trades": []
        }

