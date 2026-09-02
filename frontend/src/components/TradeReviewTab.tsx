import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Plus, Upload, Trash2, Clipboard, FileText, Check, Cpu, Sparkles, 
  Brain, ShieldAlert, TrendingUp, TrendingDown, RefreshCw, Layers, Calendar, MessageSquare,
  Search, Filter, X, Edit3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Send, Bot, User, CornerDownLeft
} from 'lucide-react';
import { TradeRecordItem, AgentMemoryItem } from '../types';

interface TradeReviewTabProps {
  onSelectStock: (symbol: string) => void;
  onRefreshAll: () => void;
}

export const TradeReviewTab: React.FC<TradeReviewTabProps> = ({ onSelectStock, onRefreshAll }) => {
  const [trades, setTrades] = useState<TradeRecordItem[]>([]);
  const [stats, setStats] = useState({ total_trades: 0, buy_count: 0, sell_count: 0, total_buy_amount: 0, total_sell_amount: 0 });
  const [memories, setMemories] = useState<AgentMemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Search & Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pagination states
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [totalPages, setTotalPages] = useState(1);

  // Batch Selection
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Agent Interactive Chat states
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: '你好！我是你的 A 股交易教练 AI Agent。我已经同步读取了你的**当前持仓**与**历史交割单**数据。你可以随时问我任何关于买卖择时、习惯问题或心理建议！'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);


  // Edit Strategy Reason states
  const [editingTrade, setEditingTrade] = useState<TradeRecordItem | null>(null);
  const [editingReasonText, setEditingReasonText] = useState('');
  const [isEditReasonModalOpen, setIsEditReasonModalOpen] = useState(false);




  // Modals & Form states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);

  // Form inputs for Trade
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [strategyReason, setStrategyReason] = useState('');
  const [syncToPosition, setSyncToPosition] = useState(true);

  // Form input for Memory
  const [memContent, setMemContent] = useState('');
  const [memType, setMemType] = useState('USER_HABIT');

  // Clipboard import
  const [clipboardText, setClipboardText] = useState('');
  const [parsedItems, setParsedItems] = useState<any[]>([]);

  // Agent Streaming Review
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isScreenerRunning, setIsScreenerRunning] = useState(false);
  const [agentReportMd, setAgentReportMd] = useState<string>('');

  // Handle Start Stock Screener Agent
  const handleStartScreenerAgent = async () => {
    if (isScreenerRunning || isAgentRunning) return;
    setIsScreenerRunning(true);
    setAgentReportMd('🎯 **智能选股与策略推选 Agent 启动中**...\n正在基于您在记忆库中确立的【选股与建仓规则】，对自选股及持仓股票进行量化指标匹配与多维筛选...');

    try {
      const response = await fetch('/api/v1/ai/screener/run-stream', { method: 'POST' });
      if (!response.body) throw new Error('ReadableStream not supported');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let reportText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        reportText += chunk;
        setAgentReportMd(reportText);
      }
      setTimeout(() => fetchAgentMemories(), 1000);
    } catch (err) {
      console.error('Screener Agent Stream Error:', err);
    } finally {
      setIsScreenerRunning(false);
    }
  };


  const fetchTradeData = async () => {
    setIsLoading(true);
    try {
      const params: any = {
        page,
        page_size: pageSize
      };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (tradeTypeFilter !== 'ALL') params.trade_type = tradeTypeFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const res = await axios.get('/api/v1/trades', { params });
      setTrades(res.data.items || []);
      setStats(res.data.stats || { total_trades: 0, buy_count: 0, sell_count: 0, total_buy_amount: 0, total_sell_amount: 0 });
      if (res.data.pagination) {
        setTotalPages(res.data.pagination.total_pages || 1);
      }
    } catch (err) {
      console.error('Failed to fetch trade records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgentMemories = async () => {
    try {
      const res = await axios.get('/api/v1/ai/agent/memories');
      setMemories(res.data || []);
    } catch (err) {
      console.error('Failed to fetch agent memories:', err);
    }
  };

  useEffect(() => {
    fetchTradeData();
  }, [page, pageSize, searchTerm, tradeTypeFilter, startDate, endDate]);

  useEffect(() => {
    fetchAgentMemories();
  }, []);

  // Reset to page 1 when filter/pageSize changes
  useEffect(() => {
    setPage(1);
  }, [searchTerm, tradeTypeFilter, startDate, endDate, pageSize]);

  // Auto scroll chat to bottom
  useEffect(() => {
    if (isChatModalOpen) {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatModalOpen]);

  // Handle Send Agent Chat Message
  const handleSendChatMessage = async (presetText?: string) => {
    const textToSend = presetText || chatInput;
    if (!textToSend.trim() || isChatStreaming) return;

    const newMessages = [...chatMessages, { role: 'user' as const, content: textToSend.trim() }];
    setChatMessages(newMessages);
    if (!presetText) setChatInput('');
    setIsChatStreaming(true);

    // Append empty assistant message for streaming
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch('/api/v1/ai/agent/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages
        })
      });

      if (!response.body) throw new Error('ReadableStream not supported');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let currentText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        currentText += chunk;

        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: currentText };
          return updated;
        });
      }
      fetchAgentMemories(); // Refresh memories if evolved
    } catch (err) {
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: '与 AI Agent 通信异常，请稍后重试。' };
        return updated;
      });
    } finally {
      setIsChatStreaming(false);
    }
  };



  // Selection Logic
  const isAllSelected = trades.length > 0 && selectedIds.length === trades.length;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(trades.map((t) => t.id));
    }
  };

  const toggleSelectId = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleBatchDeleteTrades = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`【危险】确定要彻底删除选中的 ${selectedIds.length} 笔交易记录吗？`)) return;
    try {
      await axios.post('/api/v1/trades/batch-delete', { ids: selectedIds });
      setSelectedIds([]);
      fetchTradeData();
    } catch (err) {
      alert('批量删除失败');
    }
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setTradeTypeFilter('ALL');
    setStartDate('');
    setEndDate('');
    setSelectedIds([]);
  };

  // Open Edit Reason Modal
  const handleOpenEditReason = (t: TradeRecordItem) => {
    setEditingTrade(t);
    setEditingReasonText(t.strategy_reason || '');
    setIsEditReasonModalOpen(true);
  };

  // Save Edited Reason
  const handleSaveEditedReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrade) return;
    try {
      await axios.put(`/api/v1/trades/${editingTrade.id}/reason`, {
        strategy_reason: editingReasonText
      });
      setIsEditReasonModalOpen(false);
      setEditingTrade(null);
      fetchTradeData();
    } catch (err) {
      alert('修改买卖理由失败');
    }
  };



  // Handle Add Trade
  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !price || !volume) return;
    try {
      await axios.post('/api/v1/trades', {
        symbol,
        name: name || undefined,
        trade_type: tradeType,
        price: parseFloat(price),
        volume: parseInt(volume),
        strategy_reason: strategyReason,
        sync_to_position: syncToPosition
      });
      setIsAddModalOpen(false);
      setSymbol('');
      setName('');
      setPrice('');
      setVolume('');
      setStrategyReason('');
      fetchTradeData();
      onRefreshAll();
    } catch (err) {
      alert('添加交易记录失败');
    }
  };

  // Handle Delete Trade
  const handleDeleteTrade = async (id: number) => {
    if (!confirm('确定删除该笔交易记录吗？')) return;
    try {
      await axios.delete(`/api/v1/trades/${id}`);
      fetchTradeData();
    } catch (err) {
      alert('删除失败');
    }
  };

  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dedupMode, setDedupMode] = useState<'SKIP' | 'OVERWRITE' | 'ALLOW_ALL'>('SKIP');

  // Handle Clipboard Parse
  const handleParseClipboard = async () => {
    if (!clipboardText.trim()) return;
    setIsParsing(true);
    try {
      const res = await axios.post('/api/v1/trades/parse-clipboard', { text: clipboardText });
      setParsedItems(res.data.items || []);
    } catch (err) {
      alert('解析格式失败');
    } finally {
      setIsParsing(false);
    }
  };

  // Handle Direct XLS/CSV File Upload for Trades
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsing(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/v1/trades/upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setParsedItems(res.data.items || []);
    } catch (err) {
      alert('解析文件失败，请确保上传同花顺导出的 .xls 或 .csv 文件');
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmImportTrades = async () => {
    if (parsedItems.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await axios.post('/api/v1/trades/batch', {
        items: parsedItems.map((item) => ({
          symbol: item.symbol,
          name: item.name,
          trade_type: item.trade_type,
          price: item.price,
          volume: item.volume,
          fee: item.fee || 0,
          trade_date: item.trade_date,
          strategy_reason: item.strategy_reason || '同花顺交割单批量导入'
        })),
        deduplicate_mode: dedupMode,
        sync_to_position: true
      });

      alert(`导入处理完成！\n• 成功新增：${res.data.count} 笔\n• 自动跳过重复：${res.data.skipped_count} 笔\n• 覆盖已有：${res.data.overwritten_count} 笔`);

      setIsImportModalOpen(false);
      setClipboardText('');
      setParsedItems([]);
      fetchTradeData();
      onRefreshAll();
    } catch (err) {
      alert('批量导入交易记录失败');
    } finally {
      setIsSubmitting(false);
    }
  };



  // Handle Add Memory
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memContent.trim()) return;
    try {
      await axios.post('/api/v1/ai/agent/memories', {
        content: memContent.trim(),
        memory_type: memType,
        importance: 4
      });
      setIsMemoryModalOpen(false);
      setMemContent('');
      fetchAgentMemories();
    } catch (err) {
      alert('保存记忆失败');
    }
  };

  const handleDeleteMemory = async (id: number) => {
    if (!confirm('确定擦除这条 Agent 记忆吗？')) return;
    try {
      await axios.delete(`/api/v1/ai/agent/memories/${id}`);
      fetchAgentMemories();
    } catch (err) {
      alert('擦除记忆失败');
    }
  };

  // Trigger Trade Review Agent Stream
  const handleStartAgentReview = () => {
    setIsAgentRunning(true);
    setAgentReportMd('');

    const eventSource = new EventSource('/api/v1/ai/agent/review-stream');
    
    // Using fetch/SSE polyfill style stream processing via axios post / native response
    // For FastAPI streaming POST endpoint, we use fetch with ReadableStream reader
    fetch('/api/v1/ai/agent/review-stream', { method: 'POST' })
      .then(async (response) => {
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            const chunkValue = decoder.decode(value, { stream: true });
            setAgentReportMd((prev) => prev + chunkValue);
          }
        }
        setIsAgentRunning(false);
        // Refresh memory bank after review completes (agent auto evolution)
        setTimeout(() => fetchAgentMemories(), 1000);
      })
      .catch((err) => {
        console.error('Agent Stream Error:', err);
        setIsAgentRunning(false);
      });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <span>Trade Review Agent (AI 交易复盘诊所)</span>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                  持续进化 Agent
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                记录每日买卖理由 ➔ Agent 记忆反思 ➔ 诊断买卖点与交易心理 ➔ 积累演化教训
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>新增交易日志</span>
            </button>

            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-900/50 font-medium text-xs rounded-xl transition-all flex items-center space-x-1.5"
            >
              <Clipboard className="w-4 h-4" />
              <span>导入交割单</span>
            </button>

            <button
              onClick={handleStartAgentReview}
              disabled={isAgentRunning || isScreenerRunning}
              className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg transition-all flex items-center space-x-1.5 ${
                isAgentRunning 
                  ? 'bg-purple-800 opacity-80 cursor-not-allowed animate-pulse' 
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-purple-600/30'
              }`}
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>{isAgentRunning ? 'Agent 复盘诊断中...' : '一键生成复盘报告'}</span>
            </button>

            <button
              onClick={handleStartScreenerAgent}
              disabled={isScreenerRunning || isAgentRunning}
              className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg transition-all flex items-center space-x-1.5 ${
                isScreenerRunning 
                  ? 'bg-emerald-800 opacity-80 cursor-not-allowed animate-pulse' 
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/30'
              }`}
            >
              <Cpu className="w-4 h-4 text-emerald-200" />
              <span>{isScreenerRunning ? '智能选股筛选中...' : '🎯 运行智能选股 Agent'}</span>
            </button>

            <button
              onClick={() => setIsChatModalOpen(true)}
              className="px-4 py-2 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 font-semibold text-xs rounded-xl shadow-lg transition-all flex items-center space-x-1.5"
            >
              <MessageSquare className="w-4 h-4 text-purple-400" />
              <span>💬 与 Agent 自由对话</span>
            </button>


          </div>
        </div>

        {/* Trade Metrics Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">总交易笔数</div>
            <div className="text-lg font-bold font-mono text-slate-100 mt-1">{stats.total_trades} 笔</div>
          </div>
          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">买入/卖出结构</div>
            <div className="text-sm font-semibold font-mono text-slate-200 mt-1 flex items-center space-x-2">
              <span className="text-emerald-400">买入 {stats.buy_count}</span>
              <span className="text-slate-600">|</span>
              <span className="text-red-400">卖出 {stats.sell_count}</span>
            </div>
          </div>
          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">累计成交总额</div>
            <div className="text-lg font-bold font-mono text-indigo-300 mt-1">
              ¥{(stats.total_buy_amount + stats.total_sell_amount).toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>Agent 已进化记忆</span>
              <button onClick={() => setIsMemoryModalOpen(true)} className="text-indigo-400 hover:underline text-[10px]">
                +添加
              </button>
            </div>
            <div className="text-lg font-bold font-mono text-purple-300 mt-1">
              {memories.length} 条经验积累
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid (Trade Log + Agent Memory Vault) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Trade Log Table (2 cols) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>每日交易日志记录</span>
            </h3>
            <button onClick={fetchTradeData} className="p-1 text-slate-400 hover:text-slate-200">
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Multi-Criteria Filter Bar */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="搜索股票代码或名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent border-none text-slate-100 placeholder-slate-500 focus:outline-none w-full text-xs"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="text-slate-500 hover:text-slate-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={tradeTypeFilter}
              onChange={(e) => setTradeTypeFilter(e.target.value as any)}
              className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
            >
              <option value="ALL">全部买卖方向</option>
              <option value="BUY">只看买入 (BUY)</option>
              <option value="SELL">只看卖出 (SELL)</option>
            </select>

            <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
              <span className="text-slate-500 text-[10px]">日期:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent border-none text-slate-200 text-xs focus:outline-none cursor-pointer"
              />
              <span className="text-slate-600">~</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent border-none text-slate-200 text-xs focus:outline-none cursor-pointer"
              />
            </div>

            {(searchTerm || tradeTypeFilter !== 'ALL' || startDate || endDate) && (
              <button
                onClick={handleResetFilters}
                className="text-indigo-400 hover:text-indigo-300 text-xs font-medium px-2 py-1 bg-indigo-950/50 rounded-lg border border-indigo-800/40"
              >
                重置条件
              </button>
            )}
          </div>

          {/* Batch Delete Action Toolbar */}
          {selectedIds.length > 0 && (
            <div className="bg-gradient-to-r from-indigo-950 via-purple-950 to-indigo-950 border border-indigo-700/50 rounded-xl p-2.5 px-4 flex items-center justify-between shadow-lg">
              <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-indigo-400" />
                已选中 <strong className="text-white text-sm font-mono">{selectedIds.length}</strong> 笔交易记录
              </span>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleBatchDeleteTrades}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded-lg shadow transition-all flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>批量删除选中项 ({selectedIds.length})</span>
                </button>

                <button
                  onClick={() => setSelectedIds([])}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 hover:text-white text-xs font-medium rounded-lg border border-slate-700"
                >
                  取消选择
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800 select-none">
                <tr>
                  <th className="py-2.5 px-2 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3">日期/类型</th>
                  <th className="py-2.5 px-3">股票名称/代码</th>
                  <th className="py-2.5 px-3 text-right">成交价</th>
                  <th className="py-2.5 px-3 text-right">数量</th>
                  <th className="py-2.5 px-3 text-right">总金额</th>
                  <th className="py-2.5 px-3">买卖理由与交易心得</th>
                  <th className="py-2.5 px-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      无匹配的交易记录（点击重置条件或新增交易日志）
                    </td>
                  </tr>
                ) : (
                  trades.map((t) => (
                    <tr key={t.id} className={`hover:bg-slate-800/40 transition-colors ${selectedIds.includes(t.id) ? 'bg-indigo-950/30' : ''}`}>
                      <td className="py-3 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(t.id)}
                          onChange={() => toggleSelectId(t.id)}
                          className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono text-slate-400">{t.trade_date.split(' ')[0]}</div>
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          t.trade_type === 'BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' : 'bg-red-950 text-red-300 border border-red-800/50'
                        }`}>
                          {t.trade_type === 'BUY' ? '买入建仓' : '卖出止盈/损'}
                        </span>
                      </td>

                      <td 
                        onClick={() => onSelectStock(t.symbol)}
                        className="py-3 px-3 font-semibold text-slate-100 cursor-pointer hover:text-indigo-400"
                      >
                        <div>{t.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{t.symbol}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-200">
                        ¥{t.price.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">
                        {t.volume} 股
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">
                        ¥{t.amount.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-slate-300 max-w-xs" title={t.strategy_reason}>
                        <div className="flex items-center justify-between">
                          <span className="truncate flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            <span>{t.strategy_reason || <span className="text-slate-600 italic">点击添加心得/理由</span>}</span>
                          </span>
                          <button
                            onClick={() => handleOpenEditReason(t)}
                            className="ml-1.5 p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded transition-colors flex-shrink-0"
                            title="编辑买卖理由与心得"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => handleDeleteTrade(t.id)}
                          className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {stats.total_trades > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs">
              {/* Left info */}
              <div className="text-slate-400 font-mono text-[11px]">
                显示第 <span className="text-slate-200 font-bold">{Math.min((page - 1) * pageSize + 1, stats.total_trades)}</span> - <span className="text-slate-200 font-bold">{Math.min(page * pageSize, stats.total_trades)}</span> 条，共 <span className="text-indigo-400 font-bold">{stats.total_trades.toLocaleString()}</span> 条记录
              </div>

              {/* Right pagination buttons & page size selector */}
              <div className="flex items-center space-x-2">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 text-slate-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none cursor-pointer"
                >
                  <option value={15}>15 条/页</option>
                  <option value={30}>30 条/页</option>
                  <option value={50}>50 条/页</option>
                  <option value={100}>100 条/页</option>
                </select>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="p-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-40 hover:bg-slate-800 disabled:hover:bg-slate-950 transition-colors"
                    title="首页"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="p-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-40 hover:bg-slate-800 disabled:hover:bg-slate-950 transition-colors"
                    title="上一页"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  <span className="px-2 py-1 font-mono text-slate-300 text-[11px]">
                    <strong className="text-indigo-400">{page}</strong> / {totalPages}
                  </span>

                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-40 hover:bg-slate-800 disabled:hover:bg-slate-950 transition-colors"
                    title="下一页"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                    className="p-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 disabled:opacity-40 hover:bg-slate-800 disabled:hover:bg-slate-950 transition-colors"
                    title="末页"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>


        {/* Right: Agent Memory Vault (1 col) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span>Agent 进化记忆档案库</span>
              </h3>
              <button
                onClick={() => setIsMemoryModalOpen(true)}
                className="px-2 py-1 bg-purple-950 hover:bg-purple-900 border border-purple-800/50 text-purple-300 text-[11px] rounded-lg font-medium"
              >
                + 手动添加
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mb-3">
              Agent 在每次复盘时会自动提炼您的性格偏好与习惯教训，保存在下方。下一次对话时将注入上下文：
            </p>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {memories.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Agent 记忆库尚空。进行一次“召唤 Agent 交易复盘”后将自动开始积累进化！
                </div>
              ) : (
                memories.map((m) => (
                  <div key={m.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 space-y-1.5 relative group">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                        m.memory_type === 'SCREENING_RULE'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                          : (m.memory_type === 'POSITION_RULE'
                            ? 'bg-sky-950 text-sky-300 border border-sky-800/40'
                            : (m.memory_type === 'LESSON_LEARNED'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800/40'
                              : (m.memory_type === 'TRADING_STYLE'
                                ? 'bg-purple-950 text-purple-300 border border-purple-800/40'
                                : 'bg-indigo-950 text-indigo-300 border border-indigo-800/40')))
                      }`}>
                        {m.memory_type === 'SCREENING_RULE' ? '🎯 选股规则' : (
                          m.memory_type === 'POSITION_RULE' ? '🛡️ 建仓规则' : (
                            m.memory_type === 'LESSON_LEARNED' ? '教训反思' : (
                              m.memory_type === 'TRADING_STYLE' ? '交易风格' : '习惯偏好'
                            )
                          )
                        )}
                      </span>

                      <button
                        onClick={() => handleDeleteMemory(m.id)}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all text-xs"
                        title="擦除此条记忆"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed font-medium">
                      {m.content}
                    </p>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
                      <span>{m.source_info}</span>
                      <span className="font-mono text-purple-400">重要度: {m.importance}/5</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-purple-950/30 border border-purple-900/40 rounded-xl p-3 text-[11px] text-purple-300">
            💡 <strong>记忆进化原理</strong>：Agent 不再依赖单次对话的记忆丧失，数据库持久化积累您的操盘性格，避免“重复犯同样的错误”。
          </div>
        </div>
      </div>

      {/* Streamed Agent Review Section */}
      {(agentReportMd || isAgentRunning) && (
        <div className="bg-slate-900 border border-purple-900/50 rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>Trade Review Agent 诊断与反思报告</span>
            </h3>
            {isAgentRunning && (
              <span className="text-xs text-purple-300 flex items-center gap-2 font-mono">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                Agent 结合记忆思考进化中...
              </span>
            )}
          </div>

          <div className="max-w-none text-sm text-slate-200 leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-lg font-extrabold text-slate-100 pb-2 mb-4 border-b border-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-purple-500 rounded-full inline-block"></span>
                    <span>{children}</span>
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-bold text-purple-200 mt-5 mb-3 pt-3 border-t border-slate-800/60 flex items-center gap-2">
                    <span>{children}</span>
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xs sm:text-sm font-bold text-slate-100 mt-3 mb-2 bg-slate-950/80 border border-slate-800 px-3.5 py-2 rounded-xl text-purple-300">
                    <span>{children}</span>
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed my-2 font-sans">
                    {children}
                  </p>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-purple-300 bg-purple-950/70 border border-purple-800/50 px-1.5 py-0.5 rounded text-[12px] font-mono">
                    {children}
                  </strong>
                ),
                ul: ({ children }) => (
                  <ul className="space-y-2 my-2.5 pl-1">
                    {children}
                  </ul>
                ),
                li: ({ children }) => (
                  <li className="text-xs sm:text-sm text-slate-300 flex items-start gap-2 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2 flex-shrink-0"></span>
                    <div className="flex-1">{children}</div>
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="bg-purple-950/40 border-l-4 border-purple-500 rounded-r-xl p-3 text-purple-200 my-3 text-xs leading-relaxed">
                    {children}
                  </blockquote>
                )
              }}
            >
              {agentReportMd}
            </ReactMarkdown>
          </div>

        </div>
      )}

      {/* Modal 1: Add Single Trade */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100">新增每日交易记录</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <form onSubmit={handleAddTrade} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">交易类型</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTradeType('BUY')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      tradeType === 'BUY' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    买入 (BUY)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeType('SELL')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      tradeType === 'SELL' ? 'bg-red-600 text-white border-red-500' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    卖出 (SELL)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">股票/ETF代码 (6位代码)</label>
                <input
                  type="text"
                  placeholder="如: 600519"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">股票名称 (可选)</label>
                <input
                  type="text"
                  placeholder="如: 贵州茅台"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交价格 (元)</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="1650.0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交数量 (股)</label>
                  <input
                    type="number"
                    placeholder="100"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">买卖理由 / 心理心得 (重要: 供 Agent 分析)</label>
                <textarea
                  rows={2}
                  placeholder="例如: 突破20日均线回踩确认建仓，或触及止损价纪律平仓"
                  value={strategyReason}
                  onChange={(e) => setStrategyReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="syncPos"
                  checked={syncToPosition}
                  onChange={(e) => setSyncToPosition(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="syncPos" className="text-xs text-slate-300 cursor-pointer select-none">
                  自动同步联动更新“我的持仓”列表
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md mt-2"
              >
                保存交易记录
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Import Clipboard Trades */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-indigo-400" />
                <span>同花顺/券商交割单粘贴解析</span>
              </h3>
              <button onClick={() => setIsImportModalOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <textarea
              rows={4}
              placeholder="可直接选择上传同花顺导出的 trade.xls 文件，或粘贴文本：&#10;例如：&#10;20250902 14:53:53 512800 银行ETF 买入 2500 0.841&#10;20250902 14:52:29 601099 太平洋 买入 500 4.72"
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200"
            />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <label className="w-full sm:w-auto cursor-pointer px-4 py-2 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all">
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>上传同花顺文件 (.xls/.csv)</span>
                <input
                  type="file"
                  accept=".xls,.csv,.xlsx,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={handleParseClipboard}
                disabled={isParsing || isSubmitting}
                className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 flex items-center justify-center space-x-1.5"
              >
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>{isParsing ? '解析中...' : '解析文本明细'}</span>
              </button>
            </div>

            {isParsing && (
              <div className="bg-indigo-950/60 border border-indigo-800/50 rounded-xl p-3 text-xs text-indigo-200 flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                <span>正在极速读取并解析交割单数据，请稍候...</span>
              </div>
            )}

            {isSubmitting && (
              <div className="bg-purple-950/60 border border-purple-800/50 rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-semibold text-purple-200 flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                  <span>正在极速批量保存 {parsedItems.length} 笔历史交易记录至数据库...</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full animate-pulse w-full"></div>
                </div>
              </div>
            )}

            {parsedItems.length > 0 && !isSubmitting && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">成功识别 {parsedItems.length} 笔交易：</span>
                </div>

                <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 p-2 text-xs space-y-1">
                  {parsedItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-300 py-1 border-b border-slate-900">
                      <span className={item.trade_type === 'BUY' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {item.trade_type === 'BUY' ? '买入' : '卖出'} {item.name} ({item.symbol})
                      </span>
                      <span className="font-mono">¥{item.price} x {item.volume}股</span>
                    </div>
                  ))}
                </div>

                {/* Deduplication Strategy Selector */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">重复数据处理策略：</label>
                  <select
                    value={dedupMode}
                    onChange={(e) => setDedupMode(e.target.value as any)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-indigo-300 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
                  >
                    <option value="SKIP">自动跳过重复记录 (推荐)</option>
                    <option value="OVERWRITE">覆盖已有记录</option>
                    <option value="ALLOW_ALL">允许重复导入</option>
                  </select>
                </div>

                <button
                  onClick={handleConfirmImportTrades}
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md flex items-center justify-center space-x-1"
                >
                  <Check className="w-4 h-4" />
                  <span>确认一键导入这 {parsedItems.length} 笔交易</span>
                </button>
              </div>
            )}


          </div>
        </div>
      )}

      {/* Modal 3: Add Manual Agent Memory */}
      {isMemoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span>手动录入 Agent 认知记忆</span>
              </h3>
              <button onClick={() => setIsMemoryModalOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <form onSubmit={handleAddMemory} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">记忆类型</label>
                <select
                  value={memType}
                  onChange={(e) => setMemType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-medium"
                >
                  <option value="SCREENING_RULE">🎯 选股与筛选规则 (例: 只选 MA20 多头且 MACD 金叉)</option>
                  <option value="POSITION_RULE">🛡️ 建仓与风控规则 (例: 分批建仓，跌破 5% 坚决止损)</option>
                  <option value="USER_HABIT">交易习惯与偏好</option>
                  <option value="LESSON_LEARNED">经验教训反思</option>
                  <option value="TRADING_STYLE">交易风格特点</option>
                </select>

              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">认知记忆内容 (例如: 习惯在半导体板块重仓做T)</label>
                <textarea
                  rows={3}
                  placeholder="输入你希望 Agent 长期记住的关于你的交易习惯或教训..."
                  value={memContent}
                  onChange={(e) => setMemContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs rounded-xl shadow-md mt-2"
              >
                存入 Agent 记忆库
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Edit Strategy Reason */}
      {isEditReasonModalOpen && editingTrade && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                <span>编辑【{editingTrade.name} ({editingTrade.symbol})】买卖理由</span>
              </h3>
              <button onClick={() => setIsEditReasonModalOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <form onSubmit={handleSaveEditedReason} className="space-y-3">
              <div className="text-xs text-slate-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1">
                <div>
                  交易方向：<strong className={editingTrade.trade_type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{editingTrade.trade_type === 'BUY' ? '买入建仓' : '卖出止盈/损'}</strong> &nbsp;|&nbsp; 
                  成交单价：¥{editingTrade.price}
                </div>
                <div>成交时间：{editingTrade.trade_date}</div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">买卖理由与复盘心得 (重要: 供 Agent 复盘分析)</label>
                <textarea
                  rows={4}
                  placeholder="例如: 突破20日线放量确认建仓，或触及止损线纪律平仓..."
                  value={editingReasonText}
                  onChange={(e) => setEditingReasonText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-sans"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditReasonModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  保存修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Modal 5: Agent Interactive Chat Window */}
      {isChatModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-md">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                    <span>Trade Review Coach Agent (AI 交易教练对话室)</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  </h3>
                  <p className="text-[11px] text-slate-400">已实时同步你的 <strong>{stats.total_trades} 笔交割单</strong> 与 <strong>{memories.length} 条进化的认知记忆</strong></p>
                </div>
              </div>
              <button
                onClick={() => setIsChatModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* Quick Prompt Chips */}
            <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-[11px]">
              <span className="text-slate-500 flex-shrink-0">💡 快捷问诊:</span>
              <button
                onClick={() => handleSendChatMessage('分析我近期的交易日志，指出我最严重的操作盲点是什么？')}
                disabled={isChatStreaming}
                className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                🎯 诊断我最严重的操作盲点
              </button>
              <button
                onClick={() => handleSendChatMessage('对比我的买入与卖出策略，我的仓位与止损控制得怎么样？')}
                disabled={isChatStreaming}
                className="px-2.5 py-1 bg-purple-950/60 hover:bg-purple-900 text-purple-300 border border-purple-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                ⚖️ 评估仓位控制与止损纪律
              </button>
              <button
                onClick={() => handleSendChatMessage('结合我的性格风格与记忆教训，给我 3 条可直接落地执行的改进建议。')}
                disabled={isChatStreaming}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-full flex-shrink-0 transition-colors"
              >
                📝 给出 3 条可落地改进建议
              </button>
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-950/20 font-sans">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex items-start space-x-3 ${
                    msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gradient-to-tr from-purple-600 to-indigo-600 text-white'
                    }`}
                  >
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white font-medium rounded-tr-none'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none space-y-2'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <div>{msg.content}</div>
                    ) : (
                      <div className="prose prose-invert prose-xs max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content || '...'}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatMessagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-slate-800 bg-slate-900">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChatMessage();
                }}
                className="flex items-center space-x-2"
              >
                <input
                  type="text"
                  placeholder="向交易教练提问 (例如: 我容易追高被套，怎么克服？)..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isChatStreaming}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans"
                />

                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatStreaming}
                  className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md flex items-center space-x-1 transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>发送</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
