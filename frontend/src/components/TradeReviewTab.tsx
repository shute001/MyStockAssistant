import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Plus, Upload, Trash2, Clipboard, FileText, Check, Cpu, Sparkles, 
  Brain, ShieldAlert, TrendingUp, TrendingDown, RefreshCw, Layers, Calendar, MessageSquare,
  Search, Filter, X, Edit3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Send, Bot, User, CornerDownLeft, Award, Zap, BookOpen, Maximize2, Minimize2
} from 'lucide-react';
import { TradeRecordItem, AgentMemoryItem, MasterPlaybookItem, StrategyCategory } from '../types';

const CATEGORY_MAP: Record<StrategyCategory, { label: string; badgeClass: string; icon: string }> = {
  SHORT_TERM: { label: '股票短线', badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-800/40', icon: '⚡' },
  MID_TERM: { label: '股票中线', badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-800/40', icon: '📈' },
  LONG_TERM: { label: '股票长线', badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/40', icon: '🛡️' },
  ETF_FUND: { label: 'ETF/基金', badgeClass: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/40', icon: '🌐' },
  GENERAL: { label: '通用风控', badgeClass: 'bg-purple-950/80 text-purple-300 border-purple-800/40', icon: '⚖️' }
};

interface TradeReviewTabProps {
  onSelectStock: (symbol: string) => void;
  onRefreshAll: () => void;
  onOpenSettings?: () => void;
}

export const TradeReviewTab: React.FC<TradeReviewTabProps> = ({ onSelectStock, onRefreshAll, onOpenSettings }) => {

  const [trades, setTrades] = useState<TradeRecordItem[]>([]);
  const [stats, setStats] = useState({
    total_trades: 0,
    buy_count: 0,
    sell_count: 0,
    total_buy_amount: 0,
    total_sell_amount: 0,
    realized_pnl: 0,
    net_cash_flow: 0,
    total_fees: 0,
    unmatched_sell_volume: 0,
    win_rate: 0,
    profit_loss_ratio: 0,
    expectancy: 0,
    planned_ratio: 100,
    total_closed_trades: 0
  });

  const [isPlannedTrade, setIsPlannedTrade] = useState(true);
  const [tradeTag, setTradeTag] = useState('计划内执行');
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
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: '你好！我是你的 A 股交易教练 AI Agent。我已经同步读取了你的**当前持仓**与**历史交割单**数据。你可以随时问我任何关于买卖择时、习惯问题或心理建议！'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);


  // Edit Trade Record states
  const [editingTrade, setEditingTrade] = useState<TradeRecordItem | null>(null);
  const [editingTradeType, setEditingTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [editingReasonText, setEditingReasonText] = useState('');
  const [editingTradeDate, setEditingTradeDate] = useState('');
  const [editingTradeTime, setEditingTradeTime] = useState('');
  const [editingPrice, setEditingPrice] = useState('');
  const [editingVolume, setEditingVolume] = useState('');
  const [isEditReasonModalOpen, setIsEditReasonModalOpen] = useState(false);




  // Modals & Form states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);

  // Master Playbook & Rule Extraction states
  const [playbooks, setPlaybooks] = useState<MasterPlaybookItem[]>([]);
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [extractArticleText, setExtractArticleText] = useState('');
  const [extractArticleTitle, setExtractArticleTitle] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  // Memory Vault Optimization & Pruning states
  const [isOptimizeModalOpen, setIsOptimizeModalOpen] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isApplyingOptimization, setIsApplyingOptimization] = useState(false);
  const [optimizationPlan, setOptimizationPlan] = useState<{
    summary: string;
    prune_items: Array<{ id: number; content: string; reason: string }>;
    enhanced_items?: Array<{ id: number; original_content: string; enhanced_content: string; improvement_reason: string }>;
    recommended_items?: Array<{ name: string; content: string; source_info: string; rationale: string }>;
    merged_items: Array<{ original_ids: number[]; new_content: string; memory_type: string; importance: number; reason: string }>;
    keep_items: Array<{ id: number; content: string; memory_type?: string; importance?: number; reason: string }>;
  } | null>(null);
  const [selectedPruneIds, setSelectedPruneIds] = useState<number[]>([]);
  const [selectedEnhancedIds, setSelectedEnhancedIds] = useState<number[]>([]);
  const [selectedRecommendedIndices, setSelectedRecommendedIndices] = useState<number[]>([]);
  const [selectedMergeIndices, setSelectedMergeIndices] = useState<number[]>([]);
  const [activeOptimizeTab, setActiveOptimizeTab] = useState<'enhanced' | 'recommended' | 'prune' | 'merged' | 'keep'>('enhanced');

  const fetchPlaybooks = async () => {
    try {
      const res = await axios.get('/api/v1/ai/agent/playbooks');
      setPlaybooks(res.data || []);
    } catch (err) {
      console.error('Failed to fetch playbooks:', err);
    }
  };

  const handleActivatePlaybook = async (playbookId: string) => {
    try {
      const res = await axios.post('/api/v1/ai/agent/playbooks/activate', { playbook_id: playbookId });
      fetchPlaybooks();
      fetchAgentMemories();
    } catch (err) {
      alert('激活战法失败');
    }
  };

  const handleExtractRulesFromArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extractArticleText.trim()) return;
    setIsExtracting(true);
    try {
      const res = await axios.post('/api/v1/ai/agent/extract-rules', {
        text: extractArticleText.trim(),
        title: extractArticleTitle.trim() || '战法心得文章'
      });
      alert(`🎉 成功从文章中自动萃取出 ${res.data.extracted_rules.length} 条顶级战法规则，并注入 Agent 长期指导大脑！`);
      setIsExtractModalOpen(false);
      setExtractArticleText('');
      setExtractArticleTitle('');
      fetchPlaybooks();
      fetchAgentMemories();
    } catch (err) {
      alert('萃取失败，请确认输入的战法文本长度与内容有效');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStartAudit = async () => {
    setIsOptimizeModalOpen(true);
    setIsAuditing(true);
    setActiveOptimizeTab('enhanced');
    try {
      const res = await axios.post('/api/v1/ai/agent/memories/audit');
      const data = res.data || {};
      setOptimizationPlan(data);
      const prunes = data.prune_items || [];
      setSelectedPruneIds(prunes.map((p: any) => p.id));
      const enhanced = data.enhanced_items || [];
      setSelectedEnhancedIds(enhanced.map((e: any) => e.id));
      const recommended = data.recommended_items || [];
      setSelectedRecommendedIndices(recommended.map((_: any, idx: number) => idx));
      const merges = data.merged_items || [];
      setSelectedMergeIndices(merges.map((_: any, idx: number) => idx));

      if (enhanced.length > 0) {
        setActiveOptimizeTab('enhanced');
      } else if (recommended.length > 0) {
        setActiveOptimizeTab('recommended');
      } else if (prunes.length > 0) {
        setActiveOptimizeTab('prune');
      } else if (merges.length > 0) {
        setActiveOptimizeTab('merged');
      } else {
        setActiveOptimizeTab('keep');
      }
    } catch (err: any) {
      console.error('Audit memories failed:', err);
      alert('AI 审计经验库失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsAuditing(false);
    }
  };

  const handleApplyOptimization = async () => {
    if (!optimizationPlan) return;
    setIsApplyingOptimization(true);
    try {
      const activeMergedItems = (optimizationPlan.merged_items || []).filter((_, idx) =>
        selectedMergeIndices.includes(idx)
      );
      const activeEnhancedItems = (optimizationPlan.enhanced_items || []).filter((e) =>
        selectedEnhancedIds.includes(e.id)
      );
      const activeRecommendedItems = (optimizationPlan.recommended_items || []).filter((_, idx) =>
        selectedRecommendedIndices.includes(idx)
      );

      const res = await axios.post('/api/v1/ai/agent/memories/apply-optimization', {
        delete_ids: selectedPruneIds,
        merged_items: activeMergedItems,
        enhanced_items: activeEnhancedItems,
        recommended_items: activeRecommendedItems
      });
      alert(res.data?.message || '经验库优化升级已成功应用！');
      setIsOptimizeModalOpen(false);
      fetchAgentMemories();
    } catch (err: any) {
      console.error('Apply optimization failed:', err);
      alert('应用经验库优化失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setIsApplyingOptimization(false);
    }
  };

  // Form inputs for Trade
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [strategyReason, setStrategyReason] = useState('');
  const [syncToPosition, setSyncToPosition] = useState(true);
  const [tradeDate, setTradeDate] = useState('');
  const [tradeTime, setTradeTime] = useState('');

  // Form input for Memory
  const [memContent, setMemContent] = useState('');
  const [memType, setMemType] = useState('USER_HABIT');
  const [memCategory, setMemCategory] = useState<StrategyCategory>('SHORT_TERM');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<'ALL' | StrategyCategory>('ALL');

  // Clipboard import
  const [clipboardText, setClipboardText] = useState('');
  const [parsedItems, setParsedItems] = useState<any[]>([]);

  // Agent Streaming Review
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isScreenerRunning, setIsScreenerRunning] = useState(false);
  const [agentReportMd, setAgentReportMd] = useState<string>('');
  const [isPushingWeChat, setIsPushingWeChat] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const handlePushToWeChat = async (contentToPush?: string, customTitle?: string) => {
    const targetContent = contentToPush || agentReportMd;
    if (!targetContent) {
      alert('暂无复盘报告或对话分析内容，请先生成');
      return;
    }
    setIsPushingWeChat(true);
    try {
      const res = await axios.post('/api/v1/ai/push-review', {
        title: customTitle || '📊 AI 股票交易分析/复盘报告',
        content_md: targetContent
      });
      if (res.data.status === 'success') {
        alert('✅ 内容已成功推送至您的手机微信！');
      } else {
        if (confirm(`推送失败: ${res.data.detail || '未配置微信 SendKey 或 Token'}\n\n是否立即打开设置中心进行配置？`)) {
          onOpenSettings?.();
        }
      }
    } catch (err: any) {
      const detail = err.response?.data?.detail || err.message;
      if (confirm(`推送失败: ${detail}\n\n是否立即打开系统设置配置微信 SendKey / Token？`)) {
        onOpenSettings?.();
      }
    } finally {
      setIsPushingWeChat(false);
    }
  };



  // Handle Start Stock Screener Agent

  const handleStartScreenerAgent = async () => {
    if (isScreenerRunning || isAgentRunning) return;
    setIsScreenerRunning(true);
    setAgentReportMd('');
    
    // Auto scroll down to report section smoothly
    setTimeout(() => {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

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
      setAgentReportMd((prev) => prev + '\n\n[智能选股生成异常，请检查网络或 API Key 设置]');
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
      setStats(res.data.stats || { total_trades: 0, buy_count: 0, sell_count: 0, total_buy_amount: 0, total_sell_amount: 0, realized_pnl: 0, net_cash_flow: 0, total_fees: 0, unmatched_sell_volume: 0 });
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

  const fetchLatestReviewReport = async () => {
    try {
      const res = await axios.get('/api/v1/ai/reports/latest?report_type=TRADE_REVIEW_AGENT');
      if (res.data.status === 'success' && res.data.report?.content_md) {
        setAgentReportMd(res.data.report.content_md);
      }
    } catch (err) {
      console.error('Failed to fetch latest review report:', err);
    }
  };

  useEffect(() => {
    fetchTradeData();
  }, [page, pageSize, searchTerm, tradeTypeFilter, startDate, endDate]);

  useEffect(() => {
    fetchAgentMemories();
    fetchLatestReviewReport();
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

  const handleClearAllTrades = async () => {
    if (!confirm('【高危警告】确定要彻底清空数据库中的【所有历史交易记录】吗？\n清空后操作无法撤销，清空完成即可全新重新导入交割单。')) return;
    try {
      await axios.post('/api/v1/trades/clear-all');
      setSelectedIds([]);
      fetchTradeData();
      onRefreshAll();
      alert('✅ 已成功清空所有历史交易记录！您现在可以重新导入交割单。');
    } catch (err) {
      alert('清空交易记录失败');
    }
  };


  const handleResetFilters = () => {
    setSearchTerm('');
    setTradeTypeFilter('ALL');
    setStartDate('');
    setEndDate('');
    setSelectedIds([]);
  };

  // Open Edit Record Modal
  const handleOpenEditReason = (t: TradeRecordItem) => {
    setEditingTrade(t);
    setEditingTradeType(t.trade_type === 'SELL' ? 'SELL' : 'BUY');
    setEditingReasonText(t.strategy_reason || '');
    setEditingPrice(t.price ? String(t.price) : '');
    setEditingVolume(t.volume ? String(t.volume) : '');
    
    if (t.trade_date && t.trade_date.includes(' ')) {
      const [d, tm] = t.trade_date.split(' ', 2);
      setEditingTradeDate(d);
      setEditingTradeTime(tm);
    } else if (t.trade_date) {
      setEditingTradeDate(t.trade_date);
      setEditingTradeTime('09:30:00');
    } else {
      setEditingTradeDate('');
      setEditingTradeTime('');
    }
    setIsEditReasonModalOpen(true);
  };

  // Save Edited Record
  const handleSaveEditedReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrade) return;
    try {
      const finalDt = editingTradeDate
        ? (editingTradeTime ? `${editingTradeDate} ${editingTradeTime}` : editingTradeDate)
        : undefined;

      await axios.put(`/api/v1/trades/${editingTrade.id}`, {
        trade_type: editingTradeType,
        strategy_reason: editingReasonText,
        trade_date: finalDt,
        price: editingPrice ? parseFloat(editingPrice) : undefined,
        volume: editingVolume ? parseInt(editingVolume) : undefined
      });
      setIsEditReasonModalOpen(false);
      setEditingTrade(null);
      fetchTradeData();
      onRefreshAll();
    } catch (err) {
      alert('修改交易记录失败');
    }
  };



  const handleOpenAddModal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    setTradeDate(`${year}-${month}-${day}`);
    setTradeTime(`${hours}:${minutes}:${seconds}`);
    setIsAddModalOpen(true);
  };

  // Handle Add Trade
  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !price || !volume) return;
    try {
      const finalTradeDate = tradeDate ? (tradeTime ? `${tradeDate} ${tradeTime}` : tradeDate) : undefined;
      await axios.post('/api/v1/trades', {
        symbol,
        name: name || undefined,
        trade_type: tradeType,
        price: parseFloat(price),
        volume: parseInt(volume),
        strategy_reason: strategyReason,
        trade_date: finalTradeDate,
        sync_to_position: syncToPosition,
        is_planned: isPlannedTrade,
        trade_tag: tradeTag
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
        category: memCategory,
        importance: 4
      });
      setIsMemoryModalOpen(false);
      setMemContent('');
      setMemCategory('SHORT_TERM');
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
  const handleStartAgentReview = async () => {
    if (isAgentRunning || isScreenerRunning) return;
    setIsAgentRunning(true);
    setAgentReportMd('🤖 **Trade Review Agent 诊断与反思复盘中**...\n正在对比大盘行情、领涨主线、个股均线与 K 线摆动指标，并结合记忆库中确立的操盘战法进行诊断...');

    setTimeout(() => {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    try {
      const response = await fetch('/api/v1/ai/agent/review-stream', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
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
    } catch (err: any) {
      console.error('Agent Review Stream Error:', err);
      setAgentReportMd((prev) => prev + `\n\n⚠️ [复盘生成失败: ${err.message || '生成中断'}，请检查网络或 API Key 设置]`);
    } finally {
      setIsAgentRunning(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="surface-card bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-800">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100">
                  Trade Review Agent (AI 交易复盘诊所)
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full font-mono">
                  持续进化
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                记录每日买卖理由 ➔ Agent 记忆反思 ➔ 诊断买卖点与交易心理 ➔ 沉淀实战战法
              </p>
            </div>
          </div>

          {/* Action Button Groups */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2.5 w-full lg:w-auto">
            {/* Group 1: Data Management */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 border border-slate-800 rounded-xl">
              <button
                onClick={handleOpenAddModal}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-lg shadow transition-all flex items-center space-x-1"
                title="新增一条交易记录与心得"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>记一笔</span>
              </button>

              <button
                onClick={() => setIsImportModalOpen(true)}
                className="px-3 py-1.5 text-indigo-300 hover:text-white hover:bg-slate-800 font-medium text-xs rounded-lg transition-all flex items-center space-x-1"
                title="粘贴同花顺历史成交交割单"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>导入交割单</span>
              </button>

              <button
                onClick={handleClearAllTrades}
                className="p-1.5 text-rose-400 hover:text-rose-200 hover:bg-rose-950/50 rounded-lg transition-all"
                title="清空历史交易数据"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Group 2: AI Capabilities */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartAgentReview}
                disabled={isAgentRunning || isScreenerRunning}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-white shadow-md transition-all flex items-center space-x-1.5 ${
                  isAgentRunning 
                    ? 'bg-purple-800 opacity-80 cursor-not-allowed animate-pulse' 
                    : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-purple-600/25'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>{isAgentRunning ? '诊断生成中...' : '生成复盘报告'}</span>
              </button>

              <button
                onClick={handleStartScreenerAgent}
                disabled={isScreenerRunning || isAgentRunning}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-white shadow-md transition-all flex items-center space-x-1.5 ${
                  isScreenerRunning 
                    ? 'bg-emerald-800 opacity-80 cursor-not-allowed animate-pulse' 
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/25'
                }`}
              >
                <Cpu className="w-3.5 h-3.5 text-emerald-200" />
                <span>{isScreenerRunning ? '选股中...' : '智能选股 Agent'}</span>
              </button>

              <button
                onClick={() => setIsChatModalOpen(true)}
                className="px-3 py-2 bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/60 font-medium text-xs rounded-xl shadow transition-all flex items-center space-x-1.5"
                title="向 AI 交易教练提问"
              >
                <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                <span>教练对话</span>
              </button>

              {agentReportMd && (
                <button
                  onClick={() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold rounded-xl transition-all flex items-center space-x-1 shadow-lg shadow-amber-500/10"
                >
                  <span>查看报告 ↓</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Trade Quantitative Metrics Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-5 pt-4 border-t border-slate-800/80">
          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">总交易 / 结构</div>
            <div className="text-base font-bold font-mono text-slate-100 mt-1">{stats.total_trades} 笔</div>
            <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
              买{stats.buy_count} | 卖{stats.sell_count}
            </div>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">已实现盈亏 (FIFO)</div>
            <div className={`text-base font-bold font-mono mt-1 ${stats.realized_pnl >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {stats.realized_pnl >= 0 ? '+' : ''}¥{stats.realized_pnl.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">费用 ¥{stats.total_fees.toLocaleString()}</div>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">平仓胜率 (Win Rate)</div>
            <div className="text-base font-bold font-mono text-amber-300 mt-1">
              {stats.win_rate.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">共 {stats.total_closed_trades || 0} 笔完全平仓</div>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">盈亏比 (P/L Ratio)</div>
            <div className="text-base font-bold font-mono text-indigo-300 mt-1">
              {stats.profit_loss_ratio.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">平均盈利 / 平均亏损</div>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400">单笔期望收益</div>
            <div className={`text-base font-bold font-mono mt-1 ${stats.expectancy >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {stats.expectancy >= 0 ? '+' : ''}¥{stats.expectancy.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">每笔数学期望收益</div>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>计划执行率</span>
              <button onClick={() => setIsMemoryModalOpen(true)} className="text-indigo-400 hover:underline text-[10px]">
                记忆({memories.length})
              </button>
            </div>
            <div className="text-base font-bold font-mono text-purple-300 mt-1">
              {stats.planned_ratio.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">计划内严格执行占比</div>
          </div>
        </div>
      </div>


      {/* Preset Master Strategy Playbooks Banner */}
      <div className="surface-card bg-gradient-to-br from-amber-950/20 via-slate-900 to-slate-950 border border-amber-500/30 rounded-2xl p-5 space-y-3 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-slate-950 shadow-md">
              <Award className="w-4 h-4 font-bold" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-amber-200 flex items-center gap-2">
                <span>🏆 顶尖交易战法与规则注入系统 (Master Playbooks)</span>
                <span className="px-2 py-0.5 text-[9px] font-extrabold bg-amber-500 text-slate-950 rounded-full uppercase">
                  LLM 最高优先级脑区
                </span>
              </h3>
              <p className="text-[11px] text-amber-300/70 mt-0.5">
                一键向 Agent 注入顶尖大师战法或粘贴炒股心得，要求复盘与选股时【强制严格对标】
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsExtractModalOpen(true)}
            className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-1.5 self-start sm:self-auto"
          >
            <Sparkles className="w-4 h-4 text-slate-950" />
            <span>✨ 粘贴心得/秘籍 AI 自动萃取</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {playbooks.map((pb) => (
            <div 
              key={pb.id} 
              className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between space-y-2.5 ${
                pb.is_activated 
                  ? 'bg-gradient-to-b from-amber-950/50 to-slate-950 border-amber-500/60 shadow-md shadow-amber-500/10' 
                  : 'bg-slate-950/80 border-slate-800 hover:border-amber-500/40'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-amber-300 truncate pr-1">
                    {pb.name}
                  </span>
                  {pb.is_activated && (
                    <span className="px-1.5 py-0.5 text-[9px] font-extrabold bg-amber-500 text-slate-950 rounded flex-shrink-0">
                      已生效
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed font-sans">
                  {pb.description}
                </p>
              </div>

              <button
                onClick={() => handleActivatePlaybook(pb.id)}
                disabled={pb.is_activated}
                className={`w-full py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center space-x-1 ${
                  pb.is_activated 
                    ? 'bg-amber-950/80 text-amber-400/70 border border-amber-800/40 cursor-default' 
                    : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                }`}
              >
                <Zap className="w-3 h-3 text-amber-400" />
                <span>{pb.is_activated ? '已激活至 Agent 指导库' : '⚡ 一键激活注入'}</span>
              </button>
            </div>
          ))}
        </div>
      </div>


      {/* Main Content Grid (Trade Log + Agent Memory Vault) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Trade Log Table (2 cols) */}
        <div className="surface-card lg:col-span-2 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
            <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>每日交易日志记录</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                {stats.total_trades}笔
              </span>
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenAddModal}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow transition-all flex items-center space-x-1"
                title="新增一条买卖交易记录"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>记一笔</span>
              </button>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-850 border border-slate-800 text-indigo-300 hover:text-indigo-200 text-xs rounded-xl transition-all flex items-center space-x-1"
                title="粘贴或上传同花顺交割单"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>导入交割单</span>
              </button>
              <button
                onClick={fetchTradeData}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                title="刷新交易数据"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
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
                  <th className="py-2.5 px-3">成交时间</th>
                  <th className="py-2.5 px-3 text-center">操作</th>
                  <th className="py-2.5 px-3">股票名称/代码</th>
                  <th className="py-2.5 px-3 text-right">成交价</th>
                  <th className="py-2.5 px-3 text-right">成交数量</th>
                  <th className="py-2.5 px-3 text-right">成交金额</th>
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
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-mono text-slate-200 text-xs">{t.trade_date || '-'}</div>
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-md ${
                          t.trade_type === 'BUY' 
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60' 
                            : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                        }`}>
                          {t.trade_type === 'BUY' ? '买入' : '卖出'}
                        </span>
                        {t.trade_tag && t.trade_tag !== '计划内执行' && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {t.trade_tag}
                          </div>
                        )}
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
                      <td
                        className="py-3 px-3 text-slate-300 max-w-xs cursor-pointer hover:bg-slate-800/40 rounded transition-colors group/cell"
                        onClick={() => handleOpenEditReason(t)}
                        title="点击快速编辑此条记录的买卖心得与交易理由"
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                            <span className="group-hover/cell:text-indigo-300 transition-colors">
                              {t.strategy_reason || <span className="text-slate-500 italic">点击添加交易理由...</span>}
                            </span>
                          </span>
                          <span className="opacity-0 group-hover/cell:opacity-100 p-0.5 text-indigo-400 text-[10px] flex-shrink-0">
                            ✏️
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => handleOpenEditReason(t)}
                            className="px-2 py-1 bg-slate-950 hover:bg-indigo-950/60 text-slate-300 hover:text-indigo-200 border border-slate-700/80 hover:border-indigo-600/60 rounded-lg text-xs flex items-center gap-1 transition-all"
                            title="编辑此笔交易(价格、数量、成交时间与买卖理由)"
                          >
                            <Edit3 className="w-3 h-3 text-indigo-400" />
                            <span>编辑</span>
                          </button>
                          <button
                            onClick={() => handleDeleteTrade(t.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors"
                            title="删除此笔交易记录"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
        <div className="surface-card rounded-2xl p-5 flex flex-col h-full">
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span>Agent 进化记忆与指导规则库</span>
                {memories.length > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/40 font-mono">
                    {memories.length}条
                  </span>
                )}
              </h3>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleStartAudit}
                  disabled={memories.length === 0}
                  className="px-2 py-1 bg-gradient-to-r from-purple-900/80 to-indigo-900/80 hover:from-purple-800 hover:to-indigo-800 border border-purple-500/40 text-purple-200 text-[11px] rounded-lg font-semibold flex items-center gap-1 transition-colors shadow-sm disabled:opacity-50"
                  title="智能优化与瘦身经验库：清理无效废弃规则，提炼核心战法"
                >
                  <Zap className="w-3 h-3 text-purple-300" />
                  <span>智能瘦身</span>
                </button>
                <button
                  onClick={() => setIsExtractModalOpen(true)}
                  className="px-2 py-1 bg-amber-950 hover:bg-amber-900 border border-amber-700/50 text-amber-300 text-[11px] rounded-lg font-semibold flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>AI 萃取</span>
                </button>
                <button
                  onClick={() => setIsMemoryModalOpen(true)}
                  className="px-2 py-1 bg-purple-950 hover:bg-purple-900 border border-purple-800/50 text-purple-300 text-[11px] rounded-lg font-medium transition-colors"
                >
                  + 手动
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mb-2">
              包含激活的顶级战法与 AI 从对话/复盘中提炼的记忆。LLM 生成报告时将最高优先级对标：
            </p>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-2.5 border-b border-slate-800/60">
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('ALL')}
                className={`px-2 py-0.5 text-[11px] rounded-lg font-medium transition-all ${
                  activeCategoryFilter === 'ALL'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                全部 ({memories.length})
              </button>
              {(Object.keys(CATEGORY_MAP) as StrategyCategory[]).map((cat) => {
                const count = memories.filter((m) => (m.category || 'SHORT_TERM') === cat).length;
                const info = CATEGORY_MAP[cat];
                const isActive = activeCategoryFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategoryFilter(cat)}
                    className={`px-2 py-0.5 text-[11px] rounded-lg font-medium flex items-center gap-1 transition-all ${
                      isActive
                        ? `${info.badgeClass} border font-bold shadow-sm`
                        : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <span>{info.icon}</span>
                    <span>{info.label}</span>
                    {count > 0 && <span className="opacity-70 text-[10px]">({count})</span>}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2.5 flex-1 min-h-[460px] max-h-[680px] overflow-y-auto pr-1.5 custom-scrollbar">
              {memories.filter((m) => activeCategoryFilter === 'ALL' || (m.category || 'SHORT_TERM') === activeCategoryFilter).length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  {activeCategoryFilter === 'ALL'
                    ? 'Agent 记忆库尚空。请一键激活战法，或进行一次“召唤 Agent 交易复盘”自动积累！'
                    : `当前【${CATEGORY_MAP[activeCategoryFilter as StrategyCategory]?.label || activeCategoryFilter}】分类暂无记忆战法。`}
                </div>
              ) : (
                memories
                  .filter((m) => activeCategoryFilter === 'ALL' || (m.category || 'SHORT_TERM') === activeCategoryFilter)
                  .map((m) => {
                    const catInfo = CATEGORY_MAP[m.category || 'SHORT_TERM'] || CATEGORY_MAP.SHORT_TERM;
                    return m.memory_type === 'MASTER_PLAYBOOK' ? (
                      <div key={m.id} className="bg-gradient-to-r from-amber-950/40 to-slate-950 border border-amber-500/50 rounded-xl p-3.5 space-y-2 relative group shadow-md shadow-amber-950/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 text-[10px] font-extrabold rounded bg-amber-500 text-slate-950 flex items-center gap-1">
                              <Award className="w-3 h-3" />
                              <span>🏆 顶级战法</span>
                            </span>
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${catInfo.badgeClass}`}>
                              {catInfo.icon} {catInfo.label}
                            </span>
                          </div>

                          <button
                            onClick={() => handleDeleteMemory(m.id)}
                            className="opacity-0 group-hover:opacity-100 text-amber-300/70 hover:text-red-400 transition-all text-xs p-1"
                            title="擦除此战法"
                          >
                            ✕
                          </button>
                        </div>
                        <p className="text-xs text-amber-100 leading-relaxed font-semibold">
                          {m.content}
                        </p>
                        <div className="text-[10px] text-amber-300/80 flex items-center justify-between pt-1 font-mono">
                          <span>{m.source_info}</span>
                          <span className="font-bold text-amber-400">权重: 5/5</span>
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 space-y-2 relative group">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 flex-wrap">
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
                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${catInfo.badgeClass}`}>
                              {catInfo.icon} {catInfo.label}
                            </span>
                          </div>

                          <button
                            onClick={() => handleDeleteMemory(m.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all text-xs p-1"
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
                    );
                  })
              )}
            </div>
          </div>

          <div className="mt-4 bg-purple-950/30 border border-purple-900/40 rounded-xl p-3 text-[11px] text-purple-300">
            💡 <strong>记忆进化原理</strong>：Agent 不再依赖单次对话的记忆丧失，数据库持久化积累您的操盘性格，避免“重复犯同样的错误”。
          </div>
        </div>
      </div>

      {/* Streamed Agent Review Section */}
      <div ref={reportRef} className="scroll-mt-6">
        {(agentReportMd || isAgentRunning || isScreenerRunning) && (
          <div className="bg-slate-900 border border-purple-900/50 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                {isScreenerRunning || agentReportMd.includes('智能选股') || agentReportMd.includes('Screener') ? (
                  <>
                    <Cpu className="w-5 h-5 text-emerald-400" />
                    <span>🎯 Stock & ETF Screener Agent 智能选股推荐报告</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 text-amber-400" />
                    <span>🤖 Trade Review Agent 诊断与反思报告</span>
                  </>
                )}
              </h3>
              <div className="flex items-center gap-2">
                {agentReportMd && !isAgentRunning && !isScreenerRunning && (
                  <button
                    onClick={() => handlePushToWeChat()}
                    disabled={isPushingWeChat}

                    className="px-3 py-1.5 bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md"
                  >
                    <Send className={`w-3.5 h-3.5 ${isPushingWeChat ? 'animate-pulse' : ''}`} />
                    <span>{isPushingWeChat ? '发送中...' : '📱 发送至微信'}</span>
                  </button>
                )}
                {(isAgentRunning || isScreenerRunning) && (
                  <span className="text-xs text-purple-300 flex items-center gap-2 font-mono">
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                    {isScreenerRunning ? '智能选股 Agent 多维指标匹配中...' : 'Agent 结合记忆思考进化中...'}
                  </span>
                )}
              </div>

            </div>

            {isScreenerRunning && (
              <div className="bg-slate-950/80 border border-emerald-500/30 rounded-xl p-4 space-y-2.5 shadow-inner my-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-400 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    AI 多线程并发分析引擎运行中
                  </span>
                  <span className="text-slate-400 font-mono text-[11px]">12 线程并行处理行情与 K 线指标</span>
                </div>
                <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden relative border border-slate-700/50">
                  <div className="bg-gradient-to-r from-emerald-500 via-teal-400 to-purple-500 h-full rounded-full animate-pulse transition-all duration-500 w-full" />
                </div>
              </div>
            )}

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
                  <h2 className="text-base font-bold text-purple-200 mt-5 mb-2.5 pt-3 border-t border-slate-800/60 flex items-center gap-2">
                    <span>{children}</span>
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xs sm:text-sm font-bold text-purple-300 mt-4 mb-2 flex items-center gap-1.5">
                    <span>{children}</span>
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed my-2 font-sans">
                    {children}
                  </p>
                ),
                strong: ({ children }) => (
                  <strong className="font-bold text-purple-300 font-sans">
                    {children}
                  </strong>
                ),
                ul: ({ children }) => (
                  <ul className="space-y-1.5 my-2.5 pl-4 list-disc text-slate-300">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="space-y-1.5 my-2.5 pl-4 list-decimal text-slate-300">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {children}
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
    </div>



      {/* Modal 1: Add Single Trade */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-700/60 my-auto max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100">新增每日交易记录</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/50 transition-colors"
                title="按 Esc 或点击空白处退出"
              >
                ✕
              </button>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交日期</label>
                  <input
                    type="date"
                    value={tradeDate}
                    onChange={(e) => setTradeDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交时间</label>
                  <input
                    type="time"
                    step="1"
                    value={tradeTime}
                    onChange={(e) => setTradeTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
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

              <div>
                <label className="block text-xs text-slate-400 mb-1">交易执行属性 (防范计划外冲动交易)</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setIsPlannedTrade(true); setTradeTag('计划内执行'); }}
                    className={`py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      isPlannedTrade ? 'bg-indigo-950 border-indigo-500 text-indigo-300 font-bold' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    📋 计划内执行
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsPlannedTrade(false); setTradeTag('计划外冲动'); }}
                    className={`py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      !isPlannedTrade ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold' : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    ⚠️ 计划外冲动
                  </button>
                </div>
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsImportModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-700/60 my-auto max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-indigo-400" />
                <span>同花顺/券商交割单粘贴解析</span>
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/50 transition-colors"
                title="按 Esc 或点击空白处退出"
              >
                ✕
              </button>
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

                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 p-2 text-xs space-y-1.5">
                  {parsedItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-300 py-1.5 px-2 border-b border-slate-900/80 gap-3 hover:bg-slate-900/50 rounded-lg">
                      <div className="flex items-center space-x-2.5 min-w-[210px]">
                        <span className={`px-2 py-0.5 text-[11px] font-bold rounded flex-shrink-0 ${
                          item.trade_type === 'BUY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' : 'bg-rose-950 text-rose-400 border border-rose-800/50'
                        }`}>
                          {item.trade_type === 'BUY' ? '买入' : '卖出'}
                        </span>
                        <div className="truncate">
                          <span className="font-bold text-slate-200">{item.name}</span>
                          <span className="font-mono text-[10px] text-slate-400 ml-1">({item.symbol})</span>
                        </div>
                      </div>

                      <div className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {item.trade_date}
                      </div>

                      <div className="font-mono text-right flex-shrink-0">
                        <span className="text-slate-200">¥{item.price}</span>
                        <span className="text-slate-500 text-[10px]"> x {item.volume}股</span>
                      </div>
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMemoryModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-700/60 my-auto max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span>手动录入 Agent 认知记忆</span>
              </h3>
              <button
                onClick={() => setIsMemoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/50 transition-colors"
                title="按 Esc 或点击空白处退出"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddMemory} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">战法分类 / 标的周期</label>
                <select
                  value={memCategory}
                  onChange={(e) => setMemCategory(e.target.value as StrategyCategory)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-medium"
                >
                  <option value="SHORT_TERM">⚡ 股票短线 (超短/接力/情绪龙头/破位止损)</option>
                  <option value="MID_TERM">📈 股票中线 (波段/趋势突破/形态/持股数周)</option>
                  <option value="LONG_TERM">🛡️ 股票长线 (基本面/PB-ROE高股息/价值投资)</option>
                  <option value="ETF_FUND">🌐 ETF与基金 (行业动量轮动/宽基定投/网格交易)</option>
                  <option value="GENERAL">⚖️ 通用风控 (总仓位纪律/止损底线/心态管理)</option>
                </select>
              </div>

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

      {/* Modal 4: Edit Trade Record */}
      {isEditReasonModalOpen && editingTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsEditReasonModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-700/60 my-auto max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-indigo-400" />
                <span>编辑交易记录【{editingTrade.name} ({editingTrade.symbol})】</span>
              </h3>
              <button
                onClick={() => setIsEditReasonModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/50 transition-colors"
                title="按 Esc 或点击空白处退出"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditedReason} className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">
                  标的: <strong className="text-white">{editingTrade.name || editingTrade.symbol}</strong>
                </span>
                <span className="font-mono text-slate-400">
                  代码: {editingTrade.symbol}
                </span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">交易类型 (买入 / 卖出)</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingTradeType('BUY')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      editingTradeType === 'BUY'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-900/30'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    买入 (BUY)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTradeType('SELL')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      editingTradeType === 'SELL'
                        ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-900/30'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    卖出 (SELL)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交价格 (元)</label>
                  <input
                    type="number"
                    step="0.001"
                    value={editingPrice}
                    onChange={(e) => setEditingPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交数量 (股)</label>
                  <input
                    type="number"
                    value={editingVolume}
                    onChange={(e) => setEditingVolume(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交日期</label>
                  <input
                    type="date"
                    value={editingTradeDate}
                    onChange={(e) => setEditingTradeDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">成交时间</label>
                  <input
                    type="time"
                    step="1"
                    value={editingTradeTime}
                    onChange={(e) => setEditingTradeTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">买卖理由与复盘心得 (重要: 供 Agent 复盘分析)</label>
                <textarea
                  rows={3}
                  placeholder="例如: 突破20日线放量确认建仓，或触及止损线纪律平仓..."
                  value={editingReasonText}
                  onChange={(e) => setEditingReasonText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-sans"
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
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center ${
            isChatMaximized ? 'p-0' : 'p-2 sm:p-4 md:p-6'
          } bg-slate-950/80 backdrop-blur-sm overflow-hidden`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsChatModalOpen(false);
          }}
        >
          <div
            className={`modal-animate-in surface-card flex flex-col shadow-2xl border border-slate-700/60 overflow-hidden transition-all duration-200 ${
              isChatMaximized
                ? 'w-full h-full rounded-none border-none'
                : 'w-full max-w-[96vw] 2xl:max-w-[1560px] h-[94vh] max-h-[1050px] rounded-2xl my-auto'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex-shrink-0">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm sm:text-base text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>Trade Review Coach Agent (AI 交易教练对话室)</span>
                    <span className="px-2 py-0.5 text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      联网行情与新闻已在线
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 truncate sm:text-clip">
                    已实时同步 <strong>持仓/交割单</strong>、<strong>{memories.length}条认知战法</strong> 及 <strong>📡 大盘实时指数、热点板块与大盘新闻</strong>
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0 ml-3">
                <button
                  type="button"
                  onClick={() => setIsChatMaximized(!isChatMaximized)}
                  className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                  title={isChatMaximized ? "还原窗口" : "最大化全屏"}
                >
                  {isChatMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsChatModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                  title="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Prompt Chips */}
            <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex items-center gap-2.5 overflow-x-auto text-xs flex-shrink-0">
              <span className="text-slate-400 font-medium flex-shrink-0">💡 快捷问诊:</span>
              <button
                onClick={() => handleSendChatMessage('分析 600519 (贵州茅台) 过去一年年线位置、近10日K线形态、量比及 MACD/KDJ/RSI/BOLL 买卖点')}
                disabled={isChatStreaming}
                className="px-3 py-1 bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                📈 研判茅台 1年年线与近10日K线
              </button>
              <button
                onClick={() => handleSendChatMessage('深度分析 002475 (立讯精密) 近10日K线走势序列、成交量量比及支撑阻力防线')}
                disabled={isChatStreaming}
                className="px-3 py-1 bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                🔍 研判立讯精密 K线量价格局
              </button>
              <button
                onClick={() => handleSendChatMessage('结合今日全市场大盘指数与领涨热点板块，评估我当前持仓的整体风险')}
                disabled={isChatStreaming}
                className="px-3 py-1 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                🌐 点评大盘指数与热点共振
              </button>
              <button
                onClick={() => handleSendChatMessage('分析我近期的交易日志，指出我最严重的操作盲点是什么？')}
                disabled={isChatStreaming}
                className="px-3 py-1 bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                🎯 诊断我最严重的操作盲点
              </button>
              <button
                onClick={() => handleSendChatMessage('根据我当前的实盘持仓盈亏状况，给我制定今日盘后/明日开盘的风控纪律和止损防线')}
                disabled={isChatStreaming}
                className="px-3 py-1 bg-purple-950/60 hover:bg-purple-900 text-purple-300 border border-purple-800/40 rounded-full flex-shrink-0 transition-colors"
              >
                🛡️ 制定明日风控与止损纪律
              </button>
            </div>

            {/* Chat Messages Body */}
            <div className="flex-1 p-5 md:p-6 overflow-y-auto space-y-5 bg-slate-950/30 font-sans">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex items-start space-x-3.5 ${
                    msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gradient-to-tr from-purple-600 to-indigo-600 text-white'
                    }`}
                  >
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
                  </div>

                  <div
                    className={`max-w-[92%] sm:max-w-[88%] lg:max-w-[82%] rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-md ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white font-medium rounded-tr-none'
                        : 'bg-slate-900/95 border border-slate-800 text-slate-200 rounded-tl-none space-y-3'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {(msg.content || '...').replace('[WECHAT_PUSH_REQUESTED]', '').trim()}
                          </ReactMarkdown>
                        </div>
                        {msg.content && msg.content.length > 10 && (
                          <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                const cleanContent = msg.content.replace('[WECHAT_PUSH_REQUESTED]', '').trim();
                                handlePushToWeChat(cleanContent);
                              }}
                              className="px-3 py-1 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm"
                            >
                              <Send className="w-3.5 h-3.5 text-emerald-400" />
                              <span>📱 推送此总结到微信</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div ref={chatMessagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex-shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChatMessage();
                }}
                className="flex items-center space-x-3"
              >
                <input
                  type="text"
                  placeholder="向交易教练提问 (例如: 我容易追高被套，怎么克服？/ 帮我研判当前持仓仓位与明日对策)..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isChatStreaming}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans"
                />

                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatStreaming}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-md flex items-center space-x-1.5 transition-all flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>发送</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: AI Article Rule Extraction */}
      {isExtractModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsExtractModalOpen(false);
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-amber-500/30 my-auto max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-amber-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>✨ 粘贴心得/秘籍 AI 自动萃取战法规则</span>
              </h3>
              <button
                onClick={() => setIsExtractModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/50 transition-colors"
                title="按 Esc 或点击空白处退出"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExtractRulesFromArticle} className="space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                粘贴任意高质量的**游资交易心法、网文心得、大牛招式、或书籍战法**。LLM 大模型将自动提炼出 1-3 条严格的【买点、止损、仓位风控】法则，并直接存入 Agent 最高优先级脑区！
              </p>

              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">文章/心得标题 (可选)</label>
                <input
                  type="text"
                  placeholder="例如: 游资养家心法 / 龙头分歧低吸秘籍"
                  value={extractArticleTitle}
                  onChange={(e) => setExtractArticleTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1 font-medium">文章/心得正文内容</label>
                <textarea
                  rows={6}
                  placeholder="在这里粘贴你认为真正厉害的交易模式、招式文章或操盘心得..."
                  value={extractArticleText}
                  onChange={(e) => setExtractArticleText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500 font-sans leading-relaxed"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsExtractModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isExtracting || !extractArticleText.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center space-x-1.5 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                  <span>{isExtracting ? 'AI 大模型深度萃取中...' : '开始萃取并注入 Agent 脑区'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 7: Agent Memory Vault Optimization & Pruning */}
      {isOptimizeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-8 bg-slate-950/80 backdrop-blur-sm overflow-hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isAuditing && !isApplyingOptimization) {
              setIsOptimizeModalOpen(false);
            }
          }}
        >
          <div
            className="modal-animate-in surface-card rounded-2xl max-w-4xl w-full h-[90vh] max-h-[850px] flex flex-col shadow-2xl border border-purple-500/40 overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex-shrink-0">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-md flex-shrink-0">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm sm:text-base text-slate-100 flex items-center gap-2">
                    <span>🧠 AI 经验库智能瘦身与战法重构 (Memory Optimization)</span>
                    <span className="px-2 py-0.5 text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full">
                      去芜存菁 · 提纯实战战法
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    基于量化选股与严格风控标准，识别剔除无实战价值的情绪化/重复规则，合并零散碎片为标准战法
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isAuditing || isApplyingOptimization}
                onClick={() => setIsOptimizeModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans bg-slate-950/30">
              {isAuditing ? (
                <div className="flex flex-col items-center justify-center h-full py-20 space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600/30 to-indigo-600/30 border border-purple-500/40 flex items-center justify-center animate-pulse">
                    <Sparkles className="w-7 h-7 text-purple-400 animate-spin" />
                  </div>
                  <div className="text-center space-y-1">
                    <h4 className="text-sm font-semibold text-slate-200">AI 量化策略师正在逐条深度审计经验库...</h4>
                    <p className="text-xs text-slate-400 max-w-md">
                      正在交叉比对所有规则的实操指导价值、筛查缺乏量化依据的情绪化空话、检测重复冗余并进行战法蒸馏整合
                    </p>
                  </div>
                </div>
              ) : optimizationPlan ? (
                <div className="space-y-4">
                  {/* Summary Banner */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-900 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-purple-400" />
                        <span>AI 经验库全方位审计与进化诊断报告</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {optimizationPlan.summary}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
                      {(optimizationPlan.enhanced_items?.length ?? 0) > 0 && (
                        <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-950/80 text-indigo-300 border border-indigo-800/40">
                          ⚡ 升级优化: {optimizationPlan.enhanced_items?.length}条
                        </span>
                      )}
                      {(optimizationPlan.recommended_items?.length ?? 0) > 0 && (
                        <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/40">
                          🚀 热门补充: {optimizationPlan.recommended_items?.length}条
                        </span>
                      )}
                      <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800/40">
                        🗑️ 建议淘汰: {optimizationPlan.prune_items.length}条
                      </span>
                      <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-950/80 text-amber-300 border border-amber-800/40">
                        🔄 提纯升级: {optimizationPlan.merged_items.length}条
                      </span>
                      <span className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-900 text-slate-300 border border-slate-700/60">
                        ⭐ 核心保留: {optimizationPlan.keep_items.length}条
                      </span>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto">
                    {(optimizationPlan.enhanced_items?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveOptimizeTab('enhanced')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all flex-shrink-0 ${
                          activeOptimizeTab === 'enhanced'
                            ? 'bg-indigo-900/70 text-indigo-200 border border-indigo-600/60 shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Zap className="w-3.5 h-3.5 text-indigo-400" />
                        <span>已有经验优化升级 ({optimizationPlan.enhanced_items?.length})</span>
                      </button>
                    )}

                    {(optimizationPlan.recommended_items?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveOptimizeTab('recommended')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all flex-shrink-0 ${
                          activeOptimizeTab === 'recommended'
                            ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-600/60 shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>全网热门战法补充 ({optimizationPlan.recommended_items?.length})</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setActiveOptimizeTab('prune')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all flex-shrink-0 ${
                        activeOptimizeTab === 'prune'
                          ? 'bg-rose-900/60 text-rose-200 border border-rose-700/50 shadow'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>建议淘汰清理 ({optimizationPlan.prune_items.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveOptimizeTab('merged')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all flex-shrink-0 ${
                        activeOptimizeTab === 'merged'
                          ? 'bg-amber-900/60 text-amber-200 border border-amber-700/50 shadow'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>建议合并提纯 ({optimizationPlan.merged_items.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveOptimizeTab('keep')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all flex-shrink-0 ${
                        activeOptimizeTab === 'keep'
                          ? 'bg-purple-900/60 text-purple-200 border border-purple-700/50 shadow'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 text-purple-400" />
                      <span>核心保留战法 ({optimizationPlan.keep_items.length})</span>
                    </button>
                  </div>

                  {/* Tab: Enhanced Items */}
                  {activeOptimizeTab === 'enhanced' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                        <span>
                          对于表述模糊、缺乏具体量化参数的已有经验，AI 自动补充了均线、量价及止损纪律：
                        </span>
                        {(optimizationPlan.enhanced_items?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const allIds = (optimizationPlan.enhanced_items || []).map((e) => e.id);
                              if (selectedEnhancedIds.length === allIds.length) {
                                setSelectedEnhancedIds([]);
                              } else {
                                setSelectedEnhancedIds(allIds);
                              }
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                          >
                            {selectedEnhancedIds.length === (optimizationPlan.enhanced_items?.length ?? 0) ? '取消全选' : '全选'}
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                        {(optimizationPlan.enhanced_items || []).map((item) => {
                          const isChecked = selectedEnhancedIds.includes(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => {
                                if (isChecked) {
                                  setSelectedEnhancedIds(selectedEnhancedIds.filter((id) => id !== item.id));
                                } else {
                                  setSelectedEnhancedIds([...selectedEnhancedIds, item.id]);
                                }
                              }}
                              className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                                isChecked
                                  ? 'bg-indigo-950/30 border-indigo-500/50 shadow-md shadow-indigo-950/20'
                                  : 'bg-slate-900/60 border-slate-800 opacity-60 hover:opacity-100'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}}
                                    className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 bg-slate-900 border-slate-700"
                                  />
                                  <span className="px-2 py-0.5 text-[10px] font-extrabold rounded bg-indigo-500 text-white flex items-center gap-1">
                                    <Zap className="w-3 h-3" />
                                    <span>规范量化升级</span>
                                  </span>
                                </div>
                                <span className="text-[10px] text-indigo-300 font-medium">
                                  ID: {item.id}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg space-y-1">
                                  <span className="text-[10px] text-slate-500 font-semibold block">【原经验记录】:</span>
                                  <p className="text-slate-300 line-clamp-3">{item.original_content}</p>
                                </div>
                                <div className="p-3 bg-indigo-950/50 border border-indigo-500/40 rounded-lg space-y-1">
                                  <span className="text-[10px] text-indigo-300 font-semibold block">【升级后量化战法】:</span>
                                  <p className="text-indigo-100 font-medium leading-relaxed">{item.enhanced_content}</p>
                                </div>
                              </div>

                              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-0.5">
                                <span className="text-indigo-400 font-bold">💡 优化增益:</span>
                                <span>{item.improvement_reason}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tab: Recommended Items */}
                  {activeOptimizeTab === 'recommended' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                        <span>
                          结合当前经验库盲区，AI 检索推荐全网公认、高胜率且经过 A 股市场实战检验的顶尖战法：
                        </span>
                        {(optimizationPlan.recommended_items?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const allIdx = (optimizationPlan.recommended_items || []).map((_, idx) => idx);
                              if (selectedRecommendedIndices.length === allIdx.length) {
                                setSelectedRecommendedIndices([]);
                              } else {
                                setSelectedRecommendedIndices(allIdx);
                              }
                            }}
                            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                          >
                            {selectedRecommendedIndices.length === (optimizationPlan.recommended_items?.length ?? 0) ? '取消全选' : '全选'}
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                        {(optimizationPlan.recommended_items || []).map((item, idx) => {
                          const isChecked = selectedRecommendedIndices.includes(idx);
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                if (isChecked) {
                                  setSelectedRecommendedIndices(selectedRecommendedIndices.filter((i) => i !== idx));
                                } else {
                                  setSelectedRecommendedIndices([...selectedRecommendedIndices, idx]);
                                }
                              }}
                              className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                                isChecked
                                  ? 'bg-emerald-950/30 border-emerald-500/50 shadow-md shadow-emerald-950/20'
                                  : 'bg-slate-900/60 border-slate-800 opacity-60 hover:opacity-100'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}}
                                    className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 bg-slate-900 border-slate-700"
                                  />
                                  <h5 className="font-bold text-xs text-emerald-200 flex items-center gap-1.5">
                                    <span>{item.name}</span>
                                  </h5>
                                </div>
                                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                                  {item.source_info}
                                </span>
                              </div>

                              <div className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-lg">
                                <p className="text-xs text-emerald-100 font-medium leading-relaxed">
                                  {item.content}
                                </p>
                              </div>

                              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <span className="text-emerald-400 font-bold">🎯 推荐补充理由:</span>
                                <span>{item.rationale}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tab 1: Prune Items */}
                  {activeOptimizeTab === 'prune' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                        <span>
                          勾选需要永久清理的无效/情绪化/重复条目（默认全选）：
                        </span>
                        {optimizationPlan.prune_items.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedPruneIds.length === optimizationPlan.prune_items.length) {
                                setSelectedPruneIds([]);
                              } else {
                                setSelectedPruneIds(optimizationPlan.prune_items.map((p) => p.id));
                              }
                            }}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                          >
                            {selectedPruneIds.length === optimizationPlan.prune_items.length ? '取消全选' : '全选'}
                          </button>
                        )}
                      </div>

                      {optimizationPlan.prune_items.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                          太棒了！AI 审计未发现明显无用的冗余信息，经验库信噪比极佳！
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                          {optimizationPlan.prune_items.map((item) => {
                            const isChecked = selectedPruneIds.includes(item.id);
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  if (isChecked) {
                                    setSelectedPruneIds(selectedPruneIds.filter((id) => id !== item.id));
                                  } else {
                                    setSelectedPruneIds([...selectedPruneIds, item.id]);
                                  }
                                }}
                                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start space-x-3 ${
                                  isChecked
                                    ? 'bg-rose-950/20 border-rose-800/50 hover:bg-rose-950/30'
                                    : 'bg-slate-900/60 border-slate-800 opacity-60 hover:opacity-100'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="mt-1 w-4 h-4 rounded text-rose-600 focus:ring-rose-500 bg-slate-900 border-slate-700"
                                />
                                <div className="flex-1 space-y-1.5 min-w-0">
                                  <p className="text-xs text-slate-200 leading-relaxed font-medium">
                                    {item.content}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-900/50 text-rose-300 border border-rose-800/40">
                                      ⚠️ 淘汰理由: {item.reason}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 2: Merged Items */}
                  {activeOptimizeTab === 'merged' && (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-400 px-1">
                        AI 智能将分散的同类经验提纯升华，提炼为格式严谨、指标明确的顶级指导战法（将自动覆盖原碎片项）：
                      </div>

                      {optimizationPlan.merged_items.length === 0 ? (
                        <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                          当前经验库战法界限分明，暂无需合并归类的碎片战法。
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                          {optimizationPlan.merged_items.map((item, idx) => {
                            const isChecked = selectedMergeIndices.includes(idx);
                            return (
                              <div
                                key={idx}
                                onClick={() => {
                                  if (isChecked) {
                                    setSelectedMergeIndices(selectedMergeIndices.filter((i) => i !== idx));
                                  } else {
                                    setSelectedMergeIndices([...selectedMergeIndices, idx]);
                                  }
                                }}
                                className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                                  isChecked
                                    ? 'bg-amber-950/25 border-amber-500/50 shadow-md shadow-amber-950/10'
                                    : 'bg-slate-900/60 border-slate-800 opacity-60 hover:opacity-100'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {}}
                                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 bg-slate-900 border-slate-700"
                                    />
                                    <span className="px-2 py-0.5 text-[10px] font-extrabold rounded bg-amber-500 text-slate-950 flex items-center gap-1">
                                      <Award className="w-3 h-3" />
                                      <span>提炼升级新战法</span>
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-amber-300/80 font-mono">
                                    替代 {item.original_ids.length} 条碎片记录
                                  </span>
                                </div>

                                <div className="p-3 bg-slate-950/80 border border-amber-500/30 rounded-lg">
                                  <p className="text-xs text-amber-100 font-semibold leading-relaxed">
                                    {item.new_content}
                                  </p>
                                </div>

                                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                  <span className="text-amber-400 font-bold">💡 提炼理由:</span>
                                  <span>{item.reason}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 3: Keep Items */}
                  {activeOptimizeTab === 'keep' && (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-400 px-1">
                        以下条目具备严谨的量化选股条件、均线/突破形态或止损纪律，本次瘦身将完整予以保留：
                      </div>

                      <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                        {optimizationPlan.keep_items.map((item) => (
                          <div
                            key={item.id}
                            className="p-3.5 rounded-xl border border-emerald-900/40 bg-emerald-950/15 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                                ⭐ 核心战法
                              </span>
                              <span className="text-[10px] text-emerald-400 font-bold">
                                权重: {item.importance || 5}/5
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 leading-relaxed font-medium">
                              {item.content}
                            </p>
                            <p className="text-[10px] text-emerald-400/80">
                              ✓ 保留理由: {item.reason}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Modal Footer */}
            {optimizationPlan && (
              <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between flex-shrink-0">
                <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                  <span>已选: </span>
                  <span className="text-indigo-300 font-bold">优化升级 {selectedEnhancedIds.length}条</span>
                  <span>·</span>
                  <span className="text-emerald-300 font-bold">补充热门 {selectedRecommendedIndices.length}条</span>
                  <span>·</span>
                  <span className="text-rose-300 font-bold">清理淘汰 {selectedPruneIds.length}条</span>
                  <span>·</span>
                  <span className="text-amber-300 font-bold">提炼整合 {selectedMergeIndices.length}条</span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    disabled={isApplyingOptimization}
                    onClick={() => setIsOptimizeModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={
                      isApplyingOptimization ||
                      (selectedPruneIds.length === 0 &&
                        selectedMergeIndices.length === 0 &&
                        selectedEnhancedIds.length === 0 &&
                        selectedRecommendedIndices.length === 0)
                    }
                    onClick={handleApplyOptimization}
                    className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/20 flex items-center space-x-1.5 transition-all"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{isApplyingOptimization ? '正在应用优化...' : '一键执行经验库全套进化'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

