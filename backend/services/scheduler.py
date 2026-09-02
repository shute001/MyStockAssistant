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
        positions = db.query(Position).all()
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

def start_scheduler():
    """Start APScheduler background runner"""
    if not scheduler.running:
        scheduler.add_job(
            run_daily_portfolio_analysis,
            trigger=CronTrigger(day_of_week="mon-fri", hour=settings.SCHEDULER_CRON_HOUR, minute=settings.SCHEDULER_CRON_MINUTE),
            id="daily_portfolio_analysis",
            replace_existing=True
        )
        scheduler.start()
        logger.info(f"Scheduler started. Daily analysis scheduled for {settings.SCHEDULER_CRON_HOUR}:{settings.SCHEDULER_CRON_MINUTE} Mon-Fri.")
