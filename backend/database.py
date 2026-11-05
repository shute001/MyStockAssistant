import datetime
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Boolean, ForeignKey, UniqueConstraint
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
    category = Column(String, default="SHORT_TERM")     # SHORT_TERM (股票短线) | MID_TERM (股票中线) | LONG_TERM (股票长线) | ETF_FUND (ETF/基金) | GENERAL (通用风控)
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

class StockKline(Base):
    __tablename__ = "stock_klines"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)      # e.g., "600519"
    date = Column(String, nullable=False, index=True)        # e.g., "2026-09-16"
    open = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    volume = Column(Integer, default=0)                      # 成交量
    amount = Column(Float, default=0.0)                      # 成交额
    pct_chg = Column(Float, default=0.0)                     # 涨跌幅 %
    turnover = Column(Float, default=0.0)                    # 换手率 %
    # 均线系统 (短中长)
    ma5 = Column(Float, nullable=True)
    ma10 = Column(Float, nullable=True)
    ma20 = Column(Float, nullable=True)
    ma60 = Column(Float, nullable=True)
    ma120 = Column(Float, nullable=True)                     # 半年线
    ma250 = Column(Float, nullable=True)                     # 年线 (牛熊线)
    # 动量与摆动指标
    macd_dif = Column(Float, nullable=True)
    macd_dea = Column(Float, nullable=True)
    macd_hist = Column(Float, nullable=True)
    kdj_k = Column(Float, nullable=True)
    kdj_d = Column(Float, nullable=True)
    kdj_j = Column(Float, nullable=True)
    rsi6 = Column(Float, nullable=True)
    rsi12 = Column(Float, nullable=True)
    rsi24 = Column(Float, nullable=True)
    boll_up = Column(Float, nullable=True)
    boll_mid = Column(Float, nullable=True)
    boll_down = Column(Float, nullable=True)
    vol_ratio = Column(Float, nullable=True)                 # 量比 (Vol / Vol_MA5)
    created_at = Column(DateTime, default=bj_now)

    __table_args__ = (
        UniqueConstraint('symbol', 'date', name='uq_stock_kline_symbol_date'),
    )


class PositionCondition(Base):
    __tablename__ = "position_conditions"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    condition_type = Column(String, nullable=False)  # TARGET_PROFIT, STOP_LOSS, MA_CROSS_BELOW, MA_CROSS_ABOVE, MACD_DEATH_CROSS, MACD_GOLDEN_CROSS, TRAILING_STOP
    condition_label = Column(String, nullable=True)  # e.g., "跌破20日均线止损"
    target_value = Column(Float, nullable=True)       # 目标价格或目标百分比
    ma_period = Column(Integer, nullable=True)        # 5, 10, 20, 60, 120, 250
    trail_percent = Column(Float, nullable=True)      # 移动回撤百分比
    highest_price = Column(Float, nullable=True)      # 监控期间最高价
    notify_wechat = Column(Boolean, default=True)
    notify_popup = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    is_triggered = Column(Boolean, default=False)
    triggered_at = Column(DateTime, nullable=True)
    trigger_reason = Column(Text, nullable=True)
    strategy_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=bj_now)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)


class AlertNotification(Base):
    __tablename__ = "alert_notifications"

    id = Column(Integer, primary_key=True, index=True)
    condition_id = Column(Integer, nullable=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    alert_type = Column(String, nullable=False)      # STOP_LOSS, TAKE_PROFIT, MA, MACD, TRAILING
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    trigger_price = Column(Float, nullable=True)
    cost_price = Column(Float, nullable=True)
    profit_ratio = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False, index=True)
    wechat_status = Column(String, default="PENDING") # SENT, FAILED, DISABLED
    created_at = Column(DateTime, default=bj_now)


class ScreenerRecommendationRecord(Base):
    __tablename__ = "screener_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, nullable=True, index=True)
    symbol = Column(String(10), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    scope = Column(String(30), default="ALL")  # ALL, SHORT_TERM, MID_TERM, LONG_TERM_ETF
    tier_category = Column(String(50), nullable=False)  # ⚡ 短线交易 / 📈 中线波段 / 🛡️ 长线价值/ETF
    recommend_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    recommend_price = Column(Float, nullable=False)  # 推荐时的基准市价
    suggested_buy_range = Column(String(50), nullable=True)  # 建议买入区间
    stop_loss_price = Column(Float, nullable=True)  # 建议硬止损位
    target_price = Column(Float, nullable=True)  # 建议止盈目标位
    target_profit_pct = Column(Float, nullable=True)  # 预期目标涨幅%
    core_thesis = Column(Text, nullable=True)  # 核心推选逻辑/战法
    indicators_snapshot = Column(Text, nullable=True)  # 推选时刻的技术指标 JSON 快照
    status = Column(String(20), default="TRACKING", index=True)  # TRACKING, HIT_TARGET, HIT_STOP_LOSS, CLOSED
    latest_price = Column(Float, nullable=True)  # 最新市价
    current_profit_pct = Column(Float, default=0.0)  # 当前累计收益率%
    max_profit_pct = Column(Float, default=0.0)  # 推荐后最高触及涨幅%
    max_loss_pct = Column(Float, default=0.0)  # 推荐后最大回撤跌幅%
    last_evaluated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=bj_now)
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)


