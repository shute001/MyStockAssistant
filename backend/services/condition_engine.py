import logging
import datetime
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from database import PositionCondition, AlertNotification, Position, Stock, PushConfig, bj_now
from services.market_data import MarketDataService
from services.notifier import send_wechat_notification

logger = logging.getLogger(__name__)

class ConditionEngine:
    """Quantitative Condition & Risk-Control Engine for Held Stocks"""

    @classmethod
    async def evaluate_all_conditions(cls, db: Session) -> List[AlertNotification]:
        """
        Scan all active and untriggered conditions, evaluate against real-time quotes and indicators,
        create AlertNotification records, and fire WeChat pushes if configured.
        """
        active_conditions = (
            db.query(PositionCondition)
            .filter(
                PositionCondition.is_active == True,
                PositionCondition.is_triggered == False
            )
            .all()
        )

        if not active_conditions:
            return []

        # Collect unique symbols
        symbols = list({c.symbol for c in active_conditions})
        batch_quotes = MarketDataService.get_batch_realtime_quotes(symbols)

        # Pre-load positions for cost price and volume
        positions_map = {
            p.symbol: p for p in db.query(Position).filter(Position.symbol.in_(symbols)).all()
        }

        triggered_alerts: List[AlertNotification] = []
        push_cfg = db.query(PushConfig).first()

        for cond in active_conditions:
            quote = batch_quotes.get(cond.symbol, {})
            current_price = quote.get("current_price", 0.0)
            if not current_price or current_price <= 0:
                continue

            pos = positions_map.get(cond.symbol)
            cost_price = pos.cost_price if pos else (cond.target_value or current_price)
            profit_ratio = (
                round(((current_price - cost_price) / cost_price) * 100, 2)
                if cost_price and cost_price > 0
                else 0.0
            )

            # Update highest price seen for trailing stop calculation
            if cond.highest_price is None or current_price > cond.highest_price:
                cond.highest_price = current_price

            # Fetch technical indicators if needed for MA or MACD
            indicators: Dict[str, Any] = {}
            if cond.condition_type in (
                "MA_CROSS_BELOW", "MA_CROSS_ABOVE", "MACD_DEATH_CROSS", "MACD_GOLDEN_CROSS"
            ):
                indicators = MarketDataService.get_stock_indicators_summary(cond.symbol, cond.name, db=db)

            # Evaluate condition
            is_hit = False
            reason = ""
            alert_type = "RISK_ALERT"
            title = ""

            c_type = cond.condition_type.upper()

            # 1. Target Profit (止盈)
            if c_type in ("TARGET_PROFIT", "TARGET_PRICE"):
                target_val = cond.target_value or 0.0
                if target_val > 0 and current_price >= target_val:
                    is_hit = True
                    alert_type = "TAKE_PROFIT"
                    title = f"🎯 [止盈预警] {cond.name} ({cond.symbol}) 达到目标止盈价！"
                    reason = f"现价 ¥{current_price:.2f} 已突破或达到预设止盈价 ¥{target_val:.2f} (当前收益率: +{profit_ratio:.2f}%)"

            # 2. Stop Loss (止损)
            elif c_type in ("STOP_LOSS", "STOP_LOSS_PRICE"):
                target_val = cond.target_value or 0.0
                if target_val > 0 and current_price <= target_val:
                    is_hit = True
                    alert_type = "STOP_LOSS"
                    title = f"🛑 [止损预警] {cond.name} ({cond.symbol}) 触及止损价！"
                    reason = f"现价 ¥{current_price:.2f} 已跌破预设立案止损线 ¥{target_val:.2f} (当前盈亏率: {profit_ratio:+.2f}%)"

            # 3. MA Breakdown (跌破均线止损)
            elif c_type == "MA_CROSS_BELOW":
                period = cond.ma_period or 20
                ma_key = f"ma{period}"
                ma_val = indicators.get(ma_key)
                if ma_val and ma_val > 0 and current_price < ma_val:
                    is_hit = True
                    alert_type = "MA"
                    title = f"📉 [均线破位预警] {cond.name} ({cond.symbol}) 跌破 {period}日均线！"
                    reason = f"现价 ¥{current_price:.2f} 有效跌破 {period}日生命线 (MA{period}: ¥{ma_val:.2f})"

            # 4. MA Breakout (突破均线止盈/加仓)
            elif c_type == "MA_CROSS_ABOVE":
                period = cond.ma_period or 20
                ma_key = f"ma{period}"
                ma_val = indicators.get(ma_key)
                if ma_val and ma_val > 0 and current_price > ma_val:
                    is_hit = True
                    alert_type = "MA"
                    title = f"🚀 [均线突破预警] {cond.name} ({cond.symbol}) 放量突破 {period}日均线！"
                    reason = f"现价 ¥{current_price:.2f} 站上 {period}日均线阻力位 (MA{period}: ¥{ma_val:.2f})"

            # 5. MACD Death Cross (MACD 死叉风控)
            elif c_type == "MACD_DEATH_CROSS":
                dif = indicators.get("macd_dif")
                dea = indicators.get("macd_dea")
                macd_status = indicators.get("macd_status", "")
                if (dif is not None and dea is not None and dif < dea) or "死叉" in macd_status:
                    is_hit = True
                    alert_type = "MACD"
                    title = f"⚠️ [MACD死叉预警] {cond.name} ({cond.symbol}) 出现日线死叉信号！"
                    reason = f"日线 MACD 形成高位死叉信号 (DIF: {dif} < DEA: {dea})，动能转弱建议止盈或防守离场"

            # 6. MACD Golden Cross (MACD 金叉提醒)
            elif c_type == "MACD_GOLDEN_CROSS":
                dif = indicators.get("macd_dif")
                dea = indicators.get("macd_dea")
                macd_status = indicators.get("macd_status", "")
                if (dif is not None and dea is not None and dif > dea) or "金叉" in macd_status:
                    is_hit = True
                    alert_type = "MACD"
                    title = f"✨ [MACD金叉预警] {cond.name} ({cond.symbol}) 形成日线金叉买点！"
                    reason = f"日线 MACD 底部金叉确立 (DIF: {dif} > DEA: {dea})，反弹动能显现"

            # 7. Trailing Stop (移动回撤止盈)
            elif c_type == "TRAILING_STOP":
                trail_pct = cond.trail_percent or 5.0
                max_price = cond.highest_price or current_price
                if max_price > 0:
                    drawdown = ((max_price - current_price) / max_price) * 100
                    if drawdown >= trail_pct:
                        is_hit = True
                        alert_type = "TRAILING"
                        title = f"📉 [移动止盈预警] {cond.name} ({cond.symbol}) 高位回撤超标！"
                        reason = f"从监控期间最高价 ¥{max_price:.2f} 回撤已达 {drawdown:.2f}% (设定阈值: {trail_pct:.1f}%)，触发浮动止盈保护利润"

            if is_hit:
                cond.is_triggered = True
                cond.triggered_at = bj_now()
                cond.trigger_reason = reason

                alert = AlertNotification(
                    condition_id=cond.id,
                    symbol=cond.symbol,
                    name=cond.name,
                    alert_type=alert_type,
                    title=title,
                    message=reason,
                    trigger_price=current_price,
                    cost_price=cost_price,
                    profit_ratio=profit_ratio,
                    is_read=False,
                    wechat_status="PENDING",
                    created_at=bj_now(),
                )
                db.add(alert)
                db.flush()
                triggered_alerts.append(alert)

                # Fire WeChat Notification if configured and condition.notify_wechat is True
                if cond.notify_wechat and push_cfg and push_cfg.is_enabled and push_cfg.secret_key:
                    try:
                        wechat_md = f"""### {title}
- **股票标的**：{cond.name} (`{cond.symbol}`)
- **当前市价**：`¥{current_price:.2f}` (盈亏率: `{profit_ratio:+.2f}%`)
- **成本均价**：`¥{cost_price:.2f}`
- **触发规则**：{cond.condition_label or cond.condition_type}
- **触发详情**：{reason}
- **策略备忘**：{cond.strategy_note or '系统自动化智能风控纪律监控'}
- **预警时间**：{bj_now().strftime('%Y-%m-%d %H:%M:%S')}

> 💡 **AI 操盘提示**：行情波动迅速，建议及时打开券商交易终端执行纪律操盘！"""
                        res = await send_wechat_notification(
                            title=title,
                            content_md=wechat_md,
                            channel=push_cfg.channel,
                            secret_key=push_cfg.secret_key,
                        )
                        if res.get("status") == "success":
                            alert.wechat_status = "SENT"
                        else:
                            alert.wechat_status = f"FAILED: {res.get('detail')}"
                    except Exception as e:
                        logger.error(f"Failed to push WeChat alert for {cond.symbol}: {e}")
                        alert.wechat_status = f"ERROR: {str(e)}"
                else:
                    alert.wechat_status = "SKIPPED_OR_DISABLED"

        if triggered_alerts:
            db.commit()
            logger.info(f"ConditionEngine evaluated: {len(triggered_alerts)} conditions triggered!")

        return triggered_alerts

    @classmethod
    def suggest_conditions_for_stock(
        cls, symbol: str, cost_price: Optional[float] = None, db: Optional[Session] = None
    ) -> Dict[str, Any]:
        """
        Smart Quant & Technical AI Condition Suggestion for any held stock.
        Calculates optimal Stop-Loss, Take-Profit, MA, and MACD conditions based on
        real-time Support/Resistance, MA20, and ATR volatility.
        """
        symbol = MarketDataService.format_symbol(symbol)
        name = MarketDataService.get_stock_name(symbol)
        indicators = MarketDataService.get_stock_indicators_summary(symbol, name, db=db)

        current_price = indicators.get("current_price", 0.0)
        support_price = indicators.get("support_price", 0.0)
        resistance_price = indicators.get("resistance_price", 0.0)
        ma5 = indicators.get("ma5", 0.0)
        ma10 = indicators.get("ma10", 0.0)
        ma20 = indicators.get("ma20", 0.0)
        ma60 = indicators.get("ma60", 0.0)

        # Baseline cost reference
        ref_cost = cost_price if (cost_price and cost_price > 0) else current_price

        # 1. Smart Stop-Loss Price
        # If support price is below current price, set stop loss slightly below support (e.g. support * 0.985)
        if support_price > 0 and support_price < current_price:
            suggested_stop_loss = round(support_price * 0.985, 2)
            stop_loss_note = f"跌破近期强支撑位 ¥{support_price:.2f} 确认破位止损"
        elif ref_cost > 0:
            suggested_stop_loss = round(min(current_price * 0.95, ref_cost * 0.95), 2)
            stop_loss_note = f"以现价/成本价下浮 5% 作为硬止损防守线"
        else:
            suggested_stop_loss = round(current_price * 0.95, 2)
            stop_loss_note = f"以现价下浮 5% 作为硬止损"

        # 2. Smart Take-Profit Price
        # If resistance is above current price, target near resistance
        if resistance_price > 0 and resistance_price > current_price:
            suggested_target_profit = round(resistance_price * 0.995, 2)
            target_profit_note = f"触及上方阻力密集区 ¥{resistance_price:.2f} 止盈锁定胜果"
        elif ref_cost > 0:
            suggested_target_profit = round(max(current_price * 1.08, ref_cost * 1.10), 2)
            target_profit_note = f"目标达成 +8%~+10% 收益分批止盈"
        else:
            suggested_target_profit = round(current_price * 1.08, 2)
            target_profit_note = f"目标达成 +8% 收益分批止盈"

        conditions = [
            {
                "symbol": symbol,
                "name": name,
                "condition_type": "STOP_LOSS",
                "condition_label": f"🛑 关键支撑止损 (¥{suggested_stop_loss:.2f})",
                "target_value": suggested_stop_loss,
                "strategy_note": stop_loss_note,
                "notify_wechat": True,
                "notify_popup": True,
            },
            {
                "symbol": symbol,
                "name": name,
                "condition_type": "MA_CROSS_BELOW",
                "condition_label": f"📉 跌破20日生命线止损 (MA20: ¥{ma20:.2f})",
                "ma_period": 20,
                "target_value": ma20,
                "strategy_note": "20日均线为波段中线多空生命线，有效击穿预示趋势走坏",
                "notify_wechat": True,
                "notify_popup": True,
            },
            {
                "symbol": symbol,
                "name": name,
                "condition_type": "TARGET_PROFIT",
                "condition_label": f"🎯 阻力位第一止盈目标 (¥{suggested_target_profit:.2f})",
                "target_value": suggested_target_profit,
                "strategy_note": target_profit_note,
                "notify_wechat": True,
                "notify_popup": True,
            },
            {
                "symbol": symbol,
                "name": name,
                "condition_type": "TRAILING_STOP",
                "condition_label": "🛡️ 移动止盈 (自最高价回撤 5%)",
                "trail_percent": 5.0,
                "strategy_note": "锁定已有浮盈，当股价自冲高最高点回落超过 5% 时保护性止盈",
                "notify_wechat": True,
                "notify_popup": True,
            },
            {
                "symbol": symbol,
                "name": name,
                "condition_type": "MACD_DEATH_CROSS",
                "condition_label": "⚡ MACD 日线高位死叉离场",
                "strategy_note": "日线 MACD DIF 下穿 DEA 动能衰竭，提示波段见顶风险",
                "notify_wechat": True,
                "notify_popup": True,
            },
        ]

        return {
            "symbol": symbol,
            "name": name,
            "current_price": current_price,
            "cost_price": ref_cost,
            "support_price": support_price,
            "resistance_price": resistance_price,
            "ma20": ma20,
            "suggested_conditions": conditions,
        }
