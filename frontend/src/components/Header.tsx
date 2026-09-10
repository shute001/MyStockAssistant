import React, { useState, useRef, useEffect } from 'react';
import { TrendingUp, Cpu, Settings, RefreshCw, BarChart2, Brain, Search, Palette, Check } from 'lucide-react';
import { LLMConfigItem, ThemeId, ThemeOption } from '../types';

interface HeaderProps {
  activeTab: 'dashboard' | 'portfolio' | 'ai' | 'trade_review';
  setActiveTab: (tab: 'dashboard' | 'portfolio' | 'ai' | 'trade_review') => void;
  activeLLM?: LLMConfigItem;
  onOpenSettings: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
  onOpenSearch?: () => void;
  currentTheme?: ThemeId;
  onThemeChange?: (theme: ThemeId) => void;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'indigo',
    name: '星空靛蓝',
    color: '#6366F1',
    accentClass: 'bg-indigo-500 shadow-indigo-500/40',
    badgeClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-700/40',
    desc: '经典科技金融 (默认)'
  },
  {
    id: 'gold',
    name: '黑金华尔街',
    color: '#EAB308',
    accentClass: 'bg-amber-500 shadow-amber-500/40',
    badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-700/40',
    desc: '沉稳黑金奢华终端'
  },
  {
    id: 'emerald',
    name: '极客翡翠',
    color: '#10B981',
    accentClass: 'bg-emerald-500 shadow-emerald-500/40',
    badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/40',
    desc: '量化交易与赛博绿'
  },
  {
    id: 'cyan',
    name: '深海蔚蓝',
    color: '#06B6D4',
    accentClass: 'bg-cyan-500 shadow-cyan-500/40',
    badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-700/40',
    desc: '极速冷光科技青'
  },
  {
    id: 'rose',
    name: '暗夜霓虹',
    color: '#F43F5E',
    accentClass: 'bg-rose-500 shadow-rose-500/40',
    badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-700/40',
    desc: '赤红激进操盘先锋'
  },
  {
    id: 'apple-silver',
    name: '🍎 苹果冰川纯白',
    color: '#0071E3',
    accentClass: 'bg-sky-500 shadow-sky-500/40',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: 'macOS 视网膜通透银白'
  },
  {
    id: 'apple-warm',
    name: '🌤️ 苹果温润暖白',
    color: '#EA580C',
    accentClass: 'bg-orange-500 shadow-orange-500/40',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    desc: '加州纸感暖阳护眼白'
  }
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  activeLLM,
  onOpenSettings,
  onRefreshData,
  isRefreshing,
  onOpenSearch,
  currentTheme = 'indigo',
  onThemeChange
}) => {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  // Close theme menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeOpen(false);
      }
    };
    if (isThemeOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isThemeOpen]);

  const activeThemeObj = THEME_OPTIONS.find((t) => t.id === currentTheme) || THEME_OPTIONS[0];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 p-2 rounded-xl text-white shadow-lg shadow-indigo-500/20 ring-1 ring-white/15">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-slate-100 leading-tight">A股智能股票助理</h1>
              <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/40">
                PRO
              </span>
            </div>
            <p className="text-[11px] text-slate-400">AI-Powered Portfolio Copilot</p>
          </div>
        </div>

        {/* Main Navigation Tabs */}
        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/80 p-1 sm:order-none sm:w-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex shrink-0 items-center space-x-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>全盘驾驶舱</span>
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`flex shrink-0 items-center space-x-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'portfolio'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>持仓与自选</span>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex shrink-0 items-center space-x-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'ai'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>AI 智算诊断</span>
          </button>
          <button
            onClick={() => setActiveTab('trade_review')}
            className={`flex shrink-0 items-center space-x-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'trade_review'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Brain className="w-4 h-4 text-purple-200" />
            <span>交易复盘 Agent</span>
          </button>
        </nav>

        {/* Global Search & Actions */}
        <div className="flex items-center space-x-2 sm:space-x-2.5">
          {/* Quick Search Button */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs transition-all shadow-sm group"
              title="按 Ctrl + K 快速搜索股票"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-400 transition-colors" />
              <span className="hidden md:inline">快速搜索股票...</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] bg-slate-950 text-slate-400 border border-slate-800 rounded font-mono">
                Ctrl K
              </kbd>
            </button>
          )}

          {/* Theme Color Selector Menu */}
          <div className="relative" ref={themeMenuRef}>
            <button
              onClick={() => setIsThemeOpen(!isThemeOpen)}
              className="p-2 text-slate-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
              title={`当前主题：${activeThemeObj.name} (点击切换)`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: activeThemeObj.color }}
              />
              <Palette className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Theme Dropdown Popover */}
            {isThemeOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl p-2 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2.5 py-1.5 border-b border-slate-800/80 mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">切换主题配色</span>
                  <span className="text-[10px] text-slate-400 font-mono">7 款预设</span>
                </div>

                <div className="space-y-1">
                  {THEME_OPTIONS.map((t) => {
                    const isSelected = t.id === currentTheme;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          onThemeChange?.(t.id);
                          setIsThemeOpen(false);
                        }}
                        className={`w-full px-2.5 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-slate-800/90 text-white font-semibold border border-slate-700/80'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5">
                          <div
                            className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <div>
                            <div className="text-slate-200">{t.name}</div>
                            <div className="text-[10px] text-slate-500 font-normal">{t.desc}</div>
                          </div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Refresh Data */}
          <button
            onClick={onRefreshData}
            disabled={isRefreshing}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-xl transition-all"
            title="刷新行情与账户最新数据"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* Model Status Badge */}
          <div
            onClick={onOpenSettings}
            className="cursor-pointer hidden lg:flex items-center space-x-2 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-all text-xs"
            title="点击切换或配置 AI 大模型"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-indigo-300 font-mono text-[11px] uppercase">
              {activeLLM?.provider_name || 'DeepSeek'}
            </span>
          </div>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 rounded-xl transition-all shadow-sm"
            title="配置 AI 模型与微信推送"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">系统设置</span>
          </button>
        </div>
      </div>
    </header>
  );
};