class ScreenerStrategyConfig(Base):
    __tablename__ = "screener_strategy_configs"

    id = Column(Integer, primary_key=True, index=True)
    config_key = Column(String(50), unique=True, default="CURRENT_FUNNEL_CONFIG")
    min_amount_wan = Column(Float, default=2000.0)  # 最低成交额(万元)
    min_etf_amount_wan = Column(Float, default=1000.0)  # ETF最低成交额(万元)
    short_momentum_low = Column(Float, default=2.0)  # 短线动量下限%
    short_momentum_high = Column(Float, default=6.5)  # 短线动量上限%
    require_weekly_ma20 = Column(Boolean, default=True)  # 是否要求站稳周线MA20生命线
    default_stop_loss_pct = Column(Float, default=-4.5)  # 默认硬止损位%
    default_take_profit_pct = Column(Float, default=12.0)  # 默认目标止盈位%
    evolution_version = Column(Integer, default=1)  # 进化代数
    last_evolution_summary = Column(Text, nullable=True)  # 最后一次进化理由
    updated_at = Column(DateTime, default=bj_now, onupdate=bj_now)


class StrategyWeightRecord(Base):
    __tablename__ = "strategy_weights"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(String(50), unique=True, index=True)  # e.g. SHORT_DIVERGENCE
    strategy_name = Column(String(100), nullable=False)
    tier = Column(String(30), default="SHORT_TERM")  # SHORT_TERM / MID_TERM / LONG_TERM_ETF
    weight = Column(Integer, default=50)  # 动态权重 0~100
    win_rate = Column(Float, default=50.0)  # 实盘追踪胜率%
    total_samples = Column(Integer, default=0)  # 追踪样本数
    avg_profit_pct = Column(Float, default=0.0)  # 平均收益率%
    is_active = Column(Boolean, default=True)  # True 正常推荐 / False 触发熔断
    fuse_reason = Column(String(255), default="正常运行")
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

    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE agent_memories ADD COLUMN category VARCHAR DEFAULT 'SHORT_TERM';"))
            conn.commit()
    except Exception:
        pass

    # Screener strategy config & dynamic weights initialization
    try:
        from sqlalchemy.orm import Session
        db = SessionLocal()
        try:
            if db.query(ScreenerStrategyConfig).count() == 0:
                default_cfg = ScreenerStrategyConfig(
                    config_key="CURRENT_FUNNEL_CONFIG",
                    min_amount_wan=2000.0,
                    min_etf_amount_wan=1000.0,
                    short_momentum_low=2.0,
                    short_momentum_high=6.5,
                    require_weekly_ma20=True,
                    default_stop_loss_pct=-4.5,
                    default_take_profit_pct=12.0,
                    evolution_version=1,
                    last_evolution_summary="系统初始基准量化漏斗参数",
                    updated_at=bj_now()
                )
                db.add(default_cfg)
                db.commit()

            if db.query(StrategyWeightRecord).count() == 0:
                default_weights = [
                    StrategyWeightRecord(strategy_id="SHORT_DIVERGENCE", strategy_name="主线分歧低吸战法", tier="SHORT_TERM", weight=65, win_rate=55.0, total_samples=0, is_active=True, fuse_reason="基准稳健"),
                    StrategyWeightRecord(strategy_id="BREAKTHROUGH_VCP", strategy_name="突破回踩VCP战法", tier="SHORT_TERM", weight=60, win_rate=50.0, total_samples=0, is_active=True, fuse_reason="基准稳健"),
                    StrategyWeightRecord(strategy_id="MID_MA20_TREND", strategy_name="中线MA20生命线趋势", tier="MID_TERM", weight=70, win_rate=60.0, total_samples=0, is_active=True, fuse_reason="主推核心趋势"),
                    StrategyWeightRecord(strategy_id="WEEKLY_MA5_KDJ", strategy_name="周线MA5+KDJ低位金叉", tier="MID_TERM", weight=65, win_rate=55.0, total_samples=0, is_active=True, fuse_reason="基准稳健"),
                    StrategyWeightRecord(strategy_id="ETF_GRID", strategy_name="宽基/红利ETF底仓网格", tier="LONG_TERM_ETF", weight=80, win_rate=70.0, total_samples=0, is_active=True, fuse_reason="高胜率防守底仓"),
                    StrategyWeightRecord(strategy_id="DIVIDEND_VALUE", strategy_name="高股息红利价值重估", tier="LONG_TERM_ETF", weight=75, win_rate=65.0, total_samples=0, is_active=True, fuse_reason="防御性价值底仓")
                ]
                db.add_all(default_weights)
                db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"Warning initializing strategy config/weights: {e}")

