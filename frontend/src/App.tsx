import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { PortfolioManager } from './components/PortfolioManager';
import { AIAnalysisReport } from './components/AIAnalysisReport';
import { TradeReviewTab } from './components/TradeReviewTab';
import { StockDetailModal } from './components/StockDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { PositionItem, WatchlistItem, LLMConfigItem } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'portfolio' | 'ai' | 'trade_review'>('dashboard');
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [watchlists, setWatchlists] = useState<WatchlistItem[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

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
    } catch (err) {
      console.error('Failed to load application data:', err);
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
    }
  };

  const handleTriggerAIFromDashboard = () => {
    setActiveTab('ai');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeLLM={activeLLM}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefreshData={fetchAllData}
        isRefreshing={isRefreshing}
      />

      {/* Main App Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
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
    </div>
  );
};

export default App;
