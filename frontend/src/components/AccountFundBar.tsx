import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { DollarSign, Edit3, ShieldAlert, PieChart, RefreshCw, Wallet, X } from 'lucide-react';

export interface AccountFundData {
  cash_balance: number;
  withdrawable_cash: number;
  holding_pnl: number;
  frozen_amount: number;
  market_value: number;
  daily_pnl: number;
  available_cash: number;
  total_assets: number;
  daily_pnl_pct: string;
  position_ratio: string;
  position_ratio_num: number;
  updated_at?: string;
}

interface AccountFundBarProps {
  onRefreshParent?: () => void;
}

export const AccountFundBar: React.FC<AccountFundBarProps> = ({ onRefreshParent }) => {
  const [funds, setFunds] = useState<AccountFundData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  // Edit Form States
  const [editTotalAssets, setEditTotalAssets] = useState<string>('');
  const [editAvailableCash, setEditAvailableCash] = useState<string>('');
  const [editCashBalance, setEditCashBalance] = useState<string>('');
  const [editWithdrawableCash, setEditWithdrawableCash] = useState<string>('');
  const [editFrozenAmount, setEditFrozenAmount] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const fetchFunds = async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const res = await axios.get('/api/v1/account/funds');
      setFunds(res.data);
    } catch (err) {
      console.error('Failed to fetch account funds:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFunds();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEditModalOpen) {
        setIsEditModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditModalOpen]);

  const handleOpenEditModal = () => {
    if (funds) {
      setEditTotalAssets(String(funds.total_assets || ''));
      setEditAvailableCash(String(funds.available_cash || ''));
      setEditCashBalance(String(funds.cash_balance || ''));
      setEditWithdrawableCash(String(funds.withdrawable_cash || ''));
      setEditFrozenAmount(String(funds.frozen_amount || ''));
    }
    setIsEditModalOpen(true);
  };

  const handleSaveFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await axios.post('/api/v1/account/funds', {
        total_assets: parseFloat(editTotalAssets) || 0,
        available_cash: parseFloat(editAvailableCash) || 0,
        cash_balance: parseFloat(editCashBalance) || 0,
        withdrawable_cash: parseFloat(editWithdrawableCash) || 0,
        frozen_amount: parseFloat(editFrozenAmount) || 0
      });
      if (res.data.funds) {
        setFunds(res.data.funds);
      }
      setIsEditModalOpen(false);
      onRefreshParent?.();
    } catch (err) {
      alert('保存账户资金配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !funds) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md mb-6 animate-pulse">
        <div className="flex items-center space-x-2.5 border-b border-slate-800/80 pb-3 mb-4">
          <div className="w-8 h-8 bg-slate-800 rounded-xl" />
          <div className="space-y-1.5">
            <div className="h-3 w-40 bg-slate-800 rounded" />
            <div className="h-2.5 w-56 bg-slate-800/60 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3 space-y-3">
              <div className="h-2.5 w-16 bg-slate-800 rounded" />
              <div className="h-3 w-24 bg-slate-700 rounded" />
              <div className="h-2.5 w-16 bg-slate-800 rounded" />
              <div className="h-3 w-20 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (fetchError && !funds) {
    return (
      <div className="bg-slate-900/90 border border-red-900/50 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md mb-6 flex items-center justify-between">
        <span className="text-xs text-red-300">账户资金数据加载失败，请检查后端服务。</span>
        <button
          onClick={fetchFunds}
          className="px-3 py-1.5 bg-red-950 hover:bg-red-900 border border-red-800/60 text-red-300 rounded-xl text-xs font-semibold transition-all"
        >
          重试
        </button>
      </div>
    );
  }

  if (!funds) return null;

  const formatMoney = (num: number) => {
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md mb-6 relative overflow-hidden">
      {/* Background Decorative Accent */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />

      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-indigo-950/80 border border-indigo-700/50 rounded-xl text-indigo-400">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>同花顺账户资金概览</span>
              <span className="text-[10px] font-normal px-2 py-0.5 bg-indigo-950/90 text-indigo-300 border border-indigo-700/40 rounded-full font-mono">
                仓位: {funds.position_ratio}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 font-sans">
              真实资金全貌与可用流动性 (已联动 AI Agent 进行动态仓位分析)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchFunds}
            disabled={loading}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-all"
            title="刷新账户资金"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleOpenEditModal}
            className="px-3 py-1.5 bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>编辑资金</span>
          </button>
        </div>
      </div>

      {/* Flush 9-Cell Grid Layout */}
      <div className="grid grid-cols-3 gap-3 text-xs sm:text-sm font-mono">
        {/* Column 1 */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5 sm:p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-sans">资金余额</span>
            <span className="font-bold text-rose-400">¥{formatMoney(funds.cash_balance)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">冻结金额</span>
            <span className="font-semibold text-rose-400">¥{formatMoney(funds.frozen_amount)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">可用金额</span>
            <span className="font-bold text-rose-400">¥{formatMoney(funds.available_cash)}</span>
          </div>
        </div>

        {/* Column 2 */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5 sm:p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-sans">可取金额</span>
            <span className="font-bold text-rose-400">¥{formatMoney(funds.withdrawable_cash)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">股票市值</span>
            <span className="font-bold text-rose-400">¥{formatMoney(funds.market_value)}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">总 资 产</span>
            <span className="font-extrabold text-rose-400 text-sm sm:text-base">¥{formatMoney(funds.total_assets)}</span>
          </div>
        </div>

        {/* Column 3 */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5 sm:p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-sans">持仓盈亏</span>
            <span className={`font-bold ${funds.holding_pnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {funds.holding_pnl >= 0 ? '+' : ''}{formatMoney(funds.holding_pnl)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">当日盈亏</span>
            <span className={`font-semibold ${funds.daily_pnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {funds.daily_pnl >= 0 ? '+' : ''}{formatMoney(funds.daily_pnl)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-900">
            <span className="text-slate-400 font-sans">当日盈亏比</span>
            <span className={`font-bold ${funds.daily_pnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {funds.daily_pnl_pct}
            </span>
          </div>
        </div>
      </div>

      {/* Edit Modal rendered to body via Portal */}
      {isEditModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsEditModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-700/60 my-auto max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-indigo-400" />
                <span>编辑同花顺账户资金配置</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFunds} className="space-y-3 font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">总资产 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="195305.74"
                    value={editTotalAssets}
                    onChange={(e) => setEditTotalAssets(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">可用金额 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="67316.68"
                    value={editAvailableCash}
                    onChange={(e) => setEditAvailableCash(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">资金余额 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="314.13"
                    value={editCashBalance}
                    onChange={(e) => setEditCashBalance(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">可取金额 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="314.13"
                    value={editWithdrawableCash}
                    onChange={(e) => setEditWithdrawableCash(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">冻结金额 (元)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="-67002.55"
                  value={editFrozenAmount}
                  onChange={(e) => setEditFrozenAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="p-3 bg-indigo-950/40 border border-indigo-800/40 rounded-xl text-[11px] text-indigo-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-indigo-200">
                  <PieChart className="w-3.5 h-3.5 text-indigo-400" />
                  <span>自动化联动说明：</span>
                </div>
                <p>
                  股票市值 (¥{formatMoney(funds.market_value)}) 与持仓盈亏 (¥{formatMoney(funds.holding_pnl)}) 会根据您在“我的持仓”列表中的股票自动抓取最新行情实时精准计算。
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md transition-colors"
                >
                  {saving ? '保存中...' : '保存资金配置'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
