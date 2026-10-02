import logging
import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from database import SessionLocal, Position, Watchlist, Stock, AnalysisReport
from services.market_data import MarketDataService
from services.llm_engine import MultiLLMEngine
from config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

async def run_daily_portfolio_analysis():
    """Daily post-market auto-analysis task running at 15:15"""
    logger.info("Starting daily automated post-market stock analysis task...")
    db = SessionLocal()
    try:
        positions = db.query(Position).filter(Position.current_volume > 0).all()
        watchlists = db.query(Watchlist).all()

        portfolio_payload = []
        for pos in positions:
            stock = db.query(Stock).filter(Stock.symbol == pos.symbol).first()
            name = stock.name if stock else pos.symbol
            indicators = MarketDataService.get_stock_indicators_summary(pos.symbol, name)
            indicators["cost_price"] = pos.cost_price
            indicators["current_volume"] = pos.current_volume
            portfolio_payload.append(indicators)

        watchlist_payload = []
        for w in watchlists:
            stock = db.query(Stock).filter(Stock.symbol == w.symbol).first()
            name = stock.name if stock else w.symbol
            indicators = MarketDataService.get_stock_indicators_summary(w.symbol, name)
            indicators["category"] = w.category
            indicators["target_buy_price"] = w.target_buy_price
            watchlist_payload.append(indicators)

        if not portfolio_payload and not watchlist_payload:
            logger.info("No positions or watchlist stocks found for auto-analysis.")
            return

        prompt = MultiLLMEngine.build_portfolio_prompt(portfolio_payload, watchlist_payload)

        # Collect complete report content
        report_content = ""
        async for chunk in MultiLLMEngine.generate_analysis_stream(db, prompt):
            report_content += chunk

        # Save to Database
        active_cfg = MultiLLMEngine.get_active_config(db)
        report = AnalysisReport(
            report_type="DAILY_PORTFOLIO",
            provider_model=active_cfg["model"],
            input_summary=str(len(portfolio_payload)) + " positions",
            content_md=report_content,
            generated_at=bj_now()
        )
        db.add(report)
        db.commit()
        logger.info(f"Daily analysis report saved successfully. Report ID: {report.id}")

    except Exception as e:
        logger.error(f"Error in daily portfolio analysis scheduler: {e}")
    finally:
        db.close()

async def run_condition_check():
    """Periodic stop-loss / take-profit condition monitor (only active during trading hours)"""
    from services.market_data import MarketDataService
    if not MarketDataService.is_trading_time():
        return

    from database import PositionCondition
    from services.condition_engine import ConditionEngine
    db = SessionLocal()
    try:
        # Fast preliminary check: only proceed if there are active, untriggered conditions
        active_count = db.query(PositionCondition.id).filter(
            PositionCondition.is_active == True,
            PositionCondition.is_triggered == False
        ).count()
        if active_count > 0:
            await ConditionEngine.evaluate_all_conditions(db)
    except Exception as e:
        logger.error(f"Error in condition monitor scheduler: {e}")
    finally:
        db.close()

def start_scheduler():
    """Start APScheduler background runner"""
    if not scheduler.running:
        from apscheduler.triggers.combining import OrTrigger
        from apscheduler.triggers.cron import CronTrigger

        scheduler.add_job(
            run_daily_portfolio_analysis,
            trigger=CronTrigger(day_of_week="mon-fri", hour=settings.SCHEDULER_CRON_HOUR, minute=settings.SCHEDULER_CRON_MINUTE),
            id="daily_portfolio_analysis",
            replace_existing=True
        )

        # Strictly schedule condition checks during A-share trading windows (Mon-Fri 09:15-11:30, 13:00-15:00)
        # Outside these trading hours and on weekends, the scheduler does NOT trigger at all.
        trading_hours_trigger = OrTrigger([
            CronTrigger(day_of_week="mon-fri", hour="9", minute="15-59", second="0,30"),
            CronTrigger(day_of_week="mon-fri", hour="10", second="0,30"),
            CronTrigger(day_of_week="mon-fri", hour="11", minute="0-30", second="0,30"),
            CronTrigger(day_of_week="mon-fri", hour="13-14", second="0,30"),
            CronTrigger(day_of_week="mon-fri", hour="15", minute="0", second="0"),
        ])
        scheduler.add_job(
            run_condition_check,
            trigger=trading_hours_trigger,
            id="condition_check_monitor",
            replace_existing=True
        )
        scheduler.start()
        logger.info(f"Scheduler started. Daily analysis scheduled for {settings.SCHEDULER_CRON_HOUR}:{settings.SCHEDULER_CRON_MINUTE} Mon-Fri. Condition monitor runs only during A-share trading hours.")


