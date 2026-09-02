import React, { useState, useEffect } from 'react';
import { Cpu, Play, History, FileText, CheckCircle2, AlertTriangle, Sparkles, Filter, Layers, Briefcase, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnalysisReportItem, LLMConfigItem } from '../types';
import axios from 'axios';

interface AIAnalysisReportProps {
  activeLLM?: LLMConfigItem;
  llmConfigs: LLMConfigItem[];
  onSwitchModel: (provider: string) => void;
}

export const AIAnalysisReport: React.FC<AIAnalysisReportProps> = ({
  activeLLM,
  llmConfigs,
  onSwitchModel
}) => {
  const [streamContent, setStreamContent] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [reports, setReports] = useState<AnalysisReportItem[]>([]);
  const [selectedHistoryReport, setSelectedHistoryReport] = useState<AnalysisReportItem | null>(null);

  // Diagnosis Scope State
  const [diagnosisScope, setDiagnosisScope] = useState<string>('ALL');
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [stockList, setStockList] = useState<{ symbol: string; name: string }[]>([]);
  const [customSymbolInput, setCustomSymbolInput] = useState<string>('');

  useEffect(() => {
    fetchHistoryReports();
    fetchCategories();
    fetchStocks();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await axios.get('/api/v1/stocks/categories');
      setCategories(res.data.categories || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchStocks = async () => {
    try {
      const [posRes, watchRes] = await Promise.all([
        axios.get('/api/v1/stocks/positions'),
        axios.get('/api/v1/stocks/watchlists')
      ]);
      const map = new Map<string, string>();
      (posRes.data || []).forEach((item: any) => map.set(item.symbol, item.name));
      (watchRes.data || []).forEach((item: any) => map.set(item.symbol, item.name));

      const list = Array.from(map.entries()).map(([symbol, name]) => ({ symbol, name }));
      setStockList(list);
    } catch (err) {
      console.error('Failed to fetch stock list:', err);
    }
  };

  const fetchHistoryReports = async () => {
    try {
      const res = await axios.get('/api/v1/ai/reports');
      setReports(res.data || []);
    } catch (err) {
      console.error('Failed to fetch historical reports:', err);
    }
  };

  const handleStartFullAnalysis = async () => {
    setIsGenerating(true);
    setStreamContent('');
    setSelectedHistoryReport(null);

    try {
      const response = await fetch('/api/v1/ai/analyze/portfolio/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: diagnosisScope })
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setStreamContent((prev) => prev + text);
      }
      fetchHistoryReports();
    } catch (err) {
      setStreamContent((prev) => prev + '\n\n[分析生成出错，请检查网络或 API Key 设置]');
    } finally {
      setIsGenerating(false);
    }
  };

  const getScopeButtonLabel = () => {
    if (diagnosisScope === 'ALL') return '全仓与全部自选';
    if (diagnosisScope === 'POSITIONS_ONLY') return '我的持仓股专项';
    if (diagnosisScope.startsWith('CATEGORY:')) return `【${diagnosisScope.replace('CATEGORY:', '')}】板块`;
    if (diagnosisScope.startsWith('SINGLE:')) {
      const sym = diagnosisScope.replace('SINGLE:', '');
      const match = stockList.find(s => s.symbol === sym);
      return match ? `【${match.name} (${sym})】` : `【股票 ${sym}】`;
    }
    return '量化诊断';
  };

  const displayedContent = selectedHistoryReport ? selectedHistoryReport.content_md : streamContent;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Sidebar: Scope Filter, Model Switcher & Report History (1 col) */}
      <div className="space-y-6">
        {/* Scope Selector & Generator Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-400" />
            AI 诊断目标范围筛选
          </h3>

          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-slate-400">选择诊断范围：</label>
            
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => { setDiagnosisScope('ALL'); setCustomSymbolInput(''); }}
                className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all ${
                  diagnosisScope === 'ALL'
                    ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200 shadow'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>🌐 全仓持仓 + 全部自选</span>
                </div>
                {diagnosisScope === 'ALL' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
              </button>

              <button
                type="button"
                onClick={() => { setDiagnosisScope('POSITIONS_ONLY'); setCustomSymbolInput(''); }}
                className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all ${
                  diagnosisScope === 'POSITIONS_ONLY'
                    ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200 shadow'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Briefcase className="w-3.5 h-3.5 text-emerald-400" />
                  <span>💼 仅诊断【我的持仓股】</span>
                </div>
                {diagnosisScope === 'POSITIONS_ONLY' && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />}
              </button>

              {/* Specific Category Selection Dropdown */}
              <div className="pt-1">
                <label className="block text-[11px] text-slate-400 mb-1">或选择特定【板块分类】诊断：</label>
                <select
                  value={diagnosisScope.startsWith('CATEGORY:') ? diagnosisScope : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setDiagnosisScope(e.target.value);
                      setCustomSymbolInput('');
                    }
                  }}
                  className={`w-full bg-slate-950 border text-xs rounded-xl px-3 py-2 focus:outline-none cursor-pointer transition-all ${
                    diagnosisScope.startsWith('CATEGORY:')
                      ? 'border-indigo-500 text-indigo-200 font-semibold'
                      : 'border-slate-800 text-slate-300'
                  }`}
                >
                  <option value="" disabled>选择特定板块 (如: 半导体/高股息)...</option>
                  {categories.map((cat) => (
                    <option key={cat.name} value={`CATEGORY:${cat.name}`}>
                      📂 仅诊断【{cat.name}】({cat.count} 只)
                    </option>
                  ))}
                </select>
              </div>

              {/* Single Stock Input or Dropdown Selection */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-400">📌 单股诊断（输入代码或选择股票）：</label>

                <select
                  value={diagnosisScope.startsWith('SINGLE:') && !customSymbolInput ? diagnosisScope : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setDiagnosisScope(e.target.value);
                      setCustomSymbolInput('');
                    }
                  }}
                  className={`w-full bg-slate-950 border text-xs rounded-xl px-3 py-2 focus:outline-none cursor-pointer transition-all ${
                    diagnosisScope.startsWith('SINGLE:') && !customSymbolInput
                      ? 'border-indigo-500 text-indigo-200 font-semibold'
                      : 'border-slate-800 text-slate-300'
                  }`}
                >
                  <option value="" disabled>从现有持仓/自选列表中选择股票...</option>
                  {stockList.map((s) => (
                    <option key={s.symbol} value={`SINGLE:${s.symbol}`}>
                      {s.name} ({s.symbol})
                    </option>
                  ))}
                </select>

                <div className="flex space-x-1.5">
                  <input
                    type="text"
                    placeholder="输入6位代码 (如 600519 或 159213)"
                    value={customSymbolInput}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setCustomSymbolInput(val);
                      if (val.length >= 6) {
                        setDiagnosisScope(`SINGLE:${val}`);
                      }
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  {customSymbolInput.length >= 6 && (
                    <button
                      type="button"
                      onClick={() => setDiagnosisScope(`SINGLE:${customSymbolInput}`)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl"
                    >
                      确定
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleStartFullAnalysis}
            disabled={isGenerating}
            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center space-x-2"
          >
            {isGenerating ? (
              <>
                <Cpu className="w-4 h-4 animate-spin text-white" />
                <span>AI 正在深度诊断中...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>生成{getScopeButtonLabel()}诊断报告</span>
              </>
            )}
          </button>
        </div>

        {/* Model Switcher Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            切换诊断大模型引擎
          </h3>

          <div className="space-y-2">
            {llmConfigs.map((cfg) => (
              <button
                key={cfg.provider_name}
                onClick={() => onSwitchModel(cfg.provider_name)}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                  cfg.is_active
                    ? 'bg-indigo-950/80 border-indigo-500/80 text-white shadow'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold text-xs capitalize flex items-center gap-1.5">
                    <span>{cfg.provider_name}</span>
                    {cfg.has_key && <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded">Key已配</span>}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">{cfg.selected_model}</div>
                </div>
                {cfg.is_active && <CheckCircle2 className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* History Reports */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
          <h3 className="font-bold text-sm text-slate-200 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <History className="w-4 h-4 text-amber-400" />
              历史归档诊断报告
            </span>
            <span className="text-[11px] font-mono text-slate-500">共 {reports.length} 份</span>
          </h3>

          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {reports.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">暂无历史报告</p>
            ) : (
              reports.map((rep) => (
                <div
                  key={rep.id}
                  onClick={() => setSelectedHistoryReport(rep)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all space-y-1.5 ${
                    selectedHistoryReport?.id === rep.id
                      ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 shadow-md ring-1 ring-indigo-500/30'
                      : 'bg-slate-950/80 border-slate-800/80 text-slate-300 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold text-slate-200 truncate flex items-center justify-between gap-1">
                    <span className="truncate">{rep.input_summary || '量化诊断'}</span>
                    <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800 text-indigo-300 border border-slate-700/60 flex-shrink-0">
                      {rep.provider_model}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                    <span>{rep.generated_at}</span>
                    <span className="text-slate-500">#{rep.id}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main Report View Panel (3 cols) */}
      <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-xl overflow-hidden h-[750px]">
        {/* Report Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>{selectedHistoryReport ? `历史诊断归档 (#${selectedHistoryReport.id})` : 'AI 盘后量化诊断报告'}</span>
                {selectedHistoryReport && (
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/40 rounded-full">
                    {selectedHistoryReport.input_summary}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                结合实时行情、技术指标（MA/MACD/KDJ/支撑压力）与量化模型全维度剖析
              </p>
            </div>
          </div>

          {selectedHistoryReport && (
            <button
              onClick={() => setSelectedHistoryReport(null)}
              className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-xl transition-all font-medium flex items-center space-x-1"
            >
              <span>← 返回最新流式视图</span>
            </button>
          )}
        </div>

        {/* Report Body / Markdown Renderer - Spacious canvas, direct flow, no ugly inner boxes */}
        <div className="flex-1 p-6 sm:p-8 overflow-y-auto font-sans leading-relaxed text-slate-200 selection:bg-indigo-900 selection:text-indigo-100">
          {!displayedContent ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-3 py-24">
              <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center shadow-inner">
                <Cpu className="w-8 h-8 text-indigo-400 animate-pulse" />
              </div>
              <p className="text-xs text-slate-400 font-medium">请在左侧选择诊断目标（全仓、持仓或单股），点击【生成诊断报告】</p>
            </div>
          ) : (
            <div className="space-y-4 max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-lg font-extrabold text-slate-100 pb-3 mb-5 border-b border-slate-800 flex items-center gap-2">
                      <span className="w-1.5 h-5 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full inline-block"></span>
                      <span>{children}</span>
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold text-indigo-200 mt-6 mb-3 pt-3 border-t border-slate-800/80 flex items-center gap-2">
                      <span>{children}</span>
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-xs sm:text-sm font-bold text-slate-100 mt-4 mb-2 flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3.5 py-2 rounded-xl text-indigo-300">
                      <span>{children}</span>
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed my-2.5 font-sans">
                      {children}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-indigo-300 bg-indigo-950/80 border border-indigo-800/60 px-1.5 py-0.5 rounded text-[12px] font-mono shadow-sm">
                      {children}
                    </strong>
                  ),
                  ul: ({ children }) => (
                    <ul className="space-y-2 my-3 pl-1">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="text-xs sm:text-sm text-slate-300 flex items-start gap-2.5 leading-relaxed">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0 shadow-sm shadow-indigo-500/50"></span>
                      <div className="flex-1">{children}</div>
                    </li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="bg-indigo-950/40 border-l-4 border-indigo-500 rounded-r-xl p-3.5 text-indigo-200 my-4 text-xs leading-relaxed shadow-sm">
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4 rounded-xl border border-slate-800 bg-slate-950/60 shadow-md">
                      <table className="w-full text-xs text-left text-slate-300 border-collapse">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-slate-950 text-slate-400 font-semibold uppercase border-b border-slate-800">
                      {children}
                    </thead>
                  ),
                  th: ({ children }) => (
                    <th className="px-3.5 py-2.5 border-r border-slate-800/80 last:border-r-0 font-mono text-[11px] text-slate-300">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3.5 py-2 border-r border-slate-800/40 last:border-r-0 border-b border-slate-800/40 font-mono text-slate-300">
                      {children}
                    </td>
                  ),
                  hr: () => <hr className="my-5 border-slate-800/80" />
                }}
              >
                {displayedContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

