from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from database import get_db
from services.backtest_engine import BacktestEngine
from services.market_data import MarketDataService

router = APIRouter(prefix="/backtest", tags=["Strategy Backtesting"])


class BacktestRunRequest(BaseModel):
    strategy_id: str = Field(default="WEEKLY_MA5_KDJ21", description="策略唯一标识符")
    target_type: str = Field(default="POOL", description="回测目标类型: SINGLE (单股) 或 POOL (股票池)")
    symbol: Optional[str] = Field(default=None, description="当 target_type=SINGLE 时指定的6位股票代码")
    pool_type: Optional[str] = Field(default="WATCHLIST", description="当 target_type=POOL 时指定的股票池: WATCHLIST | POSITIONS | CSI300_CORE | TECH_LEADERS | ETF_CORE")
    days: int = Field(default=500, description="回测历史时间跨度(交易日): 250(1年), 500(2年), 750(3年)")
    start_date: Optional[str] = Field(default=None, description="自定义回测起始日期 (YYYY-MM-DD)")
    end_date: Optional[str] = Field(default=None, description="自定义回测截止日期 (YYYY-MM-DD)")
    initial_capital: float = Field(default=100000.0, description="初始本金 (元)")
    slippage_rate: float = Field(default=0.0010, description="单边滑点率 (默认 0.10%)")
    commission_rate: float = Field(default=0.00025, description="双边佣金率 (默认 万2.5，最低5元)")
    stamp_duty_rate: float = Field(default=0.0005, description="卖出印花税率 (默认 0.05%)")
    custom_params: Optional[Dict[str, Any]] = Field(default=None, description="自定义策略参数")


@router.get("/strategies")
def get_strategies():
    """获取所有支持的历史回测策略列表及默认参数"""
    strategies = []
    for s_id, s_info in BacktestEngine.PRESET_STRATEGIES.items():
        strategies.append({
            "id": s_id,
            "name": s_info["name"],
            "tier": s_info["tier"],
            "description": s_info["description"],
            "default_params": s_info["default_params"]
        })
    return {"status": "success", "strategies": strategies}


@router.get("/pools")
def get_preset_pools():
    """获取所有可用的预设回测标的池"""
    pools = []
    for p_id, p_name in BacktestEngine.PRESET_POOLS.items():
        pools.append({
            "id": p_id,
            "name": p_name
        })
    return {"status": "success", "pools": pools}


@router.post("/run")
def run_strategy_backtest(req: BacktestRunRequest):
    """
    启动严防未来函数、计入真实交易摩擦 (T+1、印花税、佣金、滑点、涨跌停) 的策略回测
    """
    try:
        results = BacktestEngine.run_backtest(
            strategy_id=req.strategy_id,
            symbol=req.symbol if req.target_type == "SINGLE" else None,
            pool_type=req.pool_type if req.target_type == "POOL" else None,
            days=req.days,
            start_date=req.start_date,
            end_date=req.end_date,
            initial_capital=req.initial_capital,
            slippage_rate=req.slippage_rate,
            commission_rate=req.commission_rate,
            stamp_duty_rate=req.stamp_duty_rate,
            custom_params=req.custom_params
        )
        return results
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"回测执行异常: {str(e)}")



class BacktestAIOptimizeRequest(BaseModel):
    strategy_id: str = Field(description="策略唯一ID")
    strategy_name: str = Field(description="策略名称")
    test_days: int = Field(default=500)
    total_return_pct: float = Field(default=0.0)
    cagr: float = Field(default=0.0)
    benchmark_return_pct: float = Field(default=0.0)
    excess_return_pct: float = Field(default=0.0)
    win_rate: float = Field(default=0.0)
    profit_loss_ratio: float = Field(default=0.0)
    profit_factor: float = Field(default=0.0)
    max_drawdown: float = Field(default=0.0)
    sharpe_ratio: float = Field(default=0.0)
    sortino_ratio: float = Field(default=0.0)
    total_trades: int = Field(default=0)
    current_params: Dict[str, Any] = Field(default_factory=dict)
    trades: Optional[List[Dict[str, Any]]] = Field(default=None)


@router.post("/ai-optimize")
async def ai_optimize_backtest(req: BacktestAIOptimizeRequest, db: Session = Depends(get_db)):
    """
    AI 量化架构师：全维归因分析回测表现，诊断胜率/盈亏比/回撤瓶颈，并生成推荐优化参数
    """
    try:
        from services.llm_engine import MultiLLMEngine
        result = await MultiLLMEngine.optimize_backtest_strategy(db, req.dict())
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AI参数调优异常: {str(e)}")
