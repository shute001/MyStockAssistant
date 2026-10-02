import React, { useState, useEffect } from 'react';
import { 
  X, Target, ShieldAlert, TrendingDown, TrendingUp, Zap, Sparkles, Check, 
  Trash2, RefreshCw, Bell, AlertTriangle, Play, Pause, Compass, ArrowRight, MessageSquare
} from 'lucide-react';
import axios from 'axios';
import { PositionItem, PositionConditionItem, ConditionType, SuggestedCondition } from '../types';

interface StopLossModalProps {
  position: PositionItem;
  onClose: () => void;
  onConditionsUpdated?: () => void;
}

export const StopLossModal: React.FC<StopLossModalProps> = ({
  position,
  onClose,
  onConditionsUpdated
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'add' | 'ai_suggest'>('list');
  const [conditions, setConditions] = useState<PositionConditionItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Form State for creating new condition
  const [selectedType, setSelectedType] = useState<ConditionType>('STOP_LOSS');
  const [targetPrice, setTargetPrice] = useState<string>('');
  const [maPeriod, setMaPeriod] = useState<number>(20);
  const [trailPercent, setTrailPercent] = useState<string>('5.0');
  const [conditionLabel, setConditionLabel] = useState<string>('');
  const [strategyNote, setStrategyNote] = useState<string>('');
  const [notifyWechat, setNotifyWechat] = useState<boolean>(true);
  const [notifyPopup, setNotifyPopup] = useState<boolean>(true);

  // AI Suggestions State
  const [aiSuggestions, setAiSuggestions] = useState<SuggestedCondition[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [selectedAiIndexes, setSelectedAiIndexes] = useState<number[]>([]);

  useEffect(() => {
    fetchConditions();
  }, [position.symbol]);

  const fetchConditions = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get(`/api/v1/stocks/conditions?symbol=${position.symbol}`);
      setConditions(res.data || []);
    } catch (err) {
      console.error('Failed to load conditions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleCondition = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/stocks/conditions/${id}`, {
        is_active: !currentActive
      });
      fetchConditions();
      onConditionsUpdated?.();
    } catch (err) {
      alert('切换条件状态失败');
    }
  };

  const handleDeleteCondition = async (id: number) => {
    if (!confirm('确定删除此监控条件吗？')) return;
    try {
      await axios.delete(`/api/v1/stocks/conditions/${id}`);
      fetchConditions();
      onConditionsUpdated?.();
    } catch (err) {
      alert('删除条件失败');
    }
  };

  const handleCreateCondition = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      let targetVal: number | undefined = undefined;
      if (selectedType === 'STOP_LOSS' || selectedType === 'TARGET_PROFIT') {
        const p = parseFloat(targetPrice);
        if (isNaN(p) || p <= 0) {
          alert('请输入有效的目标价格');
          setIsSaving(false);
          return;
        }
        targetVal = p;
      }

      await axios.post('/api/v1/stocks/conditions', {
        symbol: position.symbol,
        name: position.name,
        condition_type: selectedType,
        condition_label: conditionLabel || undefined,
        target_value: targetVal,
        ma_period: selectedType.startsWith('MA_') ? maPeriod : undefined,
        trail_percent: selectedType === 'TRAILING_STOP' ? parseFloat(trailPercent) || 5.0 : undefined,
        notify_wechat: notifyWechat,
        notify_popup: notifyPopup,
        strategy_note: strategyNote || undefined
      });

      // Reset form
      setTargetPrice('');
      setConditionLabel('');
      setStrategyNote('');
      fetchConditions();
      onConditionsUpdated?.();
      setActiveSubTab('list');
    } catch (err) {
      alert('创建监控条件失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFetchAISuggestions = async () => {
    setIsLoadingAI(true);
    try {
      const res = await axios.get(`/api/v1/stocks/conditions/ai-suggest?symbol=${position.symbol}`);
      const list: SuggestedCondition[] = res.data.suggested_conditions || [];
      setAiSuggestions(list);
      setSelectedAiIndexes(list.map((_, i) => i)); // select all by default
      setActiveSubTab('ai_suggest');
    } catch (err) {
      alert('获取 AI 智能策略推荐失败');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleApplyAISuggestions = async () => {
    const toApply = aiSuggestions
      .filter((_, i) => selectedAiIndexes.includes(i))
      .map((item) => ({
        ...item,
        symbol: position.symbol,
        name: position.name
      }));
    if (toApply.length === 0) {
      alert('请勾选至少一条推荐条件');
      return;
    }
    setIsSaving(true);
    try {
      await axios.post('/api/v1/stocks/conditions/batch', {
        symbol: position.symbol,
        name: position.name,
        conditions: toApply
      });
      fetchConditions();
      onConditionsUpdated?.();
      setActiveSubTab('list');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail : (Array.isArray(detail) ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ') : (err.message || '网络请求失败'));
      alert(`批量应用 AI 推荐条件失败: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckConditionsNow = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post('/api/v1/stocks/conditions/check-now');
      const count = res.data.triggered_count || 0;
      if (count > 0) {
        setTestResult(`⚡ 成功触发并产生 ${count} 条预警提醒！微信消息已同步发出。`);
      } else {
        setTestResult('✅ 判定完成：当前行情正常，各监控指标均在安全区间内。');
      }
      fetchConditions();
      onConditionsUpdated?.();
    } catch (err) {
      setTestResult('检测异常，请检查网络或后端服务');
    } finally {
      setIsTesting(false);
    }
  };

  const getConditionTypeBadge = (type: ConditionType) => {
    switch (type) {
      case 'STOP_LOSS':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-950/80 text-red-300 border border-red-800/60 rounded-md flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-red-400" /> 目标价止损</span>;
      case 'TARGET_PROFIT':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 rounded-md flex items-center gap-1"><Target className="w-3 h-3 text-emerald-400" /> 目标价止盈</span>;
      case 'MA_CROSS_BELOW':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded-md flex items-center gap-1"><TrendingDown className="w-3 h-3 text-amber-400" /> 跌破均线止损</span>;
      case 'MA_CROSS_ABOVE':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded-md flex items-center gap-1"><TrendingUp className="w-3 h-3 text-indigo-400" /> 突破均线止盈</span>;
      case 'MACD_DEATH_CROSS':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60 rounded-md flex items-center gap-1"><Zap className="w-3 h-3 text-rose-400" /> MACD死叉离场</span>;
      case 'MACD_GOLDEN_CROSS':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded-md flex items-center gap-1"><Zap className="w-3 h-3 text-cyan-400" /> MACD金叉买点</span>;
      case 'TRAILING_STOP':
        return <span className="px-2 py-0.5 text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60 rounded-md flex items-center gap-1"><Compass className="w-3 h-3 text-purple-400" /> 移动回撤止盈</span>;
      default:
        return <span className="px-2 py-0.5 text-[11px] bg-slate-800 text-slate-300 rounded-md">{type}</span>;
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="surface-card rounded-2xl max-w-2xl w-full border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-950/90 text-indigo-400 border border-indigo-700/40">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">{position.name}</h3>
                <span className="text-xs font-mono text-indigo-300 font-semibold px-2 py-0.5 bg-slate-800 rounded">
                  {position.symbol}
                </span>
                <span className="text-xs text-slate-400">
                  现价: <strong className="text-white font-mono">¥{position.current_price?.toFixed(2)}</strong>
                </span>
                <span className="text-xs text-slate-400">
                  成本: <strong className="text-slate-200 font-mono">¥{position.cost_price?.toFixed(2)}</strong>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                设置多维止损止盈智能风控，条件达成后即刻弹窗并微信通知
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-800/60 bg-slate-950/40 flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveSubTab('list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeSubTab === 'list'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>当前监控 ({conditions.length})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('add')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeSubTab === 'add'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>+ 添加新条件</span>
            </button>
          </div>

          <button
            onClick={handleFetchAISuggestions}
            disabled={isLoadingAI}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-900/80 to-indigo-900/80 hover:from-purple-800 hover:to-indigo-800 border border-purple-500/40 text-purple-200 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-all shadow-sm"
          >
            <Sparkles className={`w-3.5 h-3.5 text-purple-300 ${isLoadingAI ? 'animate-spin' : ''}`} />
            <span>{isLoadingAI ? 'AI 量化推演中…' : '🤖 AI 智能量化推荐条件'}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* View 1: Active Conditions List */}
          {activeSubTab === 'list' && (
            <div className="space-y-3">
              {isLoading ? (
                <div className="text-center py-10 text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>正在加载当前监控规则...</span>
                </div>
              ) : conditions.length === 0 ? (
                <div className="text-center py-12 surface-card rounded-xl border border-dashed border-slate-800 space-y-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center mx-auto text-slate-500">
                    <Target className="w-5 h-5" />
                  </div>
                  <div className="text-xs text-slate-400">
                    暂未为【{position.name}】配置止损止盈条件
                  </div>
                  <div className="flex items-center justify-center space-x-3 pt-2">
                    <button
                      onClick={() => setActiveSubTab('add')}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all"
                    >
                      手动创建条件
                    </button>
                    <button
                      onClick={handleFetchAISuggestions}
                      className="px-3 py-1.5 bg-purple-950/90 hover:bg-purple-900 border border-purple-700/50 text-purple-300 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>让 AI 推荐一组策略</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {conditions.map((cond) => {
                    return (
                      <div
                        key={cond.id}
                        className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          cond.is_triggered
                            ? 'bg-red-950/20 border-red-800/40'
                            : cond.is_active
                            ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                            : 'bg-slate-950 border-slate-900 opacity-60'
                        }`}
                      >
                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {getConditionTypeBadge(cond.condition_type)}
                            <span className="font-semibold text-xs text-slate-200">
                              {cond.condition_label || cond.condition_type}
                            </span>
                            {cond.is_triggered ? (
                              <span className="px-2 py-0.5 text-[10px] bg-red-900/60 text-red-300 border border-red-700/50 rounded-full font-semibold">
                                🔔 已触发 ({cond.triggered_at?.slice(11, 16)})
                              </span>
                            ) : cond.is_active ? (
                              <span className="px-2 py-0.5 text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 rounded-full font-semibold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                监控运行中
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded-full font-semibold">
                                已暂停
                              </span>
                            )}
                            {cond.notify_wechat && (
                              <span className="px-1.5 py-0.5 text-[9px] bg-emerald-950/70 text-emerald-300 border border-emerald-800/40 rounded">
                                微信推送
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                            {cond.target_value && (
                              <span>
                                阈值: <strong className="text-slate-200 font-mono">¥{cond.target_value.toFixed(2)}</strong>
                              </span>
                            )}
                            {cond.ma_period && (
                              <span>
                                均线: <strong className="text-indigo-300 font-mono">MA{cond.ma_period}</strong>
                              </span>
                            )}
                            {cond.trail_percent && (
                              <span>
                                回撤: <strong className="text-purple-300 font-mono">{cond.trail_percent}%</strong>
                              </span>
                            )}
                            {cond.trigger_reason && (
                              <span className="text-amber-300 font-medium">
                                原因: {cond.trigger_reason}
                              </span>
                            )}
                          </div>

                          {cond.strategy_note && (
                            <p className="text-[11px] text-slate-500 italic">
                              💡 备忘: {cond.strategy_note}
                            </p>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                          <button
                            onClick={() => handleToggleCondition(cond.id, cond.is_active)}
                            title={cond.is_active ? '暂停监控' : '恢复监控'}
                            className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            {cond.is_active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>
                          <button
                            onClick={() => handleDeleteCondition(cond.id)}
                            title="删除此条件"
                            className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* View 2: Add New Condition Form */}
          {activeSubTab === 'add' && (
            <form onSubmit={handleCreateCondition} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">选择监控条件类型：</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setSelectedType('STOP_LOSS'); setConditionLabel('🛑 目标价止损'); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'STOP_LOSS'
                        ? 'bg-red-950/80 border-red-500 text-red-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                      <span>目标价止损</span>
                    </div>
                    <span className="text-[10px] text-slate-400">跌破指定价格触发</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSelectedType('TARGET_PROFIT'); setConditionLabel('🎯 目标价止盈'); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'TARGET_PROFIT'
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-emerald-400" />
                      <span>目标价止盈</span>
                    </div>
                    <span className="text-[10px] text-slate-400">涨超指定目标锁定</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSelectedType('MA_CROSS_BELOW'); setConditionLabel('📉 跌破20日均线防守'); setMaPeriod(20); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'MA_CROSS_BELOW'
                        ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                      <span>跌破均线止损</span>
                    </div>
                    <span className="text-[10px] text-slate-400">击穿生命均线触发</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSelectedType('MA_CROSS_ABOVE'); setConditionLabel('🚀 突破均线止盈'); setMaPeriod(20); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'MA_CROSS_ABOVE'
                        ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                      <span>突破均线止盈</span>
                    </div>
                    <span className="text-[10px] text-slate-400">站上阻力均线提醒</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSelectedType('MACD_DEATH_CROSS'); setConditionLabel('⚡ MACD死叉离场'); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'MACD_DEATH_CROSS'
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-rose-400" />
                      <span>MACD死叉风控</span>
                    </div>
                    <span className="text-[10px] text-slate-400">DIF穿DEA向下离场</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSelectedType('TRAILING_STOP'); setConditionLabel('🛡️ 移动最高价回撤止盈'); setTrailPercent('5.0'); }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col space-y-1 ${
                      selectedType === 'TRAILING_STOP'
                        ? 'bg-purple-950/80 border-purple-500 text-purple-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-purple-400" />
                      <span>移动回撤止盈</span>
                    </div>
                    <span className="text-[10px] text-slate-400">最高点回撤X%止盈</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Inputs based on type */}
              {(selectedType === 'STOP_LOSS' || selectedType === 'TARGET_PROFIT') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    {selectedType === 'STOP_LOSS' ? '止损触发价格 (元)：' : '止盈目标价格 (元)：'}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder={`现价 ¥${position.current_price?.toFixed(2)}`}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                    {/* Fast Presets */}
                    {selectedType === 'STOP_LOSS' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setTargetPrice((position.current_price * 0.95).toFixed(2))}
                          className="px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-red-300 font-mono"
                        >
                          -5%
                        </button>
                        <button
                          type="button"
                          onClick={() => setTargetPrice((position.current_price * 0.92).toFixed(2))}
                          className="px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-red-300 font-mono"
                        >
                          -8%
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setTargetPrice((position.current_price * 1.05).toFixed(2))}
                          className="px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-emerald-300 font-mono"
                        >
                          +5%
                        </button>
                        <button
                          type="button"
                          onClick={() => setTargetPrice((position.current_price * 1.10).toFixed(2))}
                          className="px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs text-emerald-300 font-mono"
                        >
                          +10%
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {selectedType.startsWith('MA_') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">均线监控周期：</label>
                  <div className="flex items-center space-x-2">
                    {[5, 10, 20, 60, 120].map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => {
                          setMaPeriod(period);
                          setConditionLabel(selectedType === 'MA_CROSS_BELOW' ? `📉 跌破${period}日均线` : `🚀 突破${period}日均线`);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                          maPeriod === period
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        MA{period}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedType === 'TRAILING_STOP' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">冲高最高点回撤比例 (%)：</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="30"
                    required
                    value={trailPercent}
                    onChange={(e) => setTrailPercent(e.target.value)}
                    placeholder="如 5.0 表示回撤 5% 止盈"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">规则标题标签：</label>
                <input
                  type="text"
                  value={conditionLabel}
                  onChange={(e) => setConditionLabel(e.target.value)}
                  placeholder="例如：跌破支撑线坚决防守"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">策略备忘与理由：</label>
                <input
                  type="text"
                  value={strategyNote}
                  onChange={(e) => setStrategyNote(e.target.value)}
                  placeholder="记录该条件的买卖逻辑或防守初衷..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Notification Toggles */}
              <div className="flex items-center space-x-6 pt-1">
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyWechat}
                    onChange={(e) => setNotifyWechat(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                  />
                  <span>发送微信通知推送 (Server酱/PushPlus/企微)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyPopup}
                    onChange={(e) => setNotifyPopup(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                  />
                  <span>到达条件后前端弹窗强提醒</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('list')}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md flex items-center space-x-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSaving ? '保存中...' : '确认并启动监控'}</span>
                </button>
              </div>
            </form>
          )}

          {/* View 3: AI Suggestions Preview */}
          {activeSubTab === 'ai_suggest' && (
            <div className="space-y-4">
              <div className="p-3 bg-purple-950/40 border border-purple-800/40 rounded-xl text-xs text-purple-200 flex items-start space-x-2">
                <Sparkles className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">AI 智能量化策略推演已就绪</div>
                  <p className="text-[11px] text-purple-300 mt-0.5">
                    基于【{position.name}】的实时支撑阻力位、20日生命线与 MACD 动能为您自动测算的科学风控条件，勾选后即可一键批量落地监控！
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {aiSuggestions.map((sug, idx) => {
                  const isChecked = selectedAiIndexes.includes(idx);
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedAiIndexes((prev) =>
                          prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                        );
                      }}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start space-x-3 ${
                        isChecked
                          ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-1 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                      />
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-xs text-slate-100">{sug.condition_label}</span>
                          {getConditionTypeBadge(sug.condition_type)}
                        </div>
                        <p className="text-[11px] text-slate-400">{sug.strategy_note}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveSubTab('list')}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  返回监控列表
                </button>
                <button
                  type="button"
                  onClick={handleApplyAISuggestions}
                  disabled={isSaving || selectedAiIndexes.length === 0}
                  className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md flex items-center space-x-1.5"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isSaving ? '正在应用...' : `一键应用选中的 ${selectedAiIndexes.length} 条条件`}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Testing Bar */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <Bell className="w-3.5 h-3.5 text-indigo-400" />
            <span>后台自动巡检周期：每 30 秒轮询比对行情</span>
          </div>

          <div className="flex items-center space-x-3">
            {testResult && (
              <span className="text-[11px] text-amber-300 font-medium truncate max-w-xs">
                {testResult}
              </span>
            )}
            <button
              onClick={handleCheckConditionsNow}
              disabled={isTesting}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold rounded-xl transition-all flex items-center space-x-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isTesting ? '正在判定...' : '立即测试判定'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
