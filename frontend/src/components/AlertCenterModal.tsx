import React, { useState, useEffect } from 'react';
import { 
  X, Bell, ShieldAlert, Target, TrendingDown, TrendingUp, Zap, Compass, 
  Check, CheckCheck, Trash2, RefreshCw, ExternalLink, SlidersHorizontal, 
  MessageSquare, Search, Filter, AlertTriangle, ShieldCheck
} from 'lucide-react';
import axios from 'axios';
import { AlertNotificationItem } from '../types';

interface AlertCenterModalProps {
  onClose: () => void;
  onSelectStock?: (symbol: string) => void;
  onOpenConditions?: (symbol: string) => void;
  onAlertsChanged?: () => void;
}

export const AlertCenterModal: React.FC<AlertCenterModalProps> = ({
  onClose,
  onSelectStock,
  onOpenConditions,
  onAlertsChanged
}) => {
  const [alerts, setAlerts] = useState<AlertNotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'ALL' | 'UNREAD' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'INDICATOR'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get('/api/v1/stocks/alerts?limit=100');
      setAlerts(res.data || []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setIsLoading(false);
    }
  };

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
      await axios.post('/api/v1/stocks/alerts/mark-read', {
        alert_ids: [id]
      });
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
      onAlertsChanged?.();
    } catch (err) {
      alert('删除记录失败');
    }
  };

  const handleClearReadAlerts = async () => {
    if (!confirm('确定清空所有已读的预警记录吗？未读记录将继续保留。')) return;
    try {
      await axios.delete('/api/v1/stocks/alerts?only_read=true');
      fetchAlerts();
      onAlertsChanged?.();
    } catch (err) {
      alert('清空记录失败');
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchText = (a.symbol + a.name + a.title + a.message).toLowerCase();
      if (!matchText.includes(q)) return false;
    }

    // 2. Filter Type
    if (filterType === 'UNREAD') return !a.is_read;
    if (filterType === 'STOP_LOSS') return a.alert_type === 'STOP_LOSS' || a.title.includes('止损') || a.title.includes('破位');
    if (filterType === 'TAKE_PROFIT') return a.alert_type === 'TAKE_PROFIT' || a.title.includes('止盈') || a.title.includes('突破') || a.alert_type === 'TRAILING';
    if (filterType === 'INDICATOR') return a.alert_type === 'MA' || a.alert_type === 'MACD';

    return true;
  });

  const unreadCount = alerts.filter((a) => !a.is_read).length;

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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="surface-card rounded-2xl max-w-3xl w-full border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-950 text-indigo-400 border border-indigo-700/40">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="font-bold text-base text-white">风控与止损止盈预警中心</h3>
                {unreadCount > 0 ? (
                  <span className="px-2 py-0.5 text-xs font-mono font-bold bg-red-950 text-red-300 border border-red-800/60 rounded-full animate-pulse">
                    {unreadCount} 条未读
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-slate-800 text-slate-400 rounded-full">
                    全部已读
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                集中汇总所有持仓股触发的止损、止盈、均线破位与指标提醒记录
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchAlerts}
              disabled={isLoading}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="刷新记录"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar: Filter Tabs & Search Bar */}
        <div className="px-5 py-3 border-b border-slate-800/60 bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                filterType === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              全部 ({alerts.length})
            </button>
            <button
              onClick={() => setFilterType('UNREAD')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                filterType === 'UNREAD'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>未读</span>
              {unreadCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              )}
            </button>
            <button
              onClick={() => setFilterType('STOP_LOSS')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                filterType === 'STOP_LOSS'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              止损风控
            </button>
            <button
              onClick={() => setFilterType('TAKE_PROFIT')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                filterType === 'TAKE_PROFIT'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              止盈达成
            </button>
            <button
              onClick={() => setFilterType('INDICATOR')}
              className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                filterType === 'INDICATOR'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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

        {/* Alerts List Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {isLoading ? (
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
                您的持仓各标的均在正常运行区间内，一旦达到预设的止损、止盈或均线指标，系统将在此处自动记录并微信通知！
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredAlerts.map((alert) => {
                const isStopLoss = alert.alert_type === 'STOP_LOSS' || alert.title.includes('止损') || alert.title.includes('破位');
                const isTakeProfit = alert.alert_type === 'TAKE_PROFIT' || alert.title.includes('止盈') || alert.title.includes('突破');

                return (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                      !alert.is_read
                        ? isStopLoss
                          ? 'bg-red-950/20 border-red-700/60 shadow-md'
                          : isTakeProfit
                          ? 'bg-emerald-950/20 border-emerald-700/60 shadow-md'
                          : 'bg-indigo-950/20 border-indigo-700/60 shadow-md'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2.5">
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
                    <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
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

                      <div className="flex items-center space-x-4 shrink-0 sm:border-l sm:border-slate-800 sm:pl-4">
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
                    <div className="flex items-center justify-between pt-1 text-xs">
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

                        {onOpenConditions && (
                          <button
                            type="button"
                            onClick={() => onOpenConditions(alert.symbol)}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-purple-300 rounded-lg transition-all flex items-center space-x-1"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            <span>调整条件</span>
                          </button>
                        )}

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
    </div>
  );
};
