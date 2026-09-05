import React, { useState, useEffect, Suspense } from 'react';
import axios from 'axios';
import { Header } from './components/Header';
import { PositionItem, WatchlistItem, LLMConfigItem } from './types';

const Dashboard = React.lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
const PortfolioManager = React.lazy(() => import('./components/PortfolioManager').then((module) => ({ default: module.PortfolioManager })));
const AIAnalysisReport = React.lazy(() => import('./components/AIAnalysisReport').then((module) => ({ default: module.AIAnalysisReport })));
const TradeReviewTab = React.lazy(() => import('./components/TradeReviewTab').then((module) => ({ default: module.TradeReviewTab })));
const StockDetailModal = React.lazy(() => import('./components/StockDetailModal').then((module) => ({ default: module.StockDetailModal })));
const SettingsModal = React.lazy(() => import('./components/SettingsModal').then((module) => ({ default: module.SettingsModal })));

const LoadingWorkspace = () => (
  <div className="surface-card flex min-h-[320px] items-center justify-center rounded-2xl text-sm text-slate-400">
    正在加载工作台…
  </div>
);

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'portfolio' | 'ai' | 'trade_review'>('dashboard');
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [watchlists, setWatchlists] = useState<WatchlistItem[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [aiTargetScope, setAiTargetScope] = useState<string>('ALL');
  const [aiAutoStartKey, setAiAutoStartKey] = useState<number>(0);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setIsRefreshing(true);
    try {
      const [posRes, watchRes, cfgRes] = await Promise.all([
        axios.get('/api/v1/stocks/positions'),
        axios.get('/api/v1/stocks/watchlists'),
        axios.get('/api/v1/config/llm')
      ]);
      setPositions(posRes.data || []);
      setWatchlists(watchRes.data || []);
      setLlmConfigs(cfgRes.data || []);
      setDataError(null);
    } catch (err) {
      console.error('Failed to load application data:', err);
      setDataError('持仓或配置数据加载失败，请检查后端服务与网络连接。');
    } finally {
      setIsRefreshing(false);
    }
  };

  const activeLLM = llmConfigs.find((c) => c.is_active) || llmConfigs[0];

  const handleSwitchModel = async (provider: string) => {
    try {
      await axios.post('/api/v1/config/llm', {
        provider_name: provider,
        set_active: true
      });
      fetchAllData();
    } catch (err) {
      console.error('Failed to switch model provider:', err);
      setDataError('切换模型失败，当前模型配置未改变。');
    }
  };

  const handleTriggerAIFromDashboard = () => {
    setAiTargetScope('ALL');
    setAiAutoStartKey(Date.now());
    setActiveTab('ai');
  };

  return (
    <div className="app-shell text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeLLM={activeLLM}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefreshData={fetchAllData}
        isRefreshing={isRefreshing}
      />

      {dataError && (
        <div role="alert" className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-red-800/60 bg-slate-900 px-4 py-3 text-sm text-red-100 shadow-2xl shadow-slate-950/50">
          <span>{dataError}</span>
          <button onClick={fetchAllData} className="shrink-0 rounded-lg bg-red-900/50 px-2.5 py-1 text-xs font-semibold hover:bg-red-800">重试</button>
          <button onClick={() => setDataError(null)} className="text-red-300 hover:text-white" aria-label="关闭提示">×</button>
        </div>
      )}

      <Suspense fallback={<LoadingWorkspace />}>

      {/* Main App Workspace */}
      <main className="app-content flex-1 max-w-7xl w-full mx-auto px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            positions={positions}
            watchlists={watchlists}
            onTriggerAI={handleTriggerAIFromDashboard}
            onSelectStock={(symbol) => setSelectedStockSymbol(symbol)}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioManager
            positions={positions}
            watchlists={watchlists}
            onRefresh={fetchAllData}
            onSelectStock={(symbol) => setSelectedStockSymbol(symbol)}
          />
        )}

        {(activeTab === 'ai') && (
          <AIAnalysisReport
            activeLLM={activeLLM}
            llmConfigs={llmConfigs}
            onSwitchModel={handleSwitchModel}
            initialScope={aiTargetScope}
            autoStartKey={aiAutoStartKey}
          />
        )}

        {activeTab === 'trade_review' && (
          <TradeReviewTab
            onSelectStock={(symbol) => setSelectedStockSymbol(symbol)}
            onRefreshAll={fetchAllData}
          />
        )}
      </main>


      {/* Stock K-Line Detail Modal */}
      {selectedStockSymbol && (
        <StockDetailModal
          symbol={selectedStockSymbol}
          onClose={() => setSelectedStockSymbol(null)}
          onTriggerStockAI={(symbol) => {
            setSelectedStockSymbol(null);
            setAiTargetScope(`SINGLE:${symbol}`);
            setAiAutoStartKey(Date.now());
            setActiveTab('ai');
          }}
        />
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          llmConfigs={llmConfigs}
          onClose={() => setIsSettingsOpen(false)}
          onRefreshConfigs={fetchAllData}
        />
      )}
      </Suspense>
    </div>
  );
};

export default App;
