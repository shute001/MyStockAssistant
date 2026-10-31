import re
import json
import logging
import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import ScreenerRecommendationRecord, SessionLocal, bj_now
from services.market_data import MarketDataService

logger = logging.getLogger(__name__)


class ScreenerTrackerService:
    """
    Screener Recommendation Tracker & Strategy Self-Evolution Engine.
    Tracks actual post-recommendation stock performance (win rate, profit/drawdown),
    reviews success/failure factors, and drives continuous self-tuning of screener rules.
    """

    @classmethod
    def record_recommendations_from_report(
        cls,
        db: Session,
        report_id: Optional[int],
        report_text: str,
        candidate_items: List[Dict[str, Any]],
        scope: str = "ALL"
    ) -> List[Dict[str, Any]]:
        """
        Extract recommended stocks from Screener Agent report text and create tracking snapshot records.
        """
        if not report_text or not candidate_items:
            return []

        # Find section positions
        short_pos = report_text.find("一、短线")
        if short_pos == -1:
            short_pos = report_text.find("短线交易")
        mid_pos = report_text.find("二、中线")
        if mid_pos == -1:
            mid_pos = report_text.find("中线波段")
        long_pos = report_text.find("三、长线")
        if long_pos == -1:
            long_pos = report_text.find("长线价值")

        today_str = bj_now().strftime("%Y-%m-%d")
        created_records = []

        for item in candidate_items:
            sym = item.get("symbol")
            name = item.get("name") or sym
            if not sym:
                continue

            # Check if mentioned in report
            pos_sym = report_text.find(sym)
            pos_name = report_text.find(name) if (name and len(name) >= 2) else -1
            valid_positions = [p for p in [pos_sym, pos_name] if p != -1]
            if not valid_positions:
                continue
            first_pos = min(valid_positions)

            # Determine tier
            tier_cat = "⚡ 短线交易"
            scope_tag = "SHORT_TERM"
            if short_pos != -1 and first_pos >= short_pos and (mid_pos == -1 or first_pos < mid_pos) and (long_pos == -1 or first_pos < long_pos):
                tier_cat = "⚡ 短线交易"
                scope_tag = "SHORT_TERM"
            elif mid_pos != -1 and first_pos >= mid_pos and (long_pos == -1 or first_pos < long_pos):
                tier_cat = "📈 中线波段"
                scope_tag = "MID_TERM"
            elif long_pos != -1 and first_pos >= long_pos:
                tier_cat = "🛡️ 长线价值/ETF"
                scope_tag = "LONG_TERM_ETF"
            else:
                tier_cat = "⚡ 短线交易"
                scope_tag = scope or "ALL"

            # Base price
            rec_price = float(item.get("current_price") or 0.0)
            if rec_price <= 0:
                continue

            # Extract snippet around symbol (next 400 chars) to parse stop loss and target price
            snippet = report_text[first_pos:first_pos + 600]

            # Parse stop loss price
            stop_loss = None
            sl_match = re.search(r"(?:止损|硬止损|防守)[位价\s：:]*¥?\s*([0-9]+\.?[0-9]*)", snippet)
            if sl_match:
                try:
                    val = float(sl_match.group(1))
                    if 0 < val < rec_price:
                        stop_loss = round(val, 2)
                except Exception:
                    pass
            if not stop_loss:
                # Default disciplined stop-loss: 4% for short, 6% for mid, 8% for long
                sl_ratio = 0.04 if "短线" in tier_cat else (0.06 if "中线" in tier_cat else 0.08)
                stop_loss = round(rec_price * (1.0 - sl_ratio), 2)

            # Parse target price
            target_p = None
            tp_match = re.search(r"(?:止盈|目标|预期)[位价\s：:]*¥?\s*([0-9]+\.?[0-9]*)", snippet)
            if tp_match:
                try:
                    val = float(tp_match.group(1))
                    if val > rec_price:
                        target_p = round(val, 2)
                except Exception:
                    pass
            if not target_p:
                tp_ratio = 0.06 if "短线" in tier_cat else (0.18 if "中线" in tier_cat else 0.25)
                target_p = round(rec_price * (1.0 + tp_ratio), 2)

            # Parse thesis/playbook
            thesis = ""
            th_match = re.search(r"战法[：:\s]*【?([^】\n\r]+)】?", snippet)
            if th_match:
                thesis = th_match.group(1).strip()
            if not thesis:
                thesis = f"{tier_cat}精选建仓标的"

            # Check if record already exists for today
            existing = db.query(ScreenerRecommendationRecord).filter(
                ScreenerRecommendationRecord.symbol == sym,
                ScreenerRecommendationRecord.recommend_date == today_str
            ).first()

            ind_json = json.dumps({
                "macd_status": item.get("macd_status"),
                "ma_trend": item.get("ma_trend"),
                "vol_ratio": item.get("vol_ratio"),
                "weekly_context": item.get("weekly_context"),
                "pct_chg": item.get("pct_chg")
            }, ensure_ascii=False)

            if existing:
                existing.recommend_price = rec_price
                existing.stop_loss_price = stop_loss
                existing.target_price = target_p
                existing.core_thesis = thesis
                existing.tier_category = tier_cat
                existing.indicators_snapshot = ind_json
                existing.report_id = report_id
                rec_obj = existing
            else:
                rec_obj = ScreenerRecommendationRecord(
                    report_id=report_id,
                    symbol=sym,
                    name=name,
                    scope=scope_tag,
                    tier_category=tier_cat,
                    recommend_date=today_str,
                    recommend_price=rec_price,
                    suggested_buy_range=f"¥{round(rec_price * 0.99, 2)} ~ ¥{round(rec_price * 1.01, 2)}",
                    stop_loss_price=stop_loss,
                    target_price=target_p,
                    target_profit_pct=round(((target_p - rec_price) / rec_price) * 100, 1),
                    core_thesis=thesis,
                    indicators_snapshot=ind_json,
                    status="TRACKING",
                    latest_price=rec_price,
                    current_profit_pct=0.0,
                    max_profit_pct=0.0,
                    max_loss_pct=0.0,
                    last_evaluated_at=bj_now()
                )
                db.add(rec_obj)

            created_records.append({
                "symbol": sym,
                "name": name,
                "tier": tier_cat,
                "recommend_price": rec_price,
                "stop_loss_price": stop_loss,
                "target_price": target_p
            })

        if created_records:
            try:
                db.commit()
                logger.info(f"Successfully recorded {len(created_records)} screener recommendations for tracking.")
            except Exception as e:
                db.rollback()
                logger.error(f"Failed to commit screener recommendations: {e}")

        return created_records

    @classmethod
    def normalize_strategy_name(cls, thesis: Optional[str], tier: Optional[str] = None) -> Dict[str, str]:
        """
        Normalize raw thesis snippet or core_thesis string into standardized strategy definitions,
        enabling strategy-level win rate attribution and pruning/retention analysis.
        """
        t = (thesis or "").lower()
        tier_str = tier or ""
        
        # Clean markdown characters
        clean_thesis = re.sub(r"[\*\#【】\[\]\"']", "", thesis or "").strip()
        
        if any(k in t for k in ["网格", "etf", "宽基", "定投"]):
            return {
                "strategy_id": "ETF_GRID_DYNAMIC",
                "strategy_name": "宽基/行业ETF动态网格战法",
                "tier": "🛡️ 长线价值/ETF",
                "clean_thesis": clean_thesis or "宽基/行业ETF动态网格战法",
                "description": "基于 MA20/MA60 中轴分批网格定投，反弹高抛低吸"
            }
        if any(k in t for k in ["分歧", "低吸", "主线"]):
            return {
                "strategy_id": "LEADER_DIVERGENCE_DIP",
                "strategy_name": "持续主线核心分歧低吸战法",
                "tier": "⚡ 短线交易",
                "clean_thesis": clean_thesis or "持续主线核心分歧低吸战法",
                "description": "聚焦主流赛道核心标的，分歧缩量回踩 MA5/MA10 企稳低吸"
            }
        if any(k in t for k in ["回踩", "均线", "520", "多头", "ma20"]):
            return {
                "strategy_id": "MA_TREND_PULLBACK",
                "strategy_name": "均线多头趋势回踩战法",
                "tier": "📈 中线波段",
                "clean_thesis": clean_thesis or "均线多头趋势回踩战法",
                "description": "MA5>10>20 多头排列顺势而为，回踩生命线企稳介入"
            }
        if any(k in t for k in ["突破", "canslim", "放量"]):
            return {
                "strategy_id": "CANSLIM_BREAKOUT",
                "strategy_name": "欧奈尔CANSLIM突破战法",
                "tier": "⚡ 短线交易",
                "clean_thesis": clean_thesis or "欧奈尔CANSLIM突破战法",
                "description": "高相对强度RS与关键形态放量突破，坚决设止损防假突破"
            }
        if any(k in t for k in ["股息", "红利", "roe"]):
            return {
                "strategy_id": "HIGH_DIVIDEND_DEFENSE",
                "strategy_name": "PB-ROE高股息防御战法",
                "tier": "🛡️ 长线价值/ETF",
                "clean_thesis": clean_thesis or "PB-ROE高股息防御战法",
                "description": "高股息率、高ROE、安全边际高的防御型价值战法"
            }
        if "短线" in tier_str:
            return {
                "strategy_id": "SHORT_TERM_MOMENTUM",
                "strategy_name": "短线量价博弈战法",
                "tier": "⚡ 短线交易",
                "clean_thesis": clean_thesis or "短线量价博弈精选",
                "description": "捕捉短线资金关注度与量价异动机会"
            }
        if "中线" in tier_str:
            return {
                "strategy_id": "MID_TERM_TREND",
                "strategy_name": "中线波段顺势战法",
                "tier": "📈 中线波段",
                "clean_thesis": clean_thesis or "中线波段顺势精选",
                "description": "中线右侧顺势趋势跟踪与产业成长共振"
            }
        if "长线" in tier_str:
            return {
                "strategy_id": "LONG_TERM_VALUE",
                "strategy_name": "长线价值定投战法",
                "tier": "🛡️ 长线价值/ETF",
                "clean_thesis": clean_thesis or "长线价值定投精选",
                "description": "低估值分批定投与大类资产配置"
            }
        return {
            "strategy_id": "QUANT_MULTI_FACTOR",
            "strategy_name": "多因子量化精选战法",
            "tier": tier_str or "⚡ 短线交易",
            "clean_thesis": clean_thesis or "多维量化指标精选",
            "description": "多维量化指标共振筛选"
        }

    @classmethod
    def evaluate_and_update_recommendations(
        cls, 
        db: Session, 
        days: int = 0,
        limit: int = 500
    ) -> List[ScreenerRecommendationRecord]:
        """
        Batch evaluate recommendation records against current real-time prices & historical ranges.
        Updates latest_price, current_profit_pct, max_profit_pct, and status.
        days: 0 means all history, or 7, 30, 90, 180 days.
        """
        query = db.query(ScreenerRecommendationRecord)
        if days > 0:
            cutoff_date = (bj_now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
            query = query.filter(ScreenerRecommendationRecord.recommend_date >= cutoff_date)

        records = query.order_by(desc(ScreenerRecommendationRecord.id)).limit(limit).all()

        if not records:
            return []

        all_syms = list(set(r.symbol for r in records))
        quotes_map = MarketDataService.get_batch_realtime_quotes(all_syms)

        for rec in records:
            q = quotes_map.get(rec.symbol, {})
            curr_p = float(q.get("current_price") or 0.0)
            if curr_p <= 0.0:
                continue

            rec.latest_price = curr_p
            if rec.recommend_price > 0:
                cur_profit = round(((curr_p - rec.recommend_price) / rec.recommend_price) * 100, 2)
                rec.current_profit_pct = cur_profit
                if cur_profit > rec.max_profit_pct:
                    rec.max_profit_pct = cur_profit
                if cur_profit < rec.max_loss_pct:
                    rec.max_loss_pct = cur_profit

                # Status updates
                if rec.target_price and curr_p >= rec.target_price:
                    rec.status = "HIT_TARGET"
                elif rec.stop_loss_price and curr_p <= rec.stop_loss_price:
                    rec.status = "HIT_STOP_LOSS"
                elif rec.status not in ["HIT_TARGET", "HIT_STOP_LOSS"]:
                    rec.status = "TRACKING"

            rec.last_evaluated_at = bj_now()

        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update screener evaluations: {e}")

        return records

    @classmethod
    def get_performance_summary(
        cls, 
        db: Session, 
        days: int = 0,
        tier: Optional[str] = None,
        strategy_id: Optional[str] = None,
        limit: int = 500
    ) -> Dict[str, Any]:
        """
        Get aggregated performance stats: Multi-period win rate, strategy-level scorecard (pruning/retention),
        category breakdown, and full historical track record.
        """
        records = cls.evaluate_and_update_recommendations(db, days=days, limit=limit)

        if not records:
            return {
                "total_count": 0,
                "win_count": 0,
                "loss_count": 0,
                "win_rate": 0.0,
                "avg_profit_pct": 0.0,
                "avg_max_gain_pct": 0.0,
                "avg_max_loss_pct": 0.0,
                "hit_target_count": 0,
                "hit_stop_loss_count": 0,
                "tracking_count": 0,
                "records": [],
                "by_tier": {},
                "by_strategy": [],
                "selected_days": days,
                "available_days_options": [
                    {"label": "全部历史 (长期留存)", "value": 0},
                    {"label": "近 90 天 (中期季度)", "value": 90},
                    {"label": "近 30 天 (月度跟踪)", "value": 30},
                    {"label": "近 7 天 (超短周报)", "value": 7}
                ]
            }

        # Apply in-memory filters if needed
        filtered_records = records
        if tier and tier != "ALL":
            filtered_records = [r for r in filtered_records if r.tier_category and tier in r.tier_category]

        today_date = bj_now().date()

        total = len(filtered_records)
        win_records = [r for r in filtered_records if (r.current_profit_pct > 0 or r.status == "HIT_TARGET")]
        loss_records = [r for r in filtered_records if (r.current_profit_pct < 0 or r.status == "HIT_STOP_LOSS")]
        hit_target = [r for r in filtered_records if r.status == "HIT_TARGET"]
        hit_sl = [r for r in filtered_records if r.status == "HIT_STOP_LOSS"]
        tracking = [r for r in filtered_records if r.status == "TRACKING"]

        win_rate = round((len(win_records) / total) * 100, 1) if total > 0 else 0.0
        avg_profit = round(sum(r.current_profit_pct for r in filtered_records) / total, 2) if total > 0 else 0.0
        avg_max_gain = round(sum(r.max_profit_pct for r in filtered_records) / total, 2) if total > 0 else 0.0
        avg_max_loss = round(sum(r.max_loss_pct for r in filtered_records) / total, 2) if total > 0 else 0.0

        # Tier breakdown
        by_tier = {}
        for r in filtered_records:
            cat = r.tier_category or "其他"
            if cat not in by_tier:
                by_tier[cat] = {"total": 0, "win": 0, "loss": 0, "avg_profit": 0.0, "profits": []}
            by_tier[cat]["total"] += 1
            if r.current_profit_pct > 0 or r.status == "HIT_TARGET":
                by_tier[cat]["win"] += 1
            else:
                by_tier[cat]["loss"] += 1
            by_tier[cat]["profits"].append(r.current_profit_pct)

        for cat, d in by_tier.items():
            t_count = d["total"]
            d["win_rate"] = round((d["win"] / t_count) * 100, 1) if t_count > 0 else 0.0
            d["avg_profit"] = round(sum(d["profits"]) / t_count, 2) if t_count > 0 else 0.0
            d.pop("profits", None)

        # Strategy-Level Scorecard & Attribution
        strat_map: Dict[str, Dict[str, Any]] = {}
        for r in filtered_records:
            s_info = cls.normalize_strategy_name(r.core_thesis, r.tier_category)
            s_id = s_info["strategy_id"]
            if s_id not in strat_map:
                strat_map[s_id] = {
                    "strategy_id": s_id,
                    "strategy_name": s_info["strategy_name"],
                    "tier": s_info["tier"],
                    "description": s_info["description"],
                    "total": 0,
                    "win": 0,
                    "loss": 0,
                    "hit_target_count": 0,
                    "hit_stop_loss_count": 0,
                    "profits": [],
                    "max_gains": [],
                    "max_losses": [],
                    "win_profits": [],
                    "loss_profits": []
                }
            item = strat_map[s_id]
            item["total"] += 1
            is_win = r.current_profit_pct > 0 or r.status == "HIT_TARGET"
            if is_win:
                item["win"] += 1
                item["win_profits"].append(r.current_profit_pct)
            else:
                item["loss"] += 1
                item["loss_profits"].append(abs(r.current_profit_pct))

            if r.status == "HIT_TARGET":
                item["hit_target_count"] += 1
            elif r.status == "HIT_STOP_LOSS":
                item["hit_stop_loss_count"] += 1

            item["profits"].append(r.current_profit_pct)
            item["max_gains"].append(r.max_profit_pct)
            item["max_losses"].append(r.max_loss_pct)

        by_strategy = []
        for s_id, d in strat_map.items():
            s_total = d["total"]
            s_win = d["win"]
            s_win_rate = round((s_win / s_total) * 100, 1) if s_total > 0 else 0.0
            s_avg_profit = round(sum(d["profits"]) / s_total, 2) if s_total > 0 else 0.0
            s_avg_gain = round(sum(d["max_gains"]) / s_total, 2) if s_total > 0 else 0.0
            s_avg_loss = round(sum(d["max_losses"]) / s_total, 2) if s_total > 0 else 0.0

            # Profit/loss ratio
            avg_win_val = (sum(d["win_profits"]) / len(d["win_profits"])) if d["win_profits"] else 0.0
            avg_loss_val = (sum(d["loss_profits"]) / len(d["loss_profits"])) if d["loss_profits"] else 0.0
            p_l_ratio = round(avg_win_val / avg_loss_val, 2) if avg_loss_val > 0.01 else (2.0 if avg_win_val > 0 else 0.0)

            # Advice calculation
            if s_win_rate >= 50.0 and s_avg_profit >= 0.0:
                advice_tag = "KEEP"
                advice_label = "🟢 建议保留与加权"
                advice_reason = f"实盘胜率 {s_win_rate}% 且期望收益为正，在当前行情下表现稳健，建议在选股 Agent 中持续优先采纳。"
            elif s_win_rate >= 35.0 or s_avg_gain >= 2.0:
                advice_tag = "WATCH"
                advice_label = "🟡 观察调优/防守"
                advice_reason = f"平均冲高 +{s_avg_gain}%，但受大盘退潮压制存在冲高回落，建议收紧止盈并严格防守。"
            else:
                advice_tag = "PRUNE"
                advice_label = "🔴 建议淘汰或加严"
                advice_reason = f"实盘胜率偏低({s_win_rate}%)且均收益为 {s_avg_profit}%，破位套牢风险大，建议降权、熔断或重新加严过滤门槛。"

            by_strategy.append({
                "strategy_id": s_id,
                "strategy_name": d["strategy_name"],
                "tier": d["tier"],
                "description": d["description"],
                "total": s_total,
                "win": s_win,
                "loss": d["loss"],
                "win_rate": s_win_rate,
                "avg_profit": s_avg_profit,
                "avg_max_gain": s_avg_gain,
                "avg_max_loss": s_avg_loss,
                "hit_target_count": d["hit_target_count"],
                "hit_stop_loss_count": d["hit_stop_loss_count"],
                "profit_loss_ratio": p_l_ratio,
                "advice_tag": advice_tag,
                "advice_label": advice_label,
                "advice_reason": advice_reason
            })

        # Sort strategies by win rate and total count
        by_strategy.sort(key=lambda x: (x["win_rate"], x["avg_profit"]), reverse=True)

        # Filter by strategy_id if requested
        if strategy_id and strategy_id != "ALL":
            filtered_records = [
                r for r in filtered_records 
                if cls.normalize_strategy_name(r.core_thesis, r.tier_category)["strategy_id"] == strategy_id
            ]

        record_list = []
        for r in filtered_records:
            s_meta = cls.normalize_strategy_name(r.core_thesis, r.tier_category)
            
            # Calculate holding days
            h_days = 0
            if r.recommend_date:
                try:
                    rec_dt = datetime.datetime.strptime(r.recommend_date, "%Y-%m-%d").date()
                    h_days = max(0, (today_date - rec_dt).days)
                except Exception:
                    h_days = 0

            record_list.append({
                "id": r.id,
                "symbol": r.symbol,
                "name": r.name,
                "scope": r.scope,
                "tier_category": r.tier_category,
                "strategy_id": s_meta["strategy_id"],
                "strategy_name": s_meta["strategy_name"],
                "clean_thesis": s_meta["clean_thesis"],
                "recommend_date": r.recommend_date,
                "holding_days": h_days,
                "holding_days_tag": f"T+{h_days}" if h_days > 0 else "当日",
                "recommend_price": r.recommend_price,
                "latest_price": r.latest_price,
                "stop_loss_price": r.stop_loss_price,
                "target_price": r.target_price,
                "current_profit_pct": r.current_profit_pct,
                "max_profit_pct": r.max_profit_pct,
                "max_loss_pct": r.max_loss_pct,
                "status": r.status,
                "core_thesis": r.core_thesis
            })

        return {
            "total_count": total,
            "win_count": len(win_records),
            "loss_count": len(loss_records),
            "win_rate": win_rate,
            "avg_profit_pct": avg_profit,
            "avg_max_gain_pct": avg_max_gain,
            "avg_max_loss_pct": avg_max_loss,
            "hit_target_count": len(hit_target),
            "hit_stop_loss_count": len(hit_sl),
            "tracking_count": len(tracking),
            "records": record_list,
            "by_tier": by_tier,
            "by_strategy": by_strategy,
            "selected_days": days,
            "available_days_options": [
                {"label": "全部历史 (长期留存)", "value": 0},
                {"label": "近 90 天 (中期季度)", "value": 90},
                {"label": "近 30 天 (月度跟踪)", "value": 30},
                {"label": "近 7 天 (超短周报)", "value": 7}
            ]
        }

    @classmethod
    def build_screener_evolution_prompt(cls, db: Session, days: int = 0) -> str:
        """
        Builds reflection prompt containing recent recommendation track record and outcome statistics,
        guiding LLM to review performance, identify root causes, and output strategy evolution rules.
        """
        stats = cls.get_performance_summary(db, days=days)
        macro_context = MarketDataService.get_market_macro_context()
        macro_block = MarketDataService.format_macro_prompt_block(macro_context)

        records = stats.get("records", [])
        if not records:
            return "当前暂无足够的历史推选数据。请先执行几次【智能选股 Agent】生成推选，系统积累跟踪样本后即可开展深度胜率复盘与策略自优化！"

        # Separate winners and losers
        winners = [r for r in records if r["current_profit_pct"] > 0 or r["status"] == "HIT_TARGET"]
        losers = [r for r in records if r["current_profit_pct"] < 0 or r["status"] == "HIT_STOP_LOSS"]

        winners_summary = "\n".join([
            f"- **{w['name']} ({w['symbol']})** [{w['tier_category']} | {w.get('strategy_name', '量化战法')}]: 推荐价 ¥{w['recommend_price']} → 最新价 ¥{w['latest_price']} (当前: {w['current_profit_pct']:+.2f}%, 最大冲高: +{w['max_profit_pct']}%), 状态: {w['status']}, 核心战法: {w['clean_thesis']}"
            for w in winners[:10]
        ]) or "暂无显著盈利样本"

        losers_summary = "\n".join([
            f"- **{l['name']} ({l['symbol']})** [{l['tier_category']} | {l.get('strategy_name', '量化战法')}]: 推荐价 ¥{l['recommend_price']} → 最新价 ¥{l['latest_price']} (当前: {l['current_profit_pct']:+.2f}%, 最大回撤: {l['max_loss_pct']}%), 状态: {l['status']}, 核心战法: {l['clean_thesis']}"
            for l in losers[:10]
        ]) or "暂无显著亏损/触及止损样本"

        by_strategy_list = stats.get("by_strategy", [])
        strategy_scorecard_lines = []
        for s in by_strategy_list:
            strategy_scorecard_lines.append(
                f"- **{s['strategy_name']}** [{s['tier']}]: 样本 {s['total']} 只 | 胜率 **{s['win_rate']}%** | 均收益 {s['avg_profit']:+.2f}% | 平均冲高 +{s['avg_max_gain']}% / 回撤 {s['avg_max_loss']}% | 评估建议: **{s['advice_label']}** ({s['advice_reason']})"
            )
        strategy_scorecard_block = "\n".join(strategy_scorecard_lines)

        period_desc = "历史全部留存样本" if days == 0 else f"近 {days} 天样本"

        prompt = f"""# 🧠 AI 智能选股策略实盘胜率复盘与自进化引擎

你是一位具备严谨量化回测思维与实盘反思能力的 A 股首席策略风控专家。
系统当前正在对【{period_desc}】中累积的 **{stats.get('total_count', 0)}** 只历史推选标的进行真实实盘行情对齐与策略去留归因审计。

{macro_block}

---

## 📊 历史推选真实实盘战绩追踪看板（周期：{period_desc}）：
- **总推选样本数**: {stats.get('total_count', 0)} 只
- **实盘整体胜率**: **{stats.get('win_rate', 0.0)}%** (盈利/达成目标标的: {stats.get('win_count', 0)} 只 | 亏损/触及止损: {stats.get('loss_count', 0)} 只)
- **平均累计收益率**: {stats.get('avg_profit_pct', 0.0):+.2f}%  |  **平均最高冲高涨幅**: +{stats.get('avg_max_gain_pct', 0.0):.2f}%
- **平均最大回撤**: {stats.get('avg_max_loss_pct', 0.0):.2f}%
- **达成目标止盈数**: {stats.get('hit_target_count', 0)} 只  |  **严格纪律止损数**: {stats.get('hit_stop_loss_count', 0)} 只

### 🏆 核心战法实盘胜率与策略去留评估看板：
{strategy_scorecard_block}

### 🟢 代表性跑赢与盈利标的样本：
{winners_summary}

### 🔴 代表性回撤与触及止损标的样本：
{losers_summary}

---

## 🎯 你的复盘与策略自进化任务：

请严格基于上方真实的实盘涨跌数据与各战法胜率看板，对我们的【智能选股策略】进行深度复盘与去留优化，输出一篇详实的复盘研报：

1. **【策略去留与权重调整决议（哪些保留、哪些淘汰）】**:
   - 逐一明确评判上述各个战法：
     - **【保留并加权战法】**：哪些战法（如主线分歧低吸、ETF网格等）胜率高且回撤可控？为什么适合当前大盘？
     - **【淘汰/熔断或降权战法】**：哪些战法（如均线多头回踩频频破位套牢）近期胜率过低？必须给出明确的降权或暂停推荐建议！
     - **【参数优化战法】**：哪些战法虽有冲高（平均冲高>2%）但最终回撤，说明止盈离场节奏存在问题，应如何改进？

2. **【成败个案深度归因】**:
   - 深入归因亏损较大的样本（如破位下跌标的），分析当时入选是否存在“逆大盘退潮追高”、“换手率不足”或“周K线处于空头”等根本漏洞。

3. **【初筛量化漏斗动态优化参数】**:
   - 给出选股过滤条件的具体优化值：短线涨幅区间、成交额下限、周线生命线一票否决门槛等。

4. **【提炼 Agent 记忆库新选股铁律 (进化提炼)】**:
   - 必须以明确的列表格式，提炼出 **3~5 条切实可行的策略进化铁律**（包含选股规则、买点纪律、避雷经验），以便系统自动提取并永久融入 Agent 记忆库，直接指导后续选股！

请开始生成【AI 选股策略实盘胜率复盘与自进化报告】。
"""
        return prompt
