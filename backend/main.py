import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, SessionLocal, Stock, Position, Watchlist, LLMConfig, TradeRecord, AgentMemory, bj_now
from config import settings
from routers import stocks, importer, ai, config, trades, account
from services.scheduler import start_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Enable CORS for frontend development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(stocks.router, prefix=settings.API_V1_STR)
app.include_router(importer.router, prefix=settings.API_V1_STR)
app.include_router(ai.router, prefix=settings.API_V1_STR)
app.include_router(config.router, prefix=settings.API_V1_STR)
app.include_router(trades.router, prefix=settings.API_V1_STR)
app.include_router(account.router, prefix=settings.API_V1_STR)

def seed_demo_data():
    """Seed initial sample stocks, trade records, and LLM provider for zero-config quickstart"""
    db = SessionLocal()
    try:
        if db.query(Position).count() == 0:
            logger.info("Seeding demo stock positions...")
            stock1 = Stock(symbol="600519", name="贵州茅台", market="主板", industry="白酒")
            stock2 = Stock(symbol="000001", name="平安银行", market="主板", industry="银行")
            stock3 = Stock(symbol="300750", name="宁德时代", market="创业板", industry="电池")
            db.add_all([stock1, stock2, stock3])
            db.commit()

            pos1 = Position(symbol="600519", cost_price=1650.0, current_volume=100, strategy_tag="长线持有")
            pos2 = Position(symbol="000001", cost_price=11.2, current_volume=1000, strategy_tag="短线高吸")
            db.add_all([pos1, pos2])

            w1 = Watchlist(symbol="300750", category="拟建仓", target_buy_price=180.0, stop_loss_price=165.0, remark="关注20日线支撑")
            db.add(w1)
            db.commit()

        if db.query(TradeRecord).count() == 0:
            logger.info("Seeding demo trade records...")
            t1 = TradeRecord(
                symbol="600519", name="贵州茅台", trade_type="BUY",
                price=1650.0, volume=100, amount=165000.0,
                strategy_reason="放量突破20日均线低吸建仓", created_at=bj_now()
            )
            t2 = TradeRecord(
                symbol="000001", name="平安银行", trade_type="BUY",
                price=11.2, volume=1000, amount=11200.0,
                strategy_reason="底部企稳分批建仓", created_at=bj_now()
            )
            t3 = TradeRecord(
                symbol="300750", name="宁德时代", trade_type="SELL",
                price=190.5, volume=200, amount=38100.0,
                strategy_reason="触及阻力位分批止盈离场", created_at=bj_now()
            )
            db.add_all([t1, t2, t3])
            db.commit()

        if db.query(AgentMemory).count() == 0:
            logger.info("Seeding initial Agent memory bank...")
            m1 = AgentMemory(
                agent_name="TradeReviewAgent",
                memory_type="USER_HABIT",
                content="偏好白酒与新能源板块，操作风格兼顾长线与中线轮动",
                importance=4, source_info="系统初次初始化"
            )
            m2 = AgentMemory(
                agent_name="TradeReviewAgent",
                memory_type="LESSON_LEARNED",
                content="需注意买入时避免在午盘急拉时追高，严格遵守按突破后回踩确认再加仓的纪律",
                importance=5, source_info="历史交易反思萃取"
            )
            db.add_all([m1, m2])
            db.commit()


        if db.query(LLMConfig).count() == 0:
            logger.info("Seeding default LLM provider configs...")
            ds_cfg = LLMConfig(provider_name="deepseek", selected_model="deepseek-chat", is_active=True)
            kimi_cfg = LLMConfig(provider_name="kimi", selected_model="moonshot-v1-8k", is_active=False)
            qwen_cfg = LLMConfig(provider_name="qwen", selected_model="qwen-max", is_active=False)
            db.add_all([ds_cfg, kimi_cfg, qwen_cfg])
            db.commit()
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    logger.info("Initializing database...")
    init_db()
    seed_demo_data()
    start_scheduler()
    logger.info(f"{settings.PROJECT_NAME} backend started successfully!")

@app.get("/")
def root_endpoint():
    return {
        "status": "online",
        "app": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
