import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { DollarSign, TrendingUp, TrendingDown, PieChart, ShieldAlert, Cpu, Award, Globe, Flame, Newspaper, RefreshCw, AlertTriangle } from 'lucide-react';
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

  const totalCost = positions.reduce((acc, item) => acc + item.total_cost, 0);
  const totalValue = positions.reduce((acc, item) => acc + item.current_value, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitRatio = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const winnerPositions = positions.filter((p) => p.profit_loss > 0);
  const loserPositions = positions.filter((p) => p.profit_loss < 0);

  // ECharts Pie Chart for Asset Weight Allocation
  const pieChartOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#0F172A',
      borderColor: '#334155',
      textStyle: { color: '#F8FAFC', fontSize: 12 },
      formatter: '{b}: ¥{c} ({d}%)'
    },
    series: [
      {
        name: '持仓市值占比',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#0F172A',
          borderWidth: 2
        },
        label: {
          show: true,
          color: '#CBD5E1',
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

  return (
    <div className="space-y-6">
      {/* Market Macro & News Bar */}
      <div className="surface-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <Globe className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-slate-100">大盘情绪、资金风向与热点消息面</h2>
            <span className={`px-2 py-0.5 text-[10px] border rounded-full font-mono ${macroData?.meta?.status === 'partial_fallback' ? 'bg-amber-950/60 text-amber-300 border-amber-800/60' : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'}`}>
              {macroData?.meta?.status === 'partial_fallback' ? '部分演示数据' : '实时数据'}
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
            <span>市场数据加载失败，请检查网络后重试。</span>
            <button onClick={fetchMacro} className="font-semibold text-red-100 hover:text-white">重试</button>
          </div>
        )}

        {/* Indices Tickers */}
        {macroData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {macroData.indices.map((idx) => {
              const isUp = idx.pct_num >= 0;
              return (
                <div key={idx.name} className="bg-slate-950 border border-slate-800/90 rounded-xl p-3 flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-slate-400">{idx.name}</span>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-sm sm:text-base font-bold font-mono text-slate-100">{idx.price.toFixed(2)}</span>
                    <span className={`text-xs font-mono font-bold ${isUp ? 'text-red-400' : 'text-emerald-400'}`}>
                      {idx.pct_chg}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hot Sectors & Headlines Dual Panel */}
        {macroData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
            {/* Hot Sectors */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-400" />
                主力领涨 / 热门板块 Top 6
              </span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {macroData.hot_sectors.map((s) => (
                  <span
                    key={s.name}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-200 flex items-center space-x-1"
                  >
                    <span>{s.name}</span>
                    <span className="text-red-400 font-mono text-[11px]">{s.pct_chg}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Latest News Headlines */}
            <div className="lg:col-span-2 bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Newspaper className="w-4 h-4 text-indigo-400" />
                最新财经新闻与重大快讯
              </span>
              <div className="space-y-1 max-h-[85px] overflow-y-auto pr-1">
                {macroData.latest_news.map((news, i) => (
                  <div key={i} className="text-xs text-slate-300 truncate flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"></span>
                    <span className="truncate">{news}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Total Value */}
        <div className="surface-card interactive-card rounded-2xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">持仓总市值</span>
            <DollarSign className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-100">¥{totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <p className="text-xs text-slate-400 mt-1">成本: ¥{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Card 2: Total Profit/Loss */}
        <div className="surface-card interactive-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">累计总盈亏</span>
            {totalProfit >= 0 ? (
              <TrendingUp className="w-5 h-5 text-red-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-emerald-400" />
            )}
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {totalProfit >= 0 ? '+' : ''}¥{totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <p className={`text-xs font-medium mt-1 ${totalProfit >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              收益率: {totalProfitRatio >= 0 ? '+' : ''}{totalProfitRatio.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Card 3: Positions Count */}
        <div className="surface-card interactive-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">持仓集中度</span>
            <PieChart className="w-5 h-5 text-amber-400" />
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold text-slate-100">{positions.length} 只股票</span>
            <p className="text-xs text-slate-400 mt-1">
              盈利: <span className="text-red-400 font-semibold">{winnerPositions.length}</span> / 亏损: <span className="text-emerald-400 font-semibold">{loserPositions.length}</span>
            </p>
          </div>
        </div>

        {/* Card 4: Quick AI Trigger */}
        <div className="interactive-card bg-gradient-to-br from-indigo-900/75 to-slate-900 border border-indigo-500/35 rounded-2xl p-5 shadow-xl shadow-indigo-950/20 flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-1">
              <Cpu className="w-4 h-4" /> AI 每日诊断
            </span>
            <p className="text-xs text-slate-300 mt-1">一键对全仓进行深度量化诊断与风控分析</p>
          </div>
          <button
            onClick={onTriggerAI}
            className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center space-x-1.5"
          >
            <Cpu className="w-4 h-4" />
            <span>生成每日持仓诊断</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Holdings Top Winners & Losers (2 cols) */}
        <div className="surface-card lg:col-span-2 rounded-2xl p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-400" />
              持仓个股实时态势
            </h2>
            <span className="text-xs text-slate-400">点击个股可查看交互式 K 线图</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">股票</th>
                  <th className="py-3 px-4 text-right">最新价</th>
                  <th className="py-3 px-4 text-right">成本价</th>
                  <th className="py-3 px-4 text-right">持仓盈亏</th>
                  <th className="py-3 px-4 text-center">均线形态</th>
                  <th className="py-3 px-4 text-center">MACD 状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500">
                      暂无持仓数据，请前往“持仓与自选”导入同花顺数据
                    </td>
                  </tr>
                ) : (
                  positions.map((pos) => (
                    <tr
                      key={pos.id}
                      onClick={() => onSelectStock(pos.symbol)}
                      className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-medium text-slate-100">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold">{pos.name}</span>
                          <span className="text-xs font-mono text-slate-400">({pos.symbol})</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold">
                        <div>¥{pos.current_price?.toFixed(2)}</div>
                        {pos.quote_status === 'unavailable' && <span className="text-[10px] font-sans font-medium text-amber-300">非实时价格</span>}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-400">
                        ¥{pos.cost_price?.toFixed(2)}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-mono font-bold ${pos.profit_loss >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {pos.profit_loss >= 0 ? '+' : ''}¥{pos.profit_loss?.toFixed(2)} ({pos.profit_ratio >= 0 ? '+' : ''}{pos.profit_ratio?.toFixed(2)}%)
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2.5 py-1 text-xs rounded-full bg-slate-800 text-indigo-300 font-medium">
                          {pos.ma_trend}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="text-xs text-slate-300">
                          {pos.macd_status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Watchlist Quick View & Asset Weight Chart (1 col) */}
        <div className="space-y-6">
          {/* Asset Allocation Chart Card */}
          {positions.length > 0 && (
            <div className="surface-card rounded-2xl p-4 sm:p-5 space-y-2">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-indigo-400" />
                <span>持仓资产市值占比分布</span>
              </h2>
              <div className="h-[200px] w-full">
                <ReactECharts option={pieChartOption} style={{ height: '100%', width: '100%' }} />
              </div>
            </div>
          )}

          <div className="surface-card rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                自选观察池预警
              </h2>
              <span className="text-xs text-slate-400">{watchlists.length} 只股票</span>
            </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {watchlists.length === 0 ? (
              <p className="text-center text-slate-500 py-8 text-xs">自选池暂无监控股票</p>
            ) : (
              watchlists.map((w) => (
                <div
                  key={w.id}
                  onClick={() => onSelectStock(w.symbol)}
                  className="bg-slate-950 hover:bg-slate-800/80 border border-slate-800 rounded-xl p-3.5 cursor-pointer transition-all flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-slate-200">{w.name}</span>
                      <span className="text-xs font-mono text-slate-400">{w.symbol}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      目标买价: <span className="text-amber-400 font-mono">¥{w.target_buy_price || '-'}</span> | 支撑位: <span className="text-indigo-300 font-mono">¥{w.support_price || '-'}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono font-bold text-slate-100">{w.quote_status === 'unavailable' ? '—' : `¥${w.current_price?.toFixed(2)}`}</span>
                    {w.quote_status === 'unavailable' && <p className="text-[10px] text-amber-300">行情不可用</p>}
                    <p className="text-xs text-indigo-400 font-medium">{w.category}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
