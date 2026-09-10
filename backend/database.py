import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from config import settings

engine = create_engine(
    settings.DATABASE_URL, 
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def bj_now():
    """Return China Beijing local time (UTC+8)"""
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).replace(tzinfo=None)

class Stock(Base):
    __tablename__ = "stocks"

    symbol = Column(String, primary_key=True, index=True)  # e.g., "600519", "000001"
    name = Column(String, index=True)
    market = Column(String, default="A股")  # e.g., 主板/创业板/科创板
    industry = Column(String, nullable=True)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)

    positions = relationship("Position", back_populates="stock", cascade="all, delete-orphan")
    watchlists = relationship("Watchlist", back_populates="stock", cascade="all, delete-orphan")

class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, ForeignKey("stocks.symbol"), nullable=False)
    cost_price = Column(Float, nullable=False, default=0.0)
    current_volume = Column(Integer, nullable=False, default=0)
    position_ratio = Column(Float, default=0.0)  # 持仓占比 %
    strategy_tag = Column(String, default="长线持有")  # 长线/短线/套牢/高吸低抛
    created_at = Column(DateTime, default=bj_now)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)

    stock = relationship("Stock", back_populates="positions")

class Watchlist(Base):
    __tablename__ = "watchlists"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, ForeignKey("stocks.symbol"), nullable=False)
    category = Column(String, default="观察池")  # 观察池/拟建仓/强支撑
    target_buy_price = Column(Float, nullable=True)
    stop_loss_price = Column(Float, nullable=True)
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime, default=bj_now)

    stock = relationship("Stock", back_populates="watchlists")

class AnalysisReport(Base):
    __tablename__ = "analysis_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_type = Column(String, default="DAILY_PORTFOLIO")  # DAILY_PORTFOLIO / SINGLE_STOCK
    provider_model = Column(String, default="deepseek-chat")
    input_summary = Column(Text, nullable=True)  # 送入 AI 的数据摘要 JSON
    content_md = Column(Text, nullable=False)    # AI 生成的 Markdown 报告
    generated_at = Column(DateTime, default=bj_now)

class LLMConfig(Base):
    __tablename__ = "llm_configs"

    id = Column(Integer, primary_key=True, index=True)
    provider_name = Column(String, unique=True, index=True)  # deepseek, kimi, qwen, custom
    api_key = Column(String, nullable=True)
    base_url = Column(String, nullable=True)
    selected_model = Column(String, default="deepseek-chat")
    is_active = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)

class TradeRecord(Base):
    __tablename__ = "trade_records"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    trade_type = Column(String, nullable=False, default="BUY")  # "BUY" | "SELL"
    price = Column(Float, nullable=False, default=0.0)
    volume = Column(Integer, nullable=False, default=0)
    amount = Column(Float, nullable=False, default=0.0)
    trade_date = Column(DateTime, default=bj_now)
    fee = Column(Float, default=0.0)
    strategy_reason = Column(Text, nullable=True)  # 交易买卖理由/心得总结
    is_planned = Column(Boolean, default=True)      # 是否为计划内交易
    trade_tag = Column(String, default="计划内执行")  # 交易标签 (如: 突破买入/回调建仓/冲动追高/止损出局)
    created_at = Column(DateTime, default=bj_now)

class AgentMemory(Base):
    __tablename__ = "agent_memories"

    id = Column(Integer, primary_key=True, index=True)
    agent_name = Column(String, default="TradeReviewAgent", index=True)
    memory_type = Column(String, default="USER_HABIT")  # USER_HABIT / LESSON_LEARNED / TRADING_STYLE
    content = Column(Text, nullable=False)               # 记忆内容
    importance = Column(Integer, default=3)             # 重要程度 1-5
    source_info = Column(String, nullable=True)          # 产生来源说明 (如 2026-09-02 复盘)
    created_at = Column(DateTime, default=bj_now)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)

class PushConfig(Base):
    __tablename__ = "push_configs"

    id = Column(Integer, primary_key=True, index=True)
    channel = Column(String, default="serverchan", index=True)  # serverchan | pushplus | wechat_work
    secret_key = Column(String, nullable=True)  # SendKey / Token / Webhook URL
    is_enabled = Column(Boolean, default=False)
    auto_push_review = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)

class AccountFund(Base):
    __tablename__ = "account_funds"

    id = Column(Integer, primary_key=True, index=True)
    total_assets = Column(Float, default=195305.74)      # 总资产 (元)
    available_cash = Column(Float, default=67316.68)     # 可用金额 (元)
    cash_balance = Column(Float, default=314.13)         # 资金余额 (元)
    withdrawable_cash = Column(Float, default=314.13)    # 可取金额 (元)
    frozen_amount = Column(Float, default=-67002.55)     # 冻结金额 (元)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)


def init_db():
    Base.metadata.create_all(bind=engine)
    # Ensure missing columns exist for SQLite schema backward compatibility
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE trade_records ADD COLUMN is_planned BOOLEAN DEFAULT 1;"))
            conn.commit()
    except Exception:
        pass
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE trade_records ADD COLUMN trade_tag VARCHAR DEFAULT '计划内执行';"))
            conn.commit()
    except Exception:
        pass
    # account_funds backward compatibility (in case older DB lacks columns)
    _account_funds_migrations = [
        "ALTER TABLE account_funds ADD COLUMN total_assets REAL DEFAULT 0.0;",
        "ALTER TABLE account_funds ADD COLUMN available_cash REAL DEFAULT 0.0;",
        "ALTER TABLE account_funds ADD COLUMN cash_balance REAL DEFAULT 0.0;",
        "ALTER TABLE account_funds ADD COLUMN withdrawable_cash REAL DEFAULT 0.0;",
        "ALTER TABLE account_funds ADD COLUMN frozen_amount REAL DEFAULT 0.0;",
        "ALTER TABLE account_funds ADD COLUMN updated_at DATETIME;",
    ]
    from sqlalchemy import text
    for _sql in _account_funds_migrations:
        try:
            with engine.connect() as conn:
                conn.execute(text(_sql))
                conn.commit()
        except Exception:
            pass


