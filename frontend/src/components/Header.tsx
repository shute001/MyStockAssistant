import React from 'react';
import { TrendingUp, Cpu, Settings, RefreshCw, BarChart2, Brain } from 'lucide-react';
import { LLMConfigItem } from '../types';

interface HeaderProps {
  activeTab: 'dashboard' | 'portfolio' | 'ai' | 'trade_review';
  setActiveTab: (tab: 'dashboard' | 'portfolio' | 'ai' | 'trade_review') => void;
  activeLLM?: LLMConfigItem;
  onOpenSettings: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  activeLLM,
  onOpenSettings,
  onRefreshData,
  isRefreshing
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-3.5 flex items-center justify-between">
      {/* Brand & Logo */}
      <div className="flex items-center space-x-3">
        <div className="bg-gradient-to-tr from-indigo-600 to-violet-500 p-2 rounded-xl text-white shadow-lg shadow-indigo-500/20">
          <TrendingUp className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-slate-100 leading-tight">A股股票分析助手</h1>
          <p className="text-xs text-slate-400">AI Powered Stock Portfolio Copilot</p>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <nav className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'dashboard'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          <span>资产概览</span>
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'portfolio'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>持仓与自选</span>
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'ai'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>AI 智算诊断</span>
        </button>
        <button
          onClick={() => setActiveTab('trade_review')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'trade_review'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Brain className="w-4 h-4 text-purple-300" />
          <span>交易复盘 Agent</span>
        </button>
      </nav>


      {/* LLM Status Badge & Actions */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onRefreshData}
          disabled={isRefreshing}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          title="刷新最新数据"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
        </button>

        {/* Model Badge */}
        <div
          onClick={onOpenSettings}
          className="cursor-pointer flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
          <span className="text-xs font-semibold text-indigo-300 uppercase">
            {activeLLM?.provider_name || 'DeepSeek'} ({activeLLM?.selected_model || 'chat'})
          </span>
        </div>

        <button
          onClick={onOpenSettings}
          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
        >
          <Settings className="w-4 h-4" />
          <span>设置 API</span>
        </button>
      </div>
    </header>
  );
};
