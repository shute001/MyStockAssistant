import React, { useState, useEffect } from 'react';
import { 
  X, Bell, ShieldAlert, Target, TrendingDown, TrendingUp, Zap, Compass, 
  Check, CheckCheck, Trash2, RefreshCw, ExternalLink, SlidersHorizontal, 
  MessageSquare, Search, Filter, AlertTriangle, ShieldCheck, Plus, Edit3, 
  Play, Pause, Sparkles, Eraser, CheckSquare, Square
} from 'lucide-react';
import axios from 'axios';
import { AlertNotificationItem, PositionConditionItem, ConditionType } from '../types';

interface AlertCenterModalProps {
  onClose: () => void;
  onSelectStock?: (symbol: string) => void;
  onOpenConditions?: (symbol: string) => void;
  onAlertsChanged?: () => void;
  defaultTab?: 'rules' | 'history';
}

export const AlertCenterModal: React.FC<AlertCenterModalProps> = ({
  onClose,
  onSelectStock,
  onOpenConditions,
  onAlertsChanged,
  defaultTab = 'rules'
}) => {
  // Top-level Tab: 'rules' (监控条件规则管理) | 'history' (已触发预警通知记录)
  const [activeMainTab, setActiveMainTab] = useState<'rules' | 'history'>(defaultTab);

  // ==========================================
  // 1. 监控条件规则 (Conditions) State
  // ==========================================
  const [conditions, setConditions] = useState<PositionConditionItem[]>([]);
  const [isLoadingConditions, setIsLoadingConditions] = useState<boolean>(true);
  const [ruleFilter, setRuleFilter] = useState<'ALL' | 'ACTIVE' | 'ORPHAN' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'INDICATOR'>('ALL');
  const [ruleSearchQuery, setRuleSearchQuery] = useState<string>('');
  const [isCleaningOrphan, setIsCleaningOrphan] = useState<boolean>(false);
  const [isTestingNow, setIsTestingNow] = useState<boolean>(false);

  // Batch Selection State for Conditions
  const [selectedConditionIds, setSelectedConditionIds] = useState<number[]>([]);
  const [isBatchDeletingConditions, setIsBatchDeletingConditions] = useState<boolean>(false);

  // Add / Edit Condition Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingCondition, setEditingCondition] = useState<PositionConditionItem | null>(null);

  // Form State for Add Condition
  const [formSymbol, setFormSymbol] = useState<string>('');
  const [formName, setFormName] = useState<string>('');
  const [formCurrentPrice, setFormCurrentPrice] = useState<number | null>(null);
  const [formType, setFormType] = useState<ConditionType>('STOP_LOSS');
  const [formTargetPrice, setFormTargetPrice] = useState<string>('');
  const [formMaPeriod, setFormMaPeriod] = useState<number>(20);
  const [formTrailPercent, setFormTrailPercent] = useState<string>('5.0');
  const [formLabel, setFormLabel] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [formNotifyWechat, setFormNotifyWechat] = useState<boolean>(true);
  const [formNotifyPopup, setFormNotifyPopup] = useState<boolean>(true);
  const [isSearchingStock, setIsSearchingStock] = useState<boolean>(false);
  const [isSavingCondition, setIsSavingCondition] = useState<boolean>(false);

  // Form State for Edit Condition
  const [editTargetPrice, setEditTargetPrice] = useState<string>('');
  const [editLabel, setEditLabel] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [editNotifyWechat, setEditNotifyWechat] = useState<boolean>(true);

  // ==========================================
  // 2. 预警通知历史 (Alert Notifications) State
  // ==========================================
  const [alerts, setAlerts] = useState<AlertNotificationItem[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState<boolean>(true);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'UNREAD' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'INDICATOR'>('ALL');
  const [alertSearchQuery, setAlertSearchQuery] = useState<string>('');

  // Batch Selection State for Alerts
  const [selectedAlertIds, setSelectedAlertIds] = useState<number[]>([]);
  const [isBatchDeletingAlerts, setIsBatchDeletingAlerts] = useState<boolean>(false);

  useEffect(() => {
    fetchConditions();
    fetchAlerts();
  }, []);

  const fetchConditions = async () => {
    setIsLoadingConditions(true);
    try {
      const res = await axios.get('/api/v1/stocks/conditions');
      setConditions(res.data || []);
    } catch (err) {
      console.error('Failed to load conditions:', err);
    } finally {
      setIsLoadingConditions(false);
    }
  };

  const fetchAlerts = async () => {
    setIsLoadingAlerts(true);
    try {
      const res = await axios.get('/api/v1/stocks/alerts?limit=100');
      setAlerts(res.data || []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  // Toggle Condition Active Status
  const handleToggleCondition = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/stocks/conditions/${id}`, {
        is_active: !currentActive
      });
      fetchConditions();
      onAlertsChanged?.();
    } catch (err) {
      alert('切换监控条件状态失败');
    }
  };

  // Delete Single Condition
  const handleDeleteCondition = async (id: number) => {
    if (!confirm('确定删除此条监控预警规则吗？')) return;
    try {
      await axios.delete(`/api/v1/stocks/conditions/${id}`);
      setConditions((prev) => prev.filter((c) => c.id !== id));
      setSelectedConditionIds((prev) => prev.filter((item) => item !== id));
      onAlertsChanged?.();
    } catch (err) {
      alert('删除监控条件失败');
    }
  };

  // 批量删除选中的监控规则 (Batch Delete Conditions)
  const handleBatchDeleteConditions = async () => {
    if (selectedConditionIds.length === 0) {
      alert('请先勾选需要删除的监控规则');
      return;
    }
    if (!confirm(`确定要批量删除选中的 ${selectedConditionIds.length} 条监控预警规则吗？此操作不可撤销。`)) {
      return;
    }
    setIsBatchDeletingConditions(true);
    try {
      const res = await axios.post('/api/v1/stocks/conditions/batch-delete', {
        ids: selectedConditionIds
      });
      alert(res.data.message || `成功批量删除 ${selectedConditionIds.length} 条监控规则`);
      setSelectedConditionIds([]);
      fetchConditions();
      onAlertsChanged?.();
    } catch (err: any) {
      alert('批量删除失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsBatchDeletingConditions(false);
    }
  };

  // Cleanup Orphan Conditions (无持仓遗留条件)
  const handleCleanupOrphanConditions = async () => {
    const orphanCount = conditions.filter((c) => !c.is_held).length;
    if (orphanCount === 0) {
      alert('当前没有无持仓的遗留监控规则');
      return;
    }
    if (!confirm(`检测到 ${orphanCount} 条已删除持仓遗留的无主预警条件。\n\n确定要一键清理这些规则吗？`)) {
      return;
    }
    setIsCleaningOrphan(true);
    try {
      const res = await axios.delete('/api/v1/stocks/conditions/cleanup-orphan');
      alert(res.data.message || `成功清理 ${orphanCount} 条遗留预警规则`);
      fetchConditions();
      setSelectedConditionIds([]);
      onAlertsChanged?.();
    } catch (err) {
      alert('清理无持仓预警条件失败');
    } finally {
      setIsCleaningOrphan(false);
    }
  };

  // Manual Trigger Test
  const handleCheckNow = async () => {
    setIsTestingNow(true);
    try {
      const res = await axios.post('/api/v1/stocks/conditions/check-now');
      const count = res.data.triggered_count || 0;
      if (count > 0) {
        alert(`⚡ 评估完成！实时触发了 ${count} 条风控预警，已为您记入预警历史并执行通知！`);
      } else {
        alert('✅ 评估完成！当前所有活跃规则均未达到触发临界点，持仓运行正常。');
      }
      fetchConditions();
      fetchAlerts();
      onAlertsChanged?.();
    } catch (err) {
      alert('手动检测失败');
    } finally {
      setIsTestingNow(false);
    }
  };

  // Auto fetch stock name & quote when entering symbol in Add Modal
  const handleSearchStockInfo = async (sym: string) => {
    const cleanSym = sym.trim();
    if (cleanSym.length < 5) return;
    setIsSearchingStock(true);
    try {
      const res = await axios.get(`/api/v1/stocks/search?q=${cleanSym}`);
      if (Array.isArray(res.data) && res.data.length > 0) {
        const found = res.data[0];
        setFormName(found.name || '');
        if (found.current_price) {
          setFormCurrentPrice(found.current_price);
          if (!formTargetPrice) {
            if (formType === 'STOP_LOSS') {
              setFormTargetPrice((found.current_price * 0.95).toFixed(2));
            } else if (formType === 'TARGET_PROFIT') {
              setFormTargetPrice((found.current_price * 1.10).toFixed(2));
            }
          }
        }
      }
    } catch (err) {
      // ignore
    } finally {
      setIsSearchingStock(false);
    }
  };

  // Submit Add Condition
  const handleCreateCondition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSymbol.trim()) {
      alert('请输入有效的股票代码');
      return;
    }
    setIsSavingCondition(true);
    try {
      let targetVal: number | undefined = undefined;
      if (formType === 'STOP_LOSS' || formType === 'TARGET_PROFIT') {
        const p = parseFloat(formTargetPrice);
        if (isNaN(p) || p <= 0) {
          alert('请输入有效的目标价格');
          setIsSavingCondition(false);
          return;
        }
        targetVal = p;
      }

      await axios.post('/api/v1/stocks/conditions', {
        symbol: formSymbol.trim(),
        name: formName.trim() || undefined,
        condition_type: formType,
        condition_label: formLabel || undefined,
        target_value: targetVal,
        ma_period: (formType === 'MA_CROSS_BELOW' || formType === 'MA_CROSS_ABOVE') ? formMaPeriod : undefined,
        trail_percent: formType === 'TRAILING_STOP' ? parseFloat(formTrailPercent) : undefined,
        notify_wechat: formNotifyWechat,
        notify_popup: formNotifyPopup,
        strategy_note: formNote || undefined
      });

      setIsAddModalOpen(false);
      setFormSymbol('');
      setFormName('');
      setFormTargetPrice('');
      setFormLabel('');
      setFormNote('');
      setFormCurrentPrice(null);

      fetchConditions();
      onAlertsChanged?.();
      alert('✅ 预警监控条件创建成功！');
    } catch (err: any) {
      alert('创建监控条件失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsSavingCondition(false);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (cond: PositionConditionItem) => {
    setEditingCondition(cond);
    setEditTargetPrice(cond.target_value ? cond.target_value.toString() : '');
    setEditLabel(cond.condition_label || '');
    setEditNote(cond.strategy_note || '');
    setEditNotifyWechat(cond.notify_wechat);
  };

  // Submit Edit Condition
  const handleSaveEdit = async () => {
    if (!editingCondition) return;
    try {
      const p = parseFloat(editTargetPrice);
      await axios.put(`/api/v1/stocks/conditions/${editingCondition.id}`, {
        target_value: !isNaN(p) ? p : editingCondition.target_value,
        condition_label: editLabel || undefined,
        strategy_note: editNote || undefined,
        notify_wechat: editNotifyWechat
      });
      setEditingCondition(null);
      fetchConditions();
      onAlertsChanged?.();
      alert('✅ 条件修改已保存！');
    } catch (err: any) {
      alert('修改条件失败: ' + (err.response?.data?.detail || err.message));
    }
  };

  // Alert Notifications Handlers
  const handleMarkAllRead = async () => {
    try {
      await axios.post('/api/v1/stocks/alerts/mark-read');
      fetchAlerts();
      onAlertsChanged?.();
    } catch (err) {
      alert('标记全部已读失败');
    }
  };

  const handleMarkSingleRead = async (id: number) => {
    try {
      await axios.post('/api/v1/stocks/alerts/mark-read', { alert_ids: [id] });
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
      onAlertsChanged?.();
    } catch (err) {
      alert('标记已读失败');
    }
  };

  const handleDeleteSingleAlert = async (id: number) => {
    try {
      await axios.delete(`/api/v1/stocks/alerts/${id}`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      setSelectedAlertIds((prev) => prev.filter((item) => item !== id));
      onAlertsChanged?.();
    } catch (err) {
      alert('删除记录失败');
    }
  };

  // 批量删除选中的通知记录 (Batch Delete Alerts)
  const handleBatchDeleteAlerts = async () => {
    if (selectedAlertIds.length === 0) {
      alert('请先勾选需要删除的通知记录');
      return;
    }
    if (!confirm(`确定要批量删除选中的 ${selectedAlertIds.length} 条预警通知记录吗？`)) {
      return;
    }
    setIsBatchDeletingAlerts(true);
    try {
      const res = await axios.post('/api/v1/stocks/alerts/batch-delete', {
        ids: selectedAlertIds
      });
      alert(res.data.message || `成功删除 ${selectedAlertIds.length} 条预警记录`);
      setSelectedAlertIds([]);
      fetchAlerts();
      onAlertsChanged?.();
    } catch (err: any) {
      alert('批量删除预警记录失败');
    } finally {
      setIsBatchDeletingAlerts(false);
    }
  };

  // 批量标记选中的通知为已读
  const handleBatchMarkAlertsRead = async () => {
    if (selectedAlertIds.length === 0) return;
    try {
      await axios.post('/api/v1/stocks/alerts/mark-read', {
        alert_ids: selectedAlertIds
      });
      setAlerts((prev) => prev.map((a) => (selectedAlertIds.includes(a.id) ? { ...a, is_read: true } : a)));
      setSelectedAlertIds([]);
      onAlertsChanged?.();
    } catch (err) {
      alert('批量标记已读失败');
    }
  };

  const handleClearReadAlerts = async () => {
    if (!confirm('确定清空所有已读的预警记录吗？未读记录将继续保留。')) return;
    try {
      await axios.delete('/api/v1/stocks/alerts?only_read=true');
      fetchAlerts();
      setSelectedAlertIds([]);
      onAlertsChanged?.();
    } catch (err) {
      alert('清空记录失败');
    }
  };

  // Filtered Conditions
  const orphanCount = conditions.filter((c) => !c.is_held).length;
  const filteredConditions = conditions.filter((c) => {
    if (ruleSearchQuery.trim()) {
      const q = ruleSearchQuery.trim().toLowerCase();
      const matchText = (c.symbol + c.name + (c.condition_label || '') + (c.strategy_note || '')).toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    if (ruleFilter === 'ACTIVE') return c.is_active && !c.is_triggered;
    if (ruleFilter === 'ORPHAN') return !c.is_held;
    if (ruleFilter === 'STOP_LOSS') return c.condition_type === 'STOP_LOSS';
    if (ruleFilter === 'TAKE_PROFIT') return c.condition_type === 'TARGET_PROFIT' || c.condition_type === 'TRAILING_STOP';
    if (ruleFilter === 'INDICATOR') return c.condition_type.includes('MA') || c.condition_type.includes('MACD');
    return true;
  });

  // Filtered Alerts
  const unreadCount = alerts.filter((a) => !a.is_read).length;
  const filteredAlerts = alerts.filter((a) => {
    if (alertSearchQuery.trim()) {
      const q = alertSearchQuery.trim().toLowerCase();
      const matchText = (a.symbol + a.name + a.title + a.message).toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    if (alertFilter === 'UNREAD') return !a.is_read;
    if (alertFilter === 'STOP_LOSS') return a.alert_type === 'STOP_LOSS' || a.title.includes('止损') || a.title.includes('破位');
    if (alertFilter === 'TAKE_PROFIT') return a.alert_type === 'TAKE_PROFIT' || a.title.includes('止盈') || a.title.includes('突破') || a.alert_type === 'TRAILING';
    if (alertFilter === 'INDICATOR') return a.alert_type === 'MA' || a.alert_type === 'MACD';
    return true;
  });

  // Toggle selection for all currently filtered conditions
  const isAllConditionsSelected = filteredConditions.length > 0 && filteredConditions.every((c) => selectedConditionIds.includes(c.id));
  const handleToggleSelectAllConditions = () => {
    const visibleIds = filteredConditions.map((c) => c.id);
    if (isAllConditionsSelected) {
      setSelectedConditionIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedConditionIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  // Toggle selection for all currently filtered alerts
  const isAllAlertsSelected = filteredAlerts.length > 0 && filteredAlerts.every((a) => selectedAlertIds.includes(a.id));
  const handleToggleSelectAllAlerts = () => {
    const visibleIds = filteredAlerts.map((a) => a.id);
    if (isAllAlertsSelected) {
      setSelectedAlertIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedAlertIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const getConditionTypeBadge = (c: PositionConditionItem) => {
    switch (c.condition_type) {
      case 'STOP_LOSS':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-950/80 text-red-300 border border-red-800/60 rounded-md flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-red-400" />
            目标价止损
          </span>
        );
      case 'TARGET_PROFIT':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 rounded-md flex items-center gap-1">
            <Target className="w-3 h-3 text-emerald-400" />
            目标价止盈
          </span>
        );
      case 'TRAILING_STOP':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60 rounded-md flex items-center gap-1">
            <Compass className="w-3 h-3 text-purple-400" />
            移动回撤止盈
          </span>
        );
      case 'MA_CROSS_BELOW':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded-md flex items-center gap-1">
            <TrendingDown className="w-3 h-3 text-amber-400" />
            跌破均线止损
          </span>
        );
      case 'MA_CROSS_ABOVE':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 rounded-md flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            上穿均线
          </span>
        );
      case 'MACD_DEATH_CROSS':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60 rounded-md flex items-center gap-1">
            <Zap className="w-3 h-3 text-rose-400" />
            MACD 高位死叉
          </span>
        );
      case 'MACD_GOLDEN_CROSS':
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded-md flex items-center gap-1">
            <Zap className="w-3 h-3 text-indigo-400" />
            MACD 低位金叉
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-800 text-slate-300 rounded-md">
            {c.condition_type}
          </span>
        );
    }
  };

  const getAlertBadge = (alert: AlertNotificationItem) => {
    const isStopLoss = alert.alert_type === 'STOP_LOSS' || alert.title.includes('止损') || alert.title.includes('破位');
    const isTakeProfit = alert.alert_type === 'TAKE_PROFIT' || alert.title.includes('止盈') || alert.title.includes('突破');
    const isTrailing = alert.alert_type === 'TRAILING';
    const isMacd = alert.alert_type === 'MACD';

    if (isStopLoss) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-950/80 text-red-300 border border-red-800/60 rounded-md flex items-center gap-1">
          <ShieldAlert className="w-3 h-3 text-red-400" />
          止损触碰
        </span>
      );
    }
    if (isTakeProfit) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 rounded-md flex items-center gap-1">
          <Target className="w-3 h-3 text-emerald-400" />
          止盈达成
        </span>
      );
    }
    if (isTrailing) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60 rounded-md flex items-center gap-1">
          <Compass className="w-3 h-3 text-purple-400" />
          移动回撤
        </span>
      );
    }
    if (isMacd) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded-md flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-400" />
          MACD信号
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded-md flex items-center gap-1">
        <TrendingDown className="w-3 h-3 text-indigo-400" />
        指标预警
      </span>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="surface-card rounded-2xl max-w-4xl w-full border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-700/40">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="font-bold text-base text-white">智能风控与预警中心</h3>
                {orphanCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800/60 rounded-full flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {orphanCount} 条遗留无持仓
                  </span>
                )}
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-mono font-bold bg-red-950 text-red-300 border border-red-800/60 rounded-full animate-pulse">
                    {unreadCount} 条未读通知
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                集中管理全局预警监控规则，支持多选批量删除、自由新增、启停修改和清理遗留条件
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                fetchConditions();
                fetchAlerts();
              }}
              disabled={isLoadingConditions || isLoadingAlerts}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="刷新全部数据"
            >
              <RefreshCw className={`w-4 h-4 ${(isLoadingConditions || isLoadingAlerts) ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Tab Bar: Rules vs Notifications */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-800/80 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveMainTab('rules')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center space-x-2 ${
                activeMainTab === 'rules'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>监控条件规则</span>
              <span className={`px-1.5 py-0.2 text-[11px] rounded-full font-mono ${
                activeMainTab === 'rules' ? 'bg-indigo-800 text-indigo-200' : 'bg-slate-800 text-slate-400'
              }`}>
                {conditions.length}
              </span>
            </button>

            <button
              onClick={() => setActiveMainTab('history')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center space-x-2 ${
                activeMainTab === 'history'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <Bell className="w-4 h-4" />
              <span>触发历史通知</span>
              <span className={`px-1.5 py-0.2 text-[11px] rounded-full font-mono ${
                unreadCount > 0 ? 'bg-red-600 text-white font-bold' : activeMainTab === 'history' ? 'bg-indigo-800 text-indigo-200' : 'bg-slate-800 text-slate-400'
              }`}>
                {alerts.length}
              </span>
            </button>
          </div>

          {activeMainTab === 'rules' && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold rounded-xl flex items-center space-x-1.5 shadow-md shadow-indigo-500/20 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增监控规则</span>
              </button>

              {orphanCount > 0 && (
                <button
                  onClick={handleCleanupOrphanConditions}
                  disabled={isCleaningOrphan}
                  className="px-3 py-1.5 bg-amber-950/80 hover:bg-amber-900 border border-amber-700/60 text-amber-200 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-all shadow-sm"
                  title="一键清理所有已删除持仓留下的预警规则"
                >
                  <Eraser className="w-3.5 h-3.5 text-amber-400" />
                  <span>清理遗留规则 ({orphanCount})</span>
                </button>
              )}

              <button
                onClick={handleCheckNow}
                disabled={isTestingNow}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-all"
                title="立即对所有激活条件执行实时行情比对"
              >
                <Sparkles className={`w-3.5 h-3.5 text-indigo-400 ${isTestingNow ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">立即评估</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: RULES BODY */}
        {activeMainTab === 'rules' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Filter Sub-bar */}
            <div className="px-5 py-2.5 border-b border-slate-800/60 bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setRuleFilter('ALL')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                    ruleFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  全部 ({conditions.length})
                </button>
                <button
                  onClick={() => setRuleFilter('ACTIVE')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                    ruleFilter === 'ACTIVE' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  监控中 ({conditions.filter(c => c.is_active && !c.is_triggered).length})
                </button>
                {orphanCount > 0 && (
                  <button
                    onClick={() => setRuleFilter('ORPHAN')}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                      ruleFilter === 'ORPHAN' ? 'bg-amber-600 text-white' : 'text-amber-400 hover:bg-amber-950/50'
                    }`}
                  >
                    <span>无持仓遗留</span>
                    <span className="px-1 bg-amber-950 rounded text-[10px]">{orphanCount}</span>
                  </button>
                )}
                <button
                  onClick={() => setRuleFilter('STOP_LOSS')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                    ruleFilter === 'STOP_LOSS' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  止损类
                </button>
                <button
                  onClick={() => setRuleFilter('TAKE_PROFIT')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                    ruleFilter === 'TAKE_PROFIT' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  止盈类
                </button>
                <button
                  onClick={() => setRuleFilter('INDICATOR')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all ${
                    ruleFilter === 'INDICATOR' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  均线/MACD
                </button>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={ruleSearchQuery}
                  onChange={(e) => setRuleSearchQuery(e.target.value)}
                  placeholder="搜索股票、代码或规则备注..."
                  className="w-48 sm:w-56 bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* BATCH ACTION BAR (监控规则多选批量操作栏) */}
            <div className="px-5 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-3">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAllConditionsSelected}
                    onChange={handleToggleSelectAllConditions}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="font-medium">
                    {isAllConditionsSelected ? '取消全选' : '全选当前列表'} ({filteredConditions.length})
                  </span>
                </label>

                {selectedConditionIds.length > 0 && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    已勾选 <span className="text-indigo-400 font-bold">{selectedConditionIds.length}</span> 项
                  </span>
                )}
              </div>

              {selectedConditionIds.length > 0 && (
                <div className="flex items-center space-x-2 animate-in fade-in duration-150">
                  <button
                    onClick={handleBatchDeleteConditions}
                    disabled={isBatchDeletingConditions}
                    className="px-3 py-1.5 bg-red-950 hover:bg-red-900 border border-red-700/70 text-red-200 font-semibold rounded-xl flex items-center space-x-1.5 shadow-md shadow-red-950/40 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>批量删除 ({selectedConditionIds.length})</span>
                  </button>

                  <button
                    onClick={() => setSelectedConditionIds([])}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors text-[11px]"
                  >
                    取消选择
                  </button>
                </div>
              )}
            </div>

            {/* Conditions List */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
              {isLoadingConditions ? (
                <div className="text-center py-16 text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>正在加载风控监控规则...</span>
                </div>
              ) : filteredConditions.length === 0 ? (
                <div className="text-center py-16 surface-card rounded-2xl border border-dashed border-slate-800 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mx-auto text-indigo-400">
                    <SlidersHorizontal className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    暂无符合条件的监控规则
                  </div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    您可以点击右上角「新增监控规则」，为任意持仓或关注的股票设置止损价、止盈目标或均线指标！
                  </p>
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl inline-flex items-center space-x-1.5 transition-all shadow-md"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>立即新建规则</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredConditions.map((cond) => {
                    const isSelected = selectedConditionIds.includes(cond.id);
                    const diffPercent = (cond.target_value && cond.current_price && cond.current_price > 0)
                      ? ((cond.target_value - cond.current_price) / cond.current_price * 100)
                      : null;

                    return (
                      <div
                        key={cond.id}
                        onClick={() => {
                          // 点击卡片也可快速勾选/取消勾选
                          setSelectedConditionIds((prev) =>
                            prev.includes(cond.id) ? prev.filter((id) => id !== cond.id) : [...prev, cond.id]
                          );
                        }}
                        className={`p-3.5 rounded-xl border transition-all space-y-2.5 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-950/25 border-indigo-500/80 ring-1 ring-indigo-500/40 shadow-lg'
                            : !cond.is_active
                            ? 'bg-slate-950/40 border-slate-800/60 opacity-65 hover:border-slate-700'
                            : cond.is_triggered
                            ? 'bg-slate-900/60 border-amber-800/40 hover:border-amber-700'
                            : !cond.is_held
                            ? 'bg-amber-950/15 border-amber-800/50 hover:border-amber-700'
                            : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {/* Header Row */}
                        <div className="flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center space-x-2.5">
                            {/* Checkbox for batch select */}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedConditionIds((prev) =>
                                  prev.includes(cond.id) ? prev.filter((id) => id !== cond.id) : [...prev, cond.id]
                                );
                              }}
                              className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                            />

                            <span
                              onClick={() => onSelectStock?.(cond.symbol)}
                              className="font-bold text-sm text-white hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                            >
                              <span>{cond.name}</span>
                              <span className="text-xs font-mono font-normal text-slate-400">({cond.symbol})</span>
                            </span>

                            {/* Position Status Tag */}
                            {cond.is_held ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 rounded">
                                持仓中
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded flex items-center gap-1">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                无持仓(已删遗留)
                              </span>
                            )}

                            {getConditionTypeBadge(cond)}

                            {cond.condition_label && (
                              <span className="text-xs text-slate-300 font-medium hidden sm:inline">
                                {cond.condition_label}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center space-x-2">
                            {/* Active Switch */}
                            <button
                              onClick={() => handleToggleCondition(cond.id, cond.is_active)}
                              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all flex items-center space-x-1 ${
                                cond.is_active
                                  ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900'
                                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                              }`}
                              title={cond.is_active ? '点击暂停此监控规则' : '点击激活启动此规则'}
                            >
                              {cond.is_active ? (
                                <>
                                  <Play className="w-3 h-3 fill-emerald-400 text-emerald-400" />
                                  <span>监控中</span>
                                </>
                              ) : (
                                <>
                                  <Pause className="w-3 h-3 text-slate-400" />
                                  <span>已暂停</span>
                                </>
                              )}
                            </button>

                            {/* Edit Button */}
                            <button
                              onClick={() => handleOpenEdit(cond)}
                              className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors"
                              title="编辑此规则"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete Button */}
                            <button
                              onClick={() => handleDeleteCondition(cond.id)}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                              title="删除此规则"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Details Row */}
                        <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
                              {cond.target_value !== undefined && cond.target_value !== null && (
                                <div>
                                  <span className="text-slate-400">目标价格: </span>
                                  <span className="font-mono font-bold text-white">¥{cond.target_value.toFixed(2)}</span>
                                </div>
                              )}
                              {cond.ma_period && (
                                <div>
                                  <span className="text-slate-400">均线周期: </span>
                                  <span className="font-mono font-bold text-indigo-300">MA{cond.ma_period}</span>
                                </div>
                              )}
                              {cond.trail_percent && (
                                <div>
                                  <span className="text-slate-400">回撤阈值: </span>
                                  <span className="font-mono font-bold text-purple-300">{cond.trail_percent}%</span>
                                </div>
                              )}
                              {cond.current_price !== undefined && cond.current_price > 0 && (
                                <div>
                                  <span className="text-slate-400">最新市价: </span>
                                  <span className="font-mono text-slate-200">¥{cond.current_price.toFixed(2)}</span>
                                </div>
                              )}
                              {diffPercent !== null && (
                                <div>
                                  <span className="text-slate-400">偏离度: </span>
                                  <span className={`font-mono font-bold ${
                                    diffPercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                                  }`}>
                                    {diffPercent >= 0 ? '+' : ''}{diffPercent.toFixed(2)}%
                                  </span>
                                </div>
                              )}
                            </div>

                            {cond.strategy_note && (
                              <div className="text-[11px] text-slate-400 pt-0.5">
                                💡 备注: {cond.strategy_note}
                              </div>
                            )}

                            {cond.is_triggered && (
                              <div className="text-[11px] text-amber-400 pt-0.5 flex items-center gap-1 font-mono">
                                <AlertTriangle className="w-3 h-3" />
                                <span>已于 {cond.triggered_at} 触发: {cond.trigger_reason}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center space-x-3 shrink-0 text-[11px] text-slate-400 sm:border-l sm:border-slate-800 sm:pl-3">
                            <div className="flex items-center space-x-1">
                              <MessageSquare className={`w-3 h-3 ${cond.notify_wechat ? 'text-emerald-400' : 'text-slate-500'}`} />
                              <span>{cond.notify_wechat ? '微信推送' : '无推送'}</span>
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">{cond.created_at?.split(' ')[0]}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: HISTORY BODY */}
        {activeMainTab === 'history' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Toolbar: Filter Tabs & Search Bar */}
            <div className="px-5 py-2.5 border-b border-slate-800/60 bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setAlertFilter('ALL')}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                    alertFilter === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  全部 ({alerts.length})
                </button>
                <button
                  onClick={() => setAlertFilter('UNREAD')}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                    alertFilter === 'UNREAD' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <span>未读</span>
                  {unreadCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                </button>
                <button
                  onClick={() => setAlertFilter('STOP_LOSS')}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                    alertFilter === 'STOP_LOSS' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  止损风控
                </button>
                <button
                  onClick={() => setAlertFilter('TAKE_PROFIT')}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                    alertFilter === 'TAKE_PROFIT' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  止盈达成
                </button>
                <button
                  onClick={() => setAlertFilter('INDICATOR')}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                    alertFilter === 'INDICATOR' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  均线/MACD
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={alertSearchQuery}
                    onChange={(e) => setAlertSearchQuery(e.target.value)}
                    placeholder="搜索代码、名称或原因..."
                    className="w-44 sm:w-52 bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
                    title="全部标记为已读"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="hidden sm:inline">全已读</span>
                  </button>
                )}

                <button
                  onClick={handleClearReadAlerts}
                  className="p-1.5 text-slate-400 hover:text-red-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all"
                  title="清空已读记录"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* BATCH ACTION BAR FOR ALERTS (通知记录多选批量操作栏) */}
            <div className="px-5 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-3">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAllAlertsSelected}
                    onChange={handleToggleSelectAllAlerts}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="font-medium">
                    {isAllAlertsSelected ? '取消全选' : '全选当前通知'} ({filteredAlerts.length})
                  </span>
                </label>

                {selectedAlertIds.length > 0 && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    已勾选 <span className="text-indigo-400 font-bold">{selectedAlertIds.length}</span> 条
                  </span>
                )}
              </div>

              {selectedAlertIds.length > 0 && (
                <div className="flex items-center space-x-2 animate-in fade-in duration-150">
                  <button
                    onClick={handleBatchMarkAlertsRead}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>标为已读</span>
                  </button>

                  <button
                    onClick={handleBatchDeleteAlerts}
                    disabled={isBatchDeletingAlerts}
                    className="px-3 py-1.5 bg-red-950 hover:bg-red-900 border border-red-700/70 text-red-200 font-semibold rounded-xl flex items-center space-x-1.5 shadow-md shadow-red-950/40 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <span>批量删除 ({selectedAlertIds.length})</span>
                  </button>

                  <button
                    onClick={() => setSelectedAlertIds([])}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors text-[11px]"
                  >
                    取消选择
                  </button>
                </div>
              )}
            </div>

            {/* Alerts List */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
              {isLoadingAlerts ? (
                <div className="text-center py-16 text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>正在加载风控预警记录...</span>
                </div>
              ) : filteredAlerts.length === 0 ? (
                <div className="text-center py-16 surface-card rounded-2xl border border-dashed border-slate-800 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center mx-auto text-emerald-400">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-semibold text-slate-200">
                    暂无符合条件的预警记录
                  </div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    系统在交易时间按设定的止损止盈及技术规则监控各标的，一旦触发将自动记录并推送微信！
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredAlerts.map((alert) => {
                    const isSelected = selectedAlertIds.includes(alert.id);
                    const isStopLoss = alert.alert_type === 'STOP_LOSS' || alert.title.includes('止损') || alert.title.includes('破位');
                    const isTakeProfit = alert.alert_type === 'TAKE_PROFIT' || alert.title.includes('止盈') || alert.title.includes('突破');

                    return (
                      <div
                        key={alert.id}
                        onClick={() => {
                          setSelectedAlertIds((prev) =>
                            prev.includes(alert.id) ? prev.filter((id) => id !== alert.id) : [...prev, alert.id]
                          );
                        }}
                        className={`p-3.5 rounded-xl border transition-all space-y-2.5 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-950/25 border-indigo-500/80 ring-1 ring-indigo-500/40 shadow-lg'
                            : !alert.is_read
                            ? isStopLoss
                              ? 'bg-red-950/20 border-red-700/60 shadow-md'
                              : isTakeProfit
                              ? 'bg-emerald-950/20 border-emerald-700/60 shadow-md'
                              : 'bg-indigo-950/20 border-indigo-700/60 shadow-md'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {/* Header Row */}
                        <div className="flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center space-x-2.5">
                            {/* Checkbox for batch select */}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedAlertIds((prev) =>
                                  prev.includes(alert.id) ? prev.filter((id) => id !== alert.id) : [...prev, alert.id]
                                );
                              }}
                              className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                            />

                            {!alert.is_read && (
                              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" title="未读提醒" />
                            )}
                            <span 
                              onClick={() => onSelectStock?.(alert.symbol)}
                              className="font-bold text-sm text-white hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                            >
                              <span>{alert.name}</span>
                              <span className="text-xs font-mono font-normal text-slate-400">({alert.symbol})</span>
                            </span>
                            {getAlertBadge(alert)}
                            <span className="text-xs font-bold text-slate-200">{alert.title}</span>
                          </div>

                          <div className="flex items-center space-x-3 text-xs text-slate-400">
                            <span className="font-mono">{alert.created_at}</span>
                          </div>
                        </div>

                        {/* Price and Reason Row */}
                        <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-1 flex-1">
                            <div className="text-slate-300 leading-relaxed font-sans">
                              {alert.message}
                            </div>
                            {alert.wechat_status && (
                              <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400 pt-0.5">
                                <MessageSquare className="w-3 h-3" />
                                <span>
                                  {alert.wechat_status === 'SENT' 
                                    ? '已同步发送微信通知' 
                                    : alert.wechat_status.startsWith('FAILED') 
                                    ? '微信推送未送达' 
                                    : '微信通知已配置'}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center space-x-4 shrink-0 sm:border-l sm:border-slate-800 sm:pl-3">
                            {alert.trigger_price !== undefined && (
                              <div>
                                <div className="text-[10px] text-slate-400">触发时市价</div>
                                <div className={`text-base font-mono font-bold ${
                                  isStopLoss ? 'text-red-400' : isTakeProfit ? 'text-emerald-400' : 'text-white'
                                }`}>
                                  ¥{alert.trigger_price.toFixed(2)}
                                </div>
                              </div>
                            )}

                            {alert.profit_ratio !== undefined && (
                              <div>
                                <div className="text-[10px] text-slate-400">持仓盈亏</div>
                                <div className={`text-sm font-mono font-bold ${
                                  alert.profit_ratio >= 0 ? 'text-red-400' : 'text-emerald-400'
                                }`}>
                                  {alert.profit_ratio >= 0 ? '+' : ''}{alert.profit_ratio.toFixed(2)}%
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="flex items-center justify-between pt-1 text-xs" onClick={(e) => e.stopPropagation()}>
                          <div className="text-[11px] text-slate-500">
                            标的代码: <span className="font-mono text-slate-400">{alert.symbol}</span>
                          </div>

                          <div className="flex items-center space-x-2">
                            {onSelectStock && (
                              <button
                                type="button"
                                onClick={() => onSelectStock(alert.symbol)}
                                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-300 rounded-lg transition-all flex items-center space-x-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>走势图</span>
                              </button>
                            )}

                            {/* View / Adjust rules */}
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMainTab('rules');
                                setRuleSearchQuery(alert.symbol);
                              }}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-purple-300 rounded-lg transition-all flex items-center space-x-1"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>查看规则</span>
                            </button>

                            {!alert.is_read ? (
                              <button
                                type="button"
                                onClick={() => handleMarkSingleRead(alert.id)}
                                className="px-2.5 py-1 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 font-semibold rounded-lg transition-all flex items-center space-x-1"
                              >
                                <Check className="w-3 h-3 text-indigo-400" />
                                <span>标为已读</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500 px-2 py-0.5">已读</span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteSingleAlert(alert.id)}
                              className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                              title="删除此预警记录"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 3. MODAL: 新增监控规则弹窗 (Add Condition Modal)             */}
      {/* ======================================================== */}
      {isAddModalOpen && (
        <div 
          className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div 
            className="surface-card rounded-2xl max-w-lg w-full border border-indigo-500/40 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800/40">
                  <Plus className="w-4 h-4" />
                </div>
                <h4 className="font-bold text-sm text-white">新增预警监控规则</h4>
              </div>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCondition} className="space-y-3.5 text-xs">
              {/* Symbol & Name Input */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">股票代码 *</label>
                  <input
                    type="text"
                    required
                    value={formSymbol}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setFormSymbol(val);
                      if (val.length >= 6) {
                        handleSearchStockInfo(val);
                      }
                    }}
                    onBlur={() => handleSearchStockInfo(formSymbol)}
                    placeholder="如 600519 或 000001"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">股票名称</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder={isSearchingStock ? '正在获取...' : '自动识别或手动输入'}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                    {formCurrentPrice && (
                      <span className="absolute right-2.5 top-2 text-[10px] text-indigo-400 font-mono">
                        现价: ¥{formCurrentPrice.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Condition Type */}
              <div>
                <label className="block text-slate-400 mb-1">监控规则类型</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    const t = e.target.value as ConditionType;
                    setFormType(t);
                    if (formCurrentPrice) {
                      if (t === 'STOP_LOSS') setFormTargetPrice((formCurrentPrice * 0.95).toFixed(2));
                      if (t === 'TARGET_PROFIT') setFormTargetPrice((formCurrentPrice * 1.10).toFixed(2));
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="STOP_LOSS">🛑 目标价止损 (现价跌破设定值时预警)</option>
                  <option value="TARGET_PROFIT">🎯 目标价止盈 (现价涨至设定值时预警)</option>
                  <option value="TRAILING_STOP">🛡️ 移动止盈 (自监控起最高点回撤达比例时止盈)</option>
                  <option value="MA_CROSS_BELOW">📉 跌破均线止损 (跌破 MA 均线生命线)</option>
                  <option value="MA_CROSS_ABOVE">📈 上穿均线突破 (突破 MA 均线阻力)</option>
                  <option value="MACD_DEATH_CROSS">⚡ MACD 高位死叉 (DIF 下穿 DEA 逃顶离场)</option>
                  <option value="MACD_GOLDEN_CROSS">🌟 MACD 低位金叉 (DIF 上穿 DEA 建仓信号)</option>
                </select>
              </div>

              {/* Target Price for STOP_LOSS / TARGET_PROFIT */}
              {(formType === 'STOP_LOSS' || formType === 'TARGET_PROFIT') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400">
                      {formType === 'STOP_LOSS' ? '止损触发价格 (元) *' : '止盈触发目标价 (元) *'}
                    </label>
                    {formCurrentPrice && (
                      <div className="flex items-center space-x-1">
                        {formType === 'STOP_LOSS' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 0.97).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              -3%
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 0.95).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              -5%
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 0.92).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              -8%
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 1.05).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              +5%
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 1.10).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              +10%
                            </button>
                            <button
                              type="button"
                              onClick={() => setFormTargetPrice((formCurrentPrice * 1.15).toFixed(2))}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              +15%
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formTargetPrice}
                    onChange={(e) => setFormTargetPrice(e.target.value)}
                    placeholder="输入触发价格"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {/* MA Period */}
              {(formType === 'MA_CROSS_BELOW' || formType === 'MA_CROSS_ABOVE') && (
                <div>
                  <label className="block text-slate-400 mb-1">均线周期</label>
                  <select
                    value={formMaPeriod}
                    onChange={(e) => setFormMaPeriod(parseInt(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value={5}>5日短期线 (MA5)</option>
                    <option value={10}>10日操盘线 (MA10)</option>
                    <option value={20}>20日生命线 (MA20 - 推荐)</option>
                    <option value={60}>60日决策线 (MA60 - 中线趋势)</option>
                  </select>
                </div>
              )}

              {/* Trailing Stop Percent */}
              {formType === 'TRAILING_STOP' && (
                <div>
                  <label className="block text-slate-400 mb-1">回撤止盈比例 (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formTrailPercent}
                    onChange={(e) => setFormTrailPercent(e.target.value)}
                    placeholder="如 5.0 (从最高价回撤 5% 触发)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {/* Note / Label */}
              <div>
                <label className="block text-slate-400 mb-1">策略备注 / 触发说明</label>
                <input
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="如：破20日线无条件止损 / 第一阻力位逢高减半"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Notifications Checkbox */}
              <div className="flex items-center space-x-4 pt-1">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formNotifyWechat}
                    onChange={(e) => setFormNotifyWechat(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>同步发送微信通知</span>
                </label>
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formNotifyPopup}
                    onChange={(e) => setFormNotifyPopup(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>页面全局弹窗提醒</span>
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSavingCondition}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5"
                >
                  {isSavingCondition ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在保存...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>确认创建</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. MODAL: 编辑监控规则弹窗 (Edit Condition Modal)            */}
      {/* ======================================================== */}
      {editingCondition && (
        <div 
          className="fixed inset-0 z-60 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-md"
          onClick={() => setEditingCondition(null)}
        >
          <div 
            className="surface-card rounded-2xl max-w-md w-full border border-indigo-500/40 shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800/40">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">修改监控条件规则</h4>
                  <span className="text-[11px] text-slate-400">{editingCondition.name} ({editingCondition.symbol})</span>
                </div>
              </div>
              <button 
                onClick={() => setEditingCondition(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {(editingCondition.condition_type === 'STOP_LOSS' || editingCondition.condition_type === 'TARGET_PROFIT') && (
                <div>
                  <label className="block text-slate-400 mb-1">触发目标价格 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editTargetPrice}
                    onChange={(e) => setEditTargetPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">规则显示标签</label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="规则标题"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">策略心得 / 操作提示</label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="操作指南说明"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editNotifyWechat}
                    onChange={(e) => setEditNotifyWechat(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>触发时同步发送微信通知</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setEditingCondition(null)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center space-x-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>保存修改</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
