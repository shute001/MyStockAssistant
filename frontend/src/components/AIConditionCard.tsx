import React, { useState } from 'react';
import { 
  ShieldAlert, Target, TrendingDown, TrendingUp, Zap, Compass, 
  Sparkles, Check, CheckCircle2, RefreshCw, Layers
} from 'lucide-react';
import axios from 'axios';
import { AIConditionProposal, ConditionType } from '../types';

interface AIConditionCardProps {
  jsonString: string;
  onApplied?: () => void;
}

export const AIConditionCard: React.FC<AIConditionCardProps> = ({
  jsonString,
  onApplied
}) => {
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [isApplied, setIsApplied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  let proposal: AIConditionProposal | null = null;
  try {
    proposal = JSON.parse(jsonString);
  } catch (e) {
    try {
      // Try extracting json if extra text exists
      const start = jsonString.indexOf('{');
      const end = jsonString.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        proposal = JSON.parse(jsonString.substring(start, end + 1));
      }
    } catch (err) {
      // ignore
    }
  }

  const [selectedIndexes, setSelectedIndexes] = useState<number[]>(() => {
    return proposal ? proposal.conditions.map((_, i) => i) : [];
  });

  if (!proposal || !proposal.conditions || proposal.conditions.length === 0) {
    return (
      <div className="p-3 my-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-400 font-mono">
        {jsonString}
      </div>
    );
  }

  const handleApply = async () => {
    if (!proposal) return;
    const selectedConditions = proposal.conditions
      .filter((_, idx) => selectedIndexes.includes(idx))
      .map((item) => ({
        ...item,
        symbol: proposal?.symbol,
        name: proposal?.name
      }));
    if (selectedConditions.length === 0) {
      alert('请勾选至少一条监控条件');
      return;
    }

    setIsApplying(true);
    setError(null);
    try {
      await axios.post('/api/v1/stocks/conditions/batch', {
        symbol: proposal.symbol,
        name: proposal.name,
        conditions: selectedConditions
      });
      setIsApplied(true);
      onApplied?.();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ') : (err.message || '应用条件失败，请重试'));
      setError(msg);
    } finally {
      setIsApplying(false);
    }
  };

  const getConditionIcon = (type: ConditionType) => {
    switch (type) {
      case 'STOP_LOSS':
        return <ShieldAlert className="w-4 h-4 text-red-400" />;
      case 'TARGET_PROFIT':
        return <Target className="w-4 h-4 text-emerald-400" />;
      case 'MA_CROSS_BELOW':
        return <TrendingDown className="w-4 h-4 text-amber-400" />;
      case 'MA_CROSS_ABOVE':
        return <TrendingUp className="w-4 h-4 text-indigo-400" />;
      case 'MACD_DEATH_CROSS':
        return <Zap className="w-4 h-4 text-rose-400" />;
      case 'MACD_GOLDEN_CROSS':
        return <Zap className="w-4 h-4 text-cyan-400" />;
      case 'TRAILING_STOP':
        return <Compass className="w-4 h-4 text-purple-400" />;
      default:
        return <Layers className="w-4 h-4 text-indigo-400" />;
    }
  };

  return (
    <div className="my-3 rounded-2xl bg-gradient-to-br from-indigo-950/70 via-slate-900 to-purple-950/60 border border-indigo-500/40 p-4 shadow-xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-indigo-900/50 pb-2.5">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-indigo-900/60 text-indigo-300 border border-indigo-700/40">
            <Sparkles className="w-4 h-4 text-purple-300" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-sm text-white">{proposal.name}</span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-slate-800 text-indigo-300 rounded">
                {proposal.symbol}
              </span>
              <span className="text-xs text-purple-300 font-semibold">
                AI 智能止损止盈策略推荐
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              已由 AI 根据该股近期筹码支撑位、均线系统与 MACD 动能为您推演配置
            </p>
          </div>
        </div>

        {isApplied ? (
          <span className="px-3 py-1 bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            已生效监控
          </span>
        ) : (
          <span className="text-[11px] text-indigo-300">
            已勾选 {selectedIndexes.length} / {proposal.conditions.length} 项
          </span>
        )}
      </div>

      {/* Conditions Checklist */}
      <div className="space-y-2">
        {proposal.conditions.map((c, i) => {
          const isSelected = selectedIndexes.includes(i);
          return (
            <div
              key={i}
              onClick={() => {
                if (isApplied) return;
                setSelectedIndexes((prev) =>
                  prev.includes(i) ? prev.filter((idx) => idx !== i) : [...prev, i]
                );
              }}
              className={`p-2.5 rounded-xl border transition-all flex items-start space-x-2.5 text-xs ${
                isSelected
                  ? 'bg-slate-900/90 border-indigo-500/50 text-slate-200'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 opacity-60'
              } ${!isApplied ? 'cursor-pointer hover:border-indigo-400' : ''}`}
            >
              <input
                type="checkbox"
                disabled={isApplied}
                checked={isSelected}
                onChange={() => {}}
                className="mt-0.5 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
              />
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center space-x-2 font-semibold">
                  {getConditionIcon(c.condition_type)}
                  <span className="text-white">{c.condition_label || c.condition_type}</span>
                  {c.target_value && (
                    <span className="font-mono text-indigo-300">¥{c.target_value.toFixed(2)}</span>
                  )}
                  {c.ma_period && (
                    <span className="font-mono text-amber-300">MA{c.ma_period}</span>
                  )}
                  {c.trail_percent && (
                    <span className="font-mono text-purple-300">回撤{c.trail_percent}%</span>
                  )}
                </div>
                {c.strategy_note && (
                  <p className="text-[11px] text-slate-400">{c.strategy_note}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="text-[11px] text-red-400 font-medium">{error}</div>
      )}

      {/* Action Button */}
      <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
        <span className="text-[11px] text-slate-400">
          💡 到达条件后前端强提醒并自动推送到绑定的个人微信
        </span>

        {isApplied ? (
          <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>监控规则已落地运行中</span>
          </div>
        ) : (
          <button
            onClick={handleApply}
            disabled={isApplying || selectedIndexes.length === 0}
            className="px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isApplying ? '正在写入系统...' : '⚡ 一键应用到止损止盈条件单'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
