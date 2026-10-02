import React, { useEffect, useRef } from 'react';
import { 
  AlertTriangle, ShieldAlert, Target, TrendingDown, TrendingUp, Zap, 
  Compass, CheckCircle2, MessageSquare, ExternalLink, X, ChevronRight, ChevronLeft, Volume2, Bell
} from 'lucide-react';
import { AlertNotificationItem } from '../types';

interface GlobalAlertModalProps {
  alerts: AlertNotificationItem[];
  onClose: () => void;
  onMarkRead: (alertIds?: number[]) => void;
  onSelectStock?: (symbol: string) => void;
  onOpenAlertCenter?: () => void;
}

export const GlobalAlertModal: React.FC<GlobalAlertModalProps> = ({
  alerts,
  onClose,
  onMarkRead,
  onSelectStock,
  onOpenAlertCenter
}) => {
  const [currentIndex, setCurrentIndex] = React.useState<number>(0);
  const audioPlayedRef = useRef<boolean>(false);

  // Play a soft synthetic audio chime when alert pops up
  useEffect(() => {
    if (alerts.length > 0 && !audioPlayedRef.current) {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch (e) {
        // audio context might be blocked if no user gesture yet
      }
      audioPlayedRef.current = true;
    }
  }, [alerts.length]);

  if (!alerts || alerts.length === 0) return null;

  const currentAlert = alerts[currentIndex] || alerts[0];
  const isStopLoss = currentAlert.alert_type === 'STOP_LOSS' || currentAlert.title.includes('止损') || currentAlert.title.includes('破位');
  const isTakeProfit = currentAlert.alert_type === 'TAKE_PROFIT' || currentAlert.title.includes('止盈') || currentAlert.title.includes('突破');

  const handleMarkCurrentRead = () => {
    onMarkRead([currentAlert.id]);
    if (currentIndex >= alerts.length - 1) {
      if (alerts.length <= 1) {
        onClose();
      } else {
        setCurrentIndex(0);
      }
    }
  };

  const handleMarkAllRead = () => {
    onMarkRead();
    onClose();
  };

  const getAlertIcon = () => {
    if (isStopLoss) return <ShieldAlert className="w-6 h-6 text-red-400" />;
    if (isTakeProfit) return <Target className="w-6 h-6 text-emerald-400" />;
    return <AlertTriangle className="w-6 h-6 text-amber-400" />;
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-lg animate-in fade-in zoom-in-95 duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className={`surface-card rounded-2xl max-w-lg w-full border shadow-2xl overflow-hidden flex flex-col transition-all relative ${
          isStopLoss 
            ? 'border-red-500/60 shadow-red-950/40 bg-gradient-to-b from-red-950/30 via-slate-900 to-slate-950' 
            : isTakeProfit 
            ? 'border-emerald-500/60 shadow-emerald-950/40 bg-gradient-to-b from-emerald-950/30 via-slate-900 to-slate-950' 
            : 'border-indigo-500/60 shadow-indigo-950/40 bg-gradient-to-b from-indigo-950/30 via-slate-900 to-slate-950'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl border animate-pulse ${
              isStopLoss ? 'bg-red-950 text-red-400 border-red-800/60' : 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
            }`}>
              {getAlertIcon()}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">
                  {isStopLoss ? '🚨 止损纪律触碰预警' : isTakeProfit ? '🎉 目标止盈达成预警' : '⚠️ 技术指标预警'}
                </h3>
                {alerts.length > 1 && (
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-800 text-slate-300 rounded-full">
                    {currentIndex + 1} / {alerts.length}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                实时行情检测引擎已触发您预设的风控条件单
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

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Target Stock Card */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white">{currentAlert.name}</span>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 bg-slate-800 text-indigo-300 rounded">
                  {currentAlert.symbol}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center space-x-3 pt-1">
                {currentAlert.cost_price && (
                  <span>成本: <strong className="text-slate-200 font-mono">¥{currentAlert.cost_price.toFixed(2)}</strong></span>
                )}
                {currentAlert.profit_ratio !== undefined && (
                  <span>盈亏: <strong className={`font-mono font-bold ${currentAlert.profit_ratio >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {currentAlert.profit_ratio >= 0 ? '+' : ''}{currentAlert.profit_ratio.toFixed(2)}%
                  </strong></span>
                )}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400">当前市价</div>
              <div className={`text-xl font-mono font-black ${
                isStopLoss ? 'text-red-400' : isTakeProfit ? 'text-emerald-400' : 'text-white'
              }`}>
                ¥{currentAlert.trigger_price?.toFixed(2) || '--'}
              </div>
            </div>
          </div>

          {/* Trigger Detail Box */}
          <div className={`p-4 rounded-xl border space-y-2 ${
            isStopLoss 
              ? 'bg-red-950/30 border-red-800/50' 
              : isTakeProfit 
              ? 'bg-emerald-950/30 border-emerald-800/50' 
              : 'bg-slate-900 border-slate-800'
          }`}>
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-200">{currentAlert.title}</span>
              <span className="text-[11px] text-slate-400 font-mono">{currentAlert.created_at?.slice(11, 19)}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {currentAlert.message}
            </p>

            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center space-x-1.5 text-emerald-400">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>已同步发送至绑定微信推送</span>
              </div>
              <span className="text-slate-500">建议结合盘面及时做出决策</span>
            </div>
          </div>
        </div>

        {/* Footer Navigation & Actions */}
        <div className="px-5 py-3.5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-2">
          {alerts.length > 1 ? (
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : alerts.length - 1))}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-slate-300"
                title="上一条"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentIndex((prev) => (prev < alerts.length - 1 ? prev + 1 : 0))}
                className="p-1.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-slate-300"
                title="下一条"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center space-x-2">
            {onOpenAlertCenter && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAlertCenter();
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
                title="打开预警中心统一查看所有历史提醒"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>预警中心</span>
              </button>
            )}

            {onSelectStock && (
              <button
                type="button"
                onClick={() => {
                  onSelectStock(currentAlert.symbol);
                  onClose();
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-indigo-300 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>查看走势</span>
              </button>
            )}

            <button
              onClick={handleMarkCurrentRead}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all flex items-center space-x-1 shadow-md"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>已知晓</span>
            </button>

            {alerts.length > 1 && (
              <button
                onClick={handleMarkAllRead}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
              >
                全部已知晓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
