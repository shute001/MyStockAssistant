import React, { useEffect, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  DollarSign, TrendingUp, TrendingDown, PieChart, ShieldAlert, Cpu, 
  Award, Globe, Flame, Newspaper, RefreshCw, AlertTriangle, ArrowUpRight, 
  ArrowDownRight, Target, Compass, Sparkles, ExternalLink
} from 'lucide-react';
import { PositionItem, WatchlistItem } from '../types';
import axios from 'axios';

interface DashboardProps {
  positions: PositionItem[];
  watchlists: WatchlistItem[];
  onTriggerAI: () => void;
  onSelectStock: (symbol: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  positions,
  watchlists,
  onTriggerAI,
  onSelectStock
}) => {
  const [macroData, setMacroData] = useState<{
    indices: { name: string; symbol: string; price: number; pct_chg: string; pct_num: number }[];
    hot_sectors: { name: string; pct_chg: string; pct_num: number }[];
    latest_news: string[];
    meta?: { updated_at: string; status: 'live' | 'partial_fallback'; fallback_sections: string[] };
  } | null>(null);
  const [macroError, setMacroError] = useState(false);

  useEffect(() => {
    fetchMacro();
  }, []);

  const fetchMacro = async () => {
    try {
      const res = await axios.get('/api/v1/stocks/market-macro');
      setMacroData(res.data);
      setMacroError(false);
    } catch (err) {
      console.error('Failed to fetch market macro data:', err);
      setMacroError(true);
    }
  };

  // Financial calculations
  const totalCost = useMemo(() => positions.reduce((acc, item) => acc + item.total_cost, 0), [positions]);
  const totalValue = useMemo(() => positions.reduce((acc, item) => acc + item.current_value, 0), [positions]);
  const totalProfit = totalValue - totalCost;
  const totalProfitRatio = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const winnerPositions = useMemo(() => positions.filter((p) => p.profit_loss > 0), [positions]);
  const loserPositions = useMemo(() => positions.filter((p) => p.profit_loss < 0), [positions]);

  // Daily profit calculations
  const totalTodayProfit = useMemo(() => {
    return positions.reduce((acc, item) => {
      if (item.today_profit_loss !== undefined) return acc + item.today_profit_loss;
      // Fallback: estimate from pct_chg
      const pct = parseFloat((item.pct_chg || '0').replace('%', '').replace('+', '')) || 0;
      return acc + (item.current_value * (pct / 100));
    }, 0);
  }, [positions]);

  const totalTodayProfitPct = totalValue > 0 ? (totalTodayProfit / totalValue) * 100 : 0;

  // Sorted positions by today's performance
  const topMovers = useMemo(() => {
    const list = [...positions].filter(p => p.current_volume > 0);
    list.sort((a, b) => {
      const pctA = parseFloat((a.pct_chg || '0').replace('%', '').replace('+', '')) || 0;
      const pctB = parseFloat((b.pct_chg || '0').replace('%', '').replace('+', '')) || 0;
      return pctB - pctA;
    });
    return list;
  }, [positions]);

  // Strategy distribution
  const strategyStats = useMemo(() => {
    const map: Record<string, number> = {};
    positions.forEach((p) => {
      const tag = p.strategy_tag || '长线持有';
      map[tag] = (map[tag] || 0) + p.current_value;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [positions]);

  // Watchlist stocks near target buy price
  const actionableWatchlist = useMemo(() => {
    return watchlists
      .filter((w) => w.target_buy_price && w.current_price)
      .map((w) => {
        const diff = ((w.current_price! - w.target_buy_price!) / w.target_buy_price!) * 100;
        return { ...w, distancePct: diff };
      })
      .sort((a, b) => a.distancePct - b.distancePct)
      .slice(0, 6);
  }, [watchlists]);

  // ECharts Pie 1: Stock Market Value Allocation
  const stockPieOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#0F172A',
      borderColor: '#334155',
      textStyle: { color: '#F8FAFC', fontSize: 12 },
      formatter: '{b}: ¥{c} ({d}%)'
    },
    color: ['#6366F1', '#8B5CF6', '#EC4899', '#38BDF8', '#10B981', '#F59E0B', '#F43F5E', '#A855F7'],
    series: [
      {
        name: '持仓市值占比',
        type: 'pie',
        radius: ['45%', '72%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#0F172A',
          borderWidth: 2
        },
        label: {
          show: true,
          color: '#94A3B8',
          fontSize: 11,
          formatter: '{b}\n{d}%'
        },
        data: positions.map((p) => ({
          name: p.name,
          value: Math.round(p.current_value)
        }))
      }
    ]
  };

  // ECharts Pie 2: Strategy Tag Allocation
  const strategyPieOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#0F172A',
      borderColor: '#334155',
      textStyle: { color: '#F8FAFC', fontSize: 12 },
      formatter: '{b}: ¥{c} ({d}%)'
    },
    color: ['#38BDF8', '#818CF8', '#34D399', '#FBBF24', '#F87171'],
    series: [
      {
        name: '投资策略分布',
        type: 'pie',
        radius: ['45%', '72%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#0F172A',
          borderWidth: 2
        },
        label: {
          show: true,
          color: '#94A3B8',
          fontSize: 11,
          formatter: '{b}\n{d}%'
        },
        data: strategyStats
      }
    ]
  };

  return (
    <div className="space-y-6">
      {/* 1. Market Macro & News Bar */}
      <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-indigo-950/80 border border-indigo-700/50 rounded-lg text-indigo-400">
              <Globe className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-100">大盘全景、资金风向与热点消息面</h2>
            <span className={`px-2 py-0.5 text-[10px] border rounded-full font-mono ${
              macroData?.meta?.status === 'partial_fallback' 
                ? 'bg-amber-950/60 text-amber-300 border-amber-800/60' 
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
            }`}>
              {macroData?.meta?.status === 'partial_fallback' ? '部分演示数据' : '实时行情'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {macroData?.meta?.updated_at && <span>更新于 {macroData.meta.updated_at}</span>}
            <button onClick={fetchMacro} className="p-1 text-slate-400 hover:text-indigo-300 rounded" title="刷新市场数据">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {macroData?.meta?.status === 'partial_fallback' && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-800/50 bg-amber-950/35 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>“{macroData.meta.fallback_sections.join('、')}”暂不可用，已显示演示内容；请勿将该部分作为交易依据。</span>
          </div>
        )}

        {macroError && (
          <div className="flex items-center justify-between rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
            <span>市场数据加载失败，请检查网络连接。</span>
            <button onClick={fetchMacro} className="font-semibold text-red-100 hover:text-white">重试</button>
          </div>
        )}

        {/* Indices Tickers */}
        {macroData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {macroData.indices.map((idx) => {
              const isUp = idx.pct_num >= 0;
              return (
                <div key={idx.name} className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 flex flex-col justify-between hover:border-slate-700 transition-colors">
                  <span className="text-[11px] font-semibold text-slate-400">{idx.name}</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-sm sm:text-base font-bold font-mono text-slate-100">{idx.price.toFixed(2)}</span>
                    <span className={`text-xs font-mono font-bold flex items-center ${isUp ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {isUp ? '+' : ''}{idx.pct_chg}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hot Sectors & Headlines Dual Panel */}
        {macroData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5 pt-1">
            {/* Hot Sectors */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-2">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                主力领涨 / 热门板块 Top 6
              </span>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {macroData.hot_sectors.map((s) => (
                  <span
                    key={s.name}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-200 flex items-center space-x-1"
                  >
                    <span>{s.name}</span>
                    <span className="text-rose-400 font-mono text-[11px]">{s.pct_chg}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Latest News Headlines */}
            <div className="lg:col-span-2 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 space-y-2">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Newspaper className="w-3.5 h-3.5 text-indigo-400" />
                最新市场要闻与快讯流动
              </span>
              <div className="space-y-1 max-h-[85px] overflow-y-auto pr-1">
                {macroData.latest_news.map((news, i) => (
                  <div key={i} className="text-xs text-slate-300 truncate flex items-center space-x-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    <span className="truncate">{news}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Top Portfolio Metrics 4-Grid Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Value */}
        <div className="surface-card rounded-2xl p-4 sm:p-5 relative overflow-hidden group hover:border-indigo-500/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">持仓总市值</span>
            <div className="p-2 bg-indigo-950/70 border border-indigo-700/40 rounded-xl text-indigo-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-slate-100">
              ¥{totalValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
              <span>持仓成本: ¥{totalCost.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Cumulative Profit/Loss */}
        <div className="surface-card rounded-2xl p-4 sm:p-5 relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">累计总盈亏</span>
            <div className={`p-2 rounded-xl border ${totalProfit >= 0 ? 'bg-rose-950/70 border-rose-700/40 text-rose-400' : 'bg-emerald-950/70 border-emerald-700/40 text-emerald-400'}`}>
              {totalProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-2xl font-bold font-mono ${totalProfit >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {totalProfit >= 0 ? '+' : ''}¥{totalProfit.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs mt-1 flex items-center justify-between">
              <span className="text-slate-400">收益率:</span>
              <span className={`font-mono font-bold ${totalProfitRatio >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {totalProfitRatio >= 0 ? '+' : ''}{totalProfitRatio.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Today's Estimated PnL */}
        <div className="surface-card rounded-2xl p-4 sm:p-5 relative overflow-hidden group hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">当日持仓盈亏</span>
            <div className={`p-2 rounded-xl border ${totalTodayProfit >= 0 ? 'bg-rose-950/70 border-rose-700/40 text-rose-400' : 'bg-emerald-950/70 border-emerald-700/40 text-emerald-400'}`}>
              {totalTodayProfit >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-2xl font-bold font-mono ${totalTodayProfit >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {totalTodayProfit >= 0 ? '+' : ''}¥{totalTodayProfit.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs mt-1 flex items-center justify-between">
              <span className="text-slate-400">今日涨跌幅:</span>
              <span className={`font-mono font-bold ${totalTodayProfitPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {totalTodayProfitPct >= 0 ? '+' : ''}{totalTodayProfitPct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Quick AI Trigger & Concentration */}
        <div className="surface-card bg-gradient-to-br from-indigo-950/50 via-slate-900 to-purple-950/40 border border-indigo-700/40 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                持仓集中度
              </span>
              <span className="text-xs font-mono font-bold text-slate-200">{positions.length} 只股票</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              盈利 <span className="text-rose-400 font-semibold">{winnerPositions.length}</span> 只 / 亏损 <span className="text-emerald-400 font-semibold">{loserPositions.length}</span> 只
            </p>
          </div>
          <button
            onClick={onTriggerAI}
            className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center space-x-1.5"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>生成每日持仓诊断</span>
          </button>
        </div>
      </div>

      {/* 3. Asset Allocation Double Donut View */}
      {positions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Donut 1: Stock Market Value Weights */}
          <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-indigo-400" />
                <span>持仓个股资产分布</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">共 {positions.length} 个标的</span>
            </div>
            <div className="h-[230px] w-full">
              <ReactECharts option={stockPieOption} style={{ height: '100%', width: '100%' }} />
            </div>
          </div>

          {/* Donut 2: Strategy Tag Distribution */}
          <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-400" />
                <span>操盘策略风格暴露</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">{strategyStats.length} 类策略</span>
            </div>
            <div className="h-[230px] w-full">
              <ReactECharts option={strategyPieOption} style={{ height: '100%', width: '100%' }} />
            </div>
          </div>
        </div>
      )}

      {/* 4. Realtime Movers & Radar Alerts Dual Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Today's Holdings Performance Movers */}
        <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center space-x-2">
              <Award className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-100">今日持仓异动先锋</h3>
            </div>
            <span className="text-xs text-slate-400">点击查看实时 K 线</span>
          </div>

          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {topMovers.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                暂无持仓股票，请前往“持仓与自选”录入或导入
              </div>
            ) : (
              topMovers.map((pos) => {
                const pct = parseFloat((pos.pct_chg || '0').replace('%', '').replace('+', '')) || 0;
                const isPositive = pct >= 0;
                return (
                  <div
                    key={pos.id}
                    onClick={() => onSelectStock(pos.symbol)}
                    className="p-3 bg-slate-950/70 hover:bg-slate-800/70 border border-slate-800/80 rounded-xl flex items-center justify-between cursor-pointer transition-all group"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-indigo-300 transition-colors">
                          {pos.name}
                        </span>
                        <span className="text-xs font-mono text-slate-400">({pos.symbol})</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-900 border border-slate-800 text-slate-300">
                          {pos.strategy_tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 font-mono">
                        最新: ¥{pos.current_price?.toFixed(2)} | 成本: ¥{pos.cost_price?.toFixed(2)}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className={`font-mono font-bold text-sm ${isPositive ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {isPositive ? '+' : ''}{pos.pct_chg}
                      </div>
                      <div className={`text-[11px] font-mono mt-0.5 ${pos.profit_loss >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        累计: {pos.profit_loss >= 0 ? '+' : ''}¥{pos.profit_loss?.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Watchlist Key Price Alerts Radar */}
        <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center space-x-2">
              <Target className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-100">自选池买点接近度雷达</h3>
            </div>
            <span className="text-xs text-slate-400">接近或已触碰目标买价</span>
          </div>

          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {actionableWatchlist.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                自选池暂无设定目标买价的股票
              </div>
            ) : (
              actionableWatchlist.map((w) => {
                const isTriggered = w.distancePct <= 0;
                return (
                  <div
                    key={w.id}
                    onClick={() => onSelectStock(w.symbol)}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all group ${
                      isTriggered 
                        ? 'bg-rose-950/30 border-rose-800/50 hover:bg-rose-950/50' 
                        : 'bg-slate-950/70 border-slate-800/80 hover:bg-slate-800/70'
                    }`}
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs sm:text-sm text-slate-100 group-hover:text-indigo-300 transition-colors">
                          {w.name}
                        </span>
                        <span className="text-xs font-mono text-slate-400">({w.symbol})</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono">
                          {w.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 font-mono">
                        目标买价: <span className="text-amber-300 font-bold">¥{w.target_buy_price}</span> | 现价: ¥{w.current_price?.toFixed(2)}
                      </p>
                    </div>

                    <div className="text-right">
                      {isTriggered ? (
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                          已跌入买点 ({w.distancePct.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-xs font-mono font-semibold text-slate-300">
                          距买点仅剩 <span className="text-amber-400 font-bold">{w.distancePct.toFixed(1)}%</span>
                        </span>
                      )}
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">{w.pct_chg}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
