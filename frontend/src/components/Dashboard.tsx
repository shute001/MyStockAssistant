import React from 'react';
import { DollarSign, TrendingUp, TrendingDown, PieChart, ShieldAlert, Cpu, Award } from 'lucide-react';
import { PositionItem, WatchlistItem } from '../types';

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
  const totalCost = positions.reduce((acc, item) => acc + item.total_cost, 0);
  const totalValue = positions.reduce((acc, item) => acc + item.current_value, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitRatio = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const winnerPositions = positions.filter((p) => p.profit_loss > 0);
  const loserPositions = positions.filter((p) => p.profit_loss < 0);

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Total Value */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden">
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
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
        <div className="bg-gradient-to-br from-indigo-900/60 to-slate-900 border border-indigo-500/30 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
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
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6">
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
                        ¥{pos.current_price?.toFixed(2)}
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

        {/* Watchlist Quick View (1 col) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
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
                    <span className="text-sm font-mono font-bold text-slate-100">¥{w.current_price?.toFixed(2)}</span>
                    <p className="text-xs text-indigo-400 font-medium">{w.category}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
