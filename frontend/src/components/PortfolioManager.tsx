import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Upload, Trash2, Clipboard, FileText, Check, FolderPlus, Edit3, Layers, ArrowUpDown, ArrowUp, ArrowDown, MoveRight, AlertTriangle, Archive } from 'lucide-react';
import { PositionItem, WatchlistItem } from '../types';
import { AccountFundBar } from './AccountFundBar';

import axios from 'axios';

interface PortfolioManagerProps {
  positions: PositionItem[];
  watchlists: WatchlistItem[];
  onRefresh: () => void;
  onSelectStock: (symbol: string) => void;
}

export const PortfolioManager: React.FC<PortfolioManagerProps> = ({
  positions,
  watchlists,
  onRefresh,
  onSelectStock
}) => {
  const [activeTab, setActiveTab] = useState<'position' | 'cleared' | 'watchlist'>('position');
  const [clearedPositions, setClearedPositions] = useState<PositionItem[]>([]);


  useEffect(() => {
    fetchClearedPositions();
  }, []);

  const fetchClearedPositions = async () => {
    try {
      const res = await axios.get('/api/v1/stocks/positions?status=CLEARED');
      setClearedPositions(res.data || []);
    } catch (err) {
      console.error('Failed to fetch cleared positions:', err);
    }
  };

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Sorting State
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Multi-Select Checkboxes State
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<any[]>([]);
  const [importCategory, setImportCategory] = useState<string>('同花顺板块');
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual Add Form State
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [volume, setVolume] = useState('');
  const [strategyTag, setStrategyTag] = useState('长线持有');
  const [categoryTag, setCategoryTag] = useState('默认自选');

  // Compute Distinct Categories and Counts for Watchlists
  const categoryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    watchlists.forEach((w) => {
      const cat = w.category || '默认自选';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [watchlists]);

  // Filtered Watchlists by Selected Sector Tab
  const filteredWatchlists = useMemo(() => {
    if (selectedCategory === 'ALL') return watchlists;
    return watchlists.filter((w) => (w.category || '默认自选') === selectedCategory);
  }, [watchlists, selectedCategory]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortOrder === 'desc') {
        setSortOrder('asc');
      } else {
        setSortField(null);
        setSortOrder('desc');
      }
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-indigo-400 font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-indigo-400 font-bold" />
    );
  };

  const parsePctChg = (val: string) => {
    if (!val) return 0;
    const cleaned = val.replace('%', '').replace('+', '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  // Sorted Watchlists
  const sortedWatchlists = useMemo(() => {
    let list = [...filteredWatchlists];
    if (!sortField) return list;

    list.sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'pct_chg') {
        valA = parsePctChg(a.pct_chg);
        valB = parsePctChg(b.pct_chg);
      }

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
      return sortOrder === 'asc'
        ? String(valA).localeCompare(String(valB), 'zh-CN')
        : String(valB).localeCompare(String(valA), 'zh-CN');
    });

    return list;
  }, [filteredWatchlists, sortField, sortOrder]);

  // Sorted Positions
  const sortedPositions = useMemo(() => {
    let list = [...positions];
    if (!sortField) return list;

    list.sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'pct_chg') {
        valA = parsePctChg(a.pct_chg);
        valB = parsePctChg(b.pct_chg);
      }

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
      return sortOrder === 'asc'
        ? String(valA).localeCompare(String(valB), 'zh-CN')
        : String(valB).localeCompare(String(valA), 'zh-CN');
    });

    return list;
  }, [positions, sortField, sortOrder]);

  // Pagination State for Positions & Watchlists
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, sortField, sortOrder, selectedCategory, pageSize]);

  const paginatedPositions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedPositions.slice(start, start + pageSize);
  }, [sortedPositions, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedPositions.length / pageSize));
  }, [sortedPositions.length, pageSize]);

  // Checkbox selection helpers
  const currentVisibleItems = activeTab === 'position' ? paginatedPositions : sortedWatchlists;
  const isAllSelected = currentVisibleItems.length > 0 && currentVisibleItems.every((item) => selectedIds.includes(item.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(currentVisibleItems.map((item) => item.id));
    }
  };


  const toggleSelectId = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  // Batch Delete Actions
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`确定要批量删除已选中的 ${selectedIds.length} 项股票/基金吗？`)) return;

    try {
      const endpoint = activeTab === 'position' ? '/api/v1/stocks/positions/batch-delete' : '/api/v1/stocks/watchlists/batch-delete';
      await axios.post(endpoint, { ids: selectedIds });
      setSelectedIds([]);
      onRefresh();
    } catch (err) {
      alert('批量删除失败');
    }
  };

  // Batch Relocate Action
  const handleBatchRelocate = async (targetCategory: string) => {
    if (selectedIds.length === 0 || !targetCategory) return;
    try {
      await axios.post('/api/v1/stocks/watchlists/batch-relocate', {
        ids: selectedIds,
        category: targetCategory
      });
      setSelectedIds([]);
      onRefresh();
    } catch (err) {
      alert('批量划转板块失败');
    }
  };

  // Purge Entire Category (Delete Category AND all its stocks)
  const handlePurgeEntireSector = async (catName: string, count: number) => {
    if (!confirm(`【警告】确定要彻底删除整个板块【${catName}】以及包含的 ${count} 只股票/基金吗？`)) return;
    try {
      await axios.delete(`/api/v1/stocks/categories/${encodeURIComponent(catName)}/purge`);
      if (selectedCategory === catName) {
        setSelectedCategory('ALL');
      }
      setSelectedIds([]);
      onRefresh();
    } catch (err) {
      alert('清空整个板块失败');
    }
  };

  const handleManualAddPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol) return;

    try {
      if (activeTab === 'position') {
        if (!costPrice || !volume) return;
        await axios.post('/api/v1/stocks/positions', {
          symbol,
          name: name || undefined,
          cost_price: parseFloat(costPrice),
          current_volume: parseInt(volume),
          strategy_tag: strategyTag
        });
      } else {
        await axios.post('/api/v1/stocks/watchlists', {
          symbol,
          name: name || undefined,
          category: categoryTag || '默认自选'
        });
      }
      setSymbol('');
      setName('');
      setCostPrice('');
      setVolume('');
      onRefresh();
    } catch (err) {
      alert('添加失败，请检查数据格式');
    }
  };

  const handleDeletePosition = async (id: number) => {
    if (!confirm('确定删除该持仓项吗？')) return;
    try {
      await axios.delete(`/api/v1/stocks/positions/${id}`);
      onRefresh();
    } catch (err) {
      alert('删除失败');
    }
  };

  const handleDeleteWatchlist = async (id: number) => {
    if (!confirm('确定删除该自选股吗？')) return;
    try {
      await axios.delete(`/api/v1/stocks/watchlists/${id}`);
      onRefresh();
    } catch (err) {
      alert('删除失败');
    }
  };

  const handleChangeCategory = async (watchlistId: number, newCategory: string) => {
    try {
      await axios.put(`/api/v1/stocks/watchlists/${watchlistId}/category`, {
        category: newCategory
      });
      onRefresh();
    } catch (err) {
      alert('调整分类失败');
    }
  };

  const handleAddSectorTab = () => {
    const sectorName = prompt('请输入新板块/分类名称（如：半导体龙头、高股息板块）：');
    if (sectorName && sectorName.trim()) {
      setCategoryTag(sectorName.trim());
      setSelectedCategory(sectorName.trim());
    }
  };

  const handleRenameSector = async (oldName: string) => {
    const newName = prompt(`修改板块名称 [${oldName}] 为：`, oldName);
    if (newName && newName.trim() && newName !== oldName) {
      try {
        await axios.put('/api/v1/stocks/categories/rename', {
          old_name: oldName,
          new_name: newName.trim()
        });
        if (selectedCategory === oldName) {
          setSelectedCategory(newName.trim());
        }
        onRefresh();
      } catch (err) {
        alert('重命名板块失败');
      }
    }
  };

  const handleDeleteSectorOnly = async (catName: string) => {
    if (!confirm(`解散板块 [${catName}]：板块下的股票将归入“默认自选”，确定操作吗？`)) return;
    try {
      await axios.delete(`/api/v1/stocks/categories/${encodeURIComponent(catName)}`);
      if (selectedCategory === catName) {
        setSelectedCategory('ALL');
      }
      onRefresh();
    } catch (err) {
      alert('解散板块失败');
    }
  };

  const handleParseText = async () => {
    if (!importText.trim()) return;
    setIsParsing(true);
    try {
      const res = await axios.post('/api/v1/import/parse-text', {
        text: importText,
        target_type: activeTab === 'position' ? 'POSITION' : 'WATCHLIST'
      });
      setParsedPreview(res.data.items || []);
      if (res.data.default_category) {
        setImportCategory(res.data.default_category);
      }
    } catch (err) {
      alert('解析文本失败，请确保格式包含股票代码与名称/数量');
    } finally {
      setIsParsing(false);
    }
  };

  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [parseAttempted, setParseAttempted] = useState<boolean>(false);
  const [importTargetType, setImportTargetType] = useState<'POSITION' | 'CLEARED' | 'WATCHLIST'>('POSITION');


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setIsParsing(true);
    setParseAttempted(true);

    if (file.name.includes('清仓') || file.name.includes('历史持仓')) {
      setImportTargetType('CLEARED');
      setImportCategory('历史清仓');
    } else if (activeTab === 'position') {
      setImportTargetType('POSITION');
      setImportCategory('当前持仓');
    } else if (activeTab === 'cleared') {
      setImportTargetType('CLEARED');
      setImportCategory('历史清仓');
    } else {
      setImportTargetType('WATCHLIST');
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post('/api/v1/import/upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const items = res.data.items || [];
      setParsedPreview(items);
      if (res.data.default_category) {
        setImportCategory(res.data.default_category);
        if (res.data.default_category.includes('清仓') || res.data.default_category.includes('历史持仓')) {
          setImportTargetType('CLEARED');
        }
      }
    } catch (err) {
      alert('解析同花顺导出文件失败，请检查文件格式');
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedPreview.length === 0) return;
    setIsSubmitting(true);
    try {
      await axios.post('/api/v1/import/confirm', {
        target_type: importTargetType,
        items: parsedPreview.map((item) => ({
          ...item,
          target_type: importTargetType,
          category: importCategory || (importTargetType === 'CLEARED' ? '历史清仓' : '同花顺板块')
        }))
      });
      setIsImportModalOpen(false);
      setImportText('');
      setParsedPreview([]);
      onRefresh();
      fetchClearedPositions();
    } catch (err) {
      alert('确认导入失败');
    } finally {
      setIsSubmitting(false);
    }
  };


  const handlePurgeZeroVolume = async () => {
    if (!confirm('确定一键清理所有 0 股空仓股票吗？（清理后持仓列表将仅保留当前有实际份额的有效股票）')) return;
    try {
      const res = await axios.post('/api/v1/stocks/positions/purge-zero-volume');
      alert(`清理完成！已移除 ${res.data.purged_count} 只 0 股空仓记录。`);
      onRefresh();
    } catch (err) {
      alert('清理 0 股空仓记录失败');
    }
  };

  const zeroVolumeCount = useMemo(() => {
    return positions.filter(p => p.current_volume <= 0).length;
  }, [positions]);

  return (
    <div className="space-y-6">
      {/* Account Fund Metrics Bar */}
      <AccountFundBar onRefreshParent={onRefresh} />

      {/* Primary Tab Switcher & Quick Import Banner */}
      <div className="surface-card rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => { setActiveTab('position'); setSortField(null); setSelectedIds([]); }}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'position' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💼 当前持仓 ({positions.length})
          </button>
          <button
            onClick={() => { setActiveTab('cleared'); setSortField(null); setSelectedIds([]); fetchClearedPositions(); }}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'cleared' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📜 历史清仓归档 ({clearedPositions.length})
          </button>
          <button
            onClick={() => { setActiveTab('watchlist'); setSortField(null); setSelectedIds([]); }}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'watchlist' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🌐 板块自选池 ({watchlists.length})
          </button>
        </div>


        <button
          onClick={() => setIsImportModalOpen(true)}
          className="flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all border border-indigo-400/30"
        >
          <Upload className="w-4 h-4 text-white" />
          <span>📥 导入同花顺持仓表 / 板块 (.xls/.htm/.csv)</span>
        </button>

      </div>

      {/* Zero Volume Purge Warning Banner */}
      {activeTab === 'position' && zeroVolumeCount > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-amber-300 shadow-lg">
          <div className="flex items-center space-x-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <span className="font-bold">持仓列表智能诊断：</span>
              <span>检测到当前持仓列表中包含 <strong className="text-amber-200 text-sm font-mono">{zeroVolumeCount}</strong> 只持仓股数为 <strong>0 股</strong> 的已清仓/自选股票。</span>
            </div>
          </div>

          <button
            onClick={handlePurgeZeroVolume}
            className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>一键清理这 {zeroVolumeCount} 只 0 股空仓股票</span>
          </button>
        </div>
      )}


      {/* Flush-Style Sector/Category Tab Bar (Visible when Watchlist active) */}
      {activeTab === 'watchlist' && (
        <div className="surface-card rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setSelectedCategory('ALL'); setSelectedIds([]); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                selectedCategory === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>全部自选</span>
              <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-slate-800 rounded-full text-slate-300">
                {watchlists.length}
              </span>
            </button>

            {categoryStats.map((cat) => (
              <div key={cat.name} className="relative group flex items-center">
                <button
                  onClick={() => { setSelectedCategory(cat.name); setSelectedIds([]); }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                    selectedCategory === cat.name
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <span>{cat.name}</span>
                  <span className="px-1.5 py-0.5 text-[10px] bg-slate-800 rounded-full text-slate-300">
                    {cat.count}
                  </span>
                </button>

                {/* Sector Edit/Delete/Purge Action Buttons */}
                {selectedCategory === cat.name && cat.name !== '默认自选' && (
                  <div className="ml-1.5 flex items-center space-x-1">
                    <button
                      onClick={() => handleRenameSector(cat.name)}
                      title="重命名板块"
                      className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteSectorOnly(cat.name)}
                      title="解散板块 (留存股票到默认自选)"
                      className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg"
                    >
                      <FolderPlus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handlePurgeEntireSector(cat.name, cat.count)}
                      title="彻底删除整个板块及其包含的所有股票"
                      className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleAddSectorTab}
            className="px-3 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
            <span>+ 新增自定义板块</span>
          </button>
        </div>
      )}

      {/* Batch Action Toolbar (Visible when 1 or more checkboxes are checked) */}
      {selectedIds.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 border border-indigo-700/50 rounded-2xl p-3 px-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
              <Check className="w-4 h-4 text-indigo-400" />
              已选中 <strong className="text-white text-sm font-mono">{selectedIds.length}</strong> 项股票/基金
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {activeTab === 'watchlist' && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchRelocate(e.target.value);
                    e.target.value = "";
                  }
                }}
                className="bg-slate-950 border border-indigo-800/80 text-indigo-200 text-xs rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="" disabled>批量划转归属板块...</option>
                {categoryStats.map(c => (
                  <option key={c.name} value={c.name}>划转至【{c.name}】</option>
                ))}
                <option value="默认自选">划转至【默认自选】</option>
              </select>
            )}

            <button
              onClick={handleBatchDelete}
              className="px-4 py-1.5 bg-red-600/90 hover:bg-red-500 text-white font-semibold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>批量删除选中项 ({selectedIds.length})</span>
            </button>

            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 bg-slate-800 text-slate-300 hover:text-white text-xs font-medium rounded-xl border border-slate-700"
            >
              取消全选
            </button>
          </div>
        </div>
      )}

      {/* Main Table & Add Form Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Table View (3 cols) */}
        <div className="surface-card lg:col-span-3 rounded-2xl p-4 sm:p-6">
          {activeTab === 'position' ? (
            <div className="overflow-x-auto rounded-xl border border-slate-800 shadow-inner">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-950 text-[11px] font-semibold text-slate-400 border-b border-slate-800 select-none sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-2 text-center w-8">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                      />
                    </th>
                    <th onClick={() => handleSort('symbol')} className="py-3 px-3 cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center space-x-1">
                        <span>证券代码</span>
                        {renderSortIcon('symbol')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('name')} className="py-3 px-3 cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center space-x-1">
                        <span>证券名称</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('current_volume')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>股票余额</span>
                        {renderSortIcon('current_volume')}
                      </div>
                    </th>
                    <th className="py-3 px-3 text-right">可用余额</th>
                    <th onClick={() => handleSort('cost_price')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>成本价</span>
                        {renderSortIcon('cost_price')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>市价</span>
                        {renderSortIcon('current_price')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('profit_loss')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>盈亏</span>
                        {renderSortIcon('profit_loss')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('profit_ratio')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>盈亏比例(%)</span>
                        {renderSortIcon('profit_ratio')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('today_profit_loss')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>当日盈亏</span>
                        {renderSortIcon('today_profit_loss')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('today_profit_loss_ratio')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>当日盈亏比(%)</span>
                        {renderSortIcon('today_profit_loss_ratio')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('market_value')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>市值</span>
                        {renderSortIcon('market_value')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('position_weight')} className="py-3 px-3 text-right cursor-pointer hover:text-indigo-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>仓位占比(%)</span>
                        {renderSortIcon('position_weight')}
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center">交易市场</th>
                    <th className="py-3 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-mono text-[12px]">
                  {paginatedPositions.map((pos) => {
                    const isProfit = pos.profit_loss >= 0;
                    const isTodayProfit = (pos.today_profit_loss || 0) >= 0;
                    return (
                      <tr key={pos.id} className={`hover:bg-slate-800/60 transition-colors ${selectedIds.includes(pos.id) ? 'bg-indigo-950/40' : ''}`}>
                        <td className="py-3 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(pos.id)}
                            onChange={() => toggleSelectId(pos.id)}
                            className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 text-slate-300 font-semibold">{pos.symbol}</td>
                        <td
                          onClick={() => onSelectStock(pos.symbol)}
                          className="py-3 px-3 font-sans font-bold text-slate-100 hover:text-indigo-400 cursor-pointer flex items-center space-x-1.5"
                        >
                          <span>{pos.name}</span>
                          {(pos.symbol.startsWith('5') || pos.symbol.startsWith('1') || pos.name.includes('ETF') || pos.name.includes('基金')) && (
                            <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/50 rounded">
                              ETF
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right text-slate-200">{pos.current_volume}</td>
                        <td className="py-3 px-3 text-right text-slate-300">{pos.available_volume ?? pos.current_volume}</td>
                        <td className="py-3 px-3 text-right text-slate-300">{pos.cost_price?.toFixed(3)}</td>
                        <td className="py-3 px-3 text-right font-bold text-slate-100">{pos.current_price?.toFixed(3)}</td>
                        <td className={`py-3 px-3 text-right font-bold ${isProfit ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isProfit ? '+' : ''}{pos.profit_loss?.toFixed(2)}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${isProfit ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isProfit ? '+' : ''}{pos.profit_ratio?.toFixed(2)}%
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${isTodayProfit ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isTodayProfit ? '+' : ''}{pos.today_profit_loss?.toFixed(2)}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${isTodayProfit ? 'text-red-400' : 'text-emerald-400'}`}>
                          {isTodayProfit ? '+' : ''}{pos.today_profit_loss_ratio?.toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-100">{pos.market_value?.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-semibold text-indigo-300">{pos.position_weight?.toFixed(2)}%</td>
                        <td className="py-3 px-3 text-center font-sans text-xs text-slate-400">{pos.market_name || (pos.symbol.startsWith('6') ? '上海A股' : '深圳A股')}</td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => handleDeletePosition(pos.id)}
                            className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                            title="删除持仓"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Physical Pagination Bar */}
              <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 select-none">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    显示第 <strong className="text-slate-200 font-mono">{sortedPositions.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}</strong> 到 <strong className="text-slate-200 font-mono">{Math.min(currentPage * pageSize, sortedPositions.length)}</strong> 条，共 <strong className="text-indigo-400 font-mono">{sortedPositions.length}</strong> 只股票
                  </span>
                  <div className="flex items-center space-x-1.5 border-l border-slate-800 pl-3">
                    <span>每页显示：</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                    >
                      <option value={15}>15 条/页</option>
                      <option value={30}>30 条/页</option>
                      <option value={50}>50 条/页</option>
                      <option value={100}>100 条/页</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:hover:bg-slate-950 rounded text-slate-300 font-medium transition-colors"
                  >
                    首页
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:hover:bg-slate-950 rounded text-slate-300 font-medium transition-colors"
                  >
                    上一页
                  </button>
                  
                  <div className="px-3 py-1 font-mono text-slate-300 flex items-center space-x-1">
                    <span className="text-indigo-400 font-bold">{currentPage}</span>
                    <span>/</span>
                    <span>{totalPages}</span>
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:hover:bg-slate-950 rounded text-slate-300 font-medium transition-colors"
                  >
                    下一页
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:hover:bg-slate-950 rounded text-slate-300 font-medium transition-colors"
                  >
                    末页
                  </button>
                </div>
              </div>
            </div>


          ) : activeTab === 'cleared' ? (
            <div className="overflow-x-auto space-y-4">
              {/* Top Performance Summary Banner for Cleared Stocks */}
              <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/60 border border-purple-800/40 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 shadow-lg">
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
                  <div className="text-[11px] text-slate-400">已清仓标的总数</div>
                  <div className="text-lg font-bold font-mono text-purple-300 mt-1">{clearedPositions.length} 只</div>
                </div>
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
                  <div className="text-[11px] text-slate-400">盈利 / 亏损 标的数</div>
                  <div className="text-sm font-semibold font-mono text-slate-200 mt-1 flex items-center space-x-2">
                    <span className="text-red-400">盈利 {clearedPositions.filter(p => (p.profit_loss || 0) >= 0).length}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-emerald-400">亏损 {clearedPositions.filter(p => (p.profit_loss || 0) < 0).length}</span>
                  </div>
                </div>
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
                  <div className="text-[11px] text-slate-400">清仓胜率</div>
                  <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                    {clearedPositions.length > 0
                      ? `${((clearedPositions.filter(p => (p.profit_loss || 0) >= 0).length / clearedPositions.length) * 100).toFixed(1)}%`
                      : '0.0%'}
                  </div>
                </div>
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
                  <div className="text-[11px] text-slate-400">清仓累计实现盈亏</div>
                  <div className={`text-lg font-bold font-mono mt-1 ${
                    clearedPositions.reduce((acc, p) => acc + (p.profit_loss || 0), 0) >= 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {clearedPositions.reduce((acc, p) => acc + (p.profit_loss || 0), 0) >= 0 ? '+' : ''}
                    ¥{clearedPositions.reduce((acc, p) => acc + (p.profit_loss || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-purple-300 font-medium flex items-center space-x-1.5">
                  <Archive className="w-4 h-4 text-purple-400" />
                  <span>历史清仓战绩归档明细（共 {clearedPositions.length} 只已清仓股票）</span>
                </div>
                {clearedPositions.length > 0 && (
                  <button
                    onClick={handlePurgeZeroVolume}
                    className="px-3 py-1 bg-red-950/80 hover:bg-red-900 border border-red-800/60 text-red-300 text-xs font-semibold rounded-xl flex items-center space-x-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>清空全部 {clearedPositions.length} 条清仓归档</span>
                  </button>
                )}
              </div>
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800 select-none">
                  <tr>
                    <th className="py-3 px-4">股票/基金名称与代码</th>
                    <th className="py-3 px-4 text-right">买入成本</th>
                    <th className="py-3 px-4 text-right">卖出/市价</th>
                    <th className="py-3 px-4 text-right">最终盈亏</th>
                    <th className="py-3 px-4 text-center">状态</th>
                    <th className="py-3 px-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {clearedPositions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500 font-sans">
                        暂无历史清仓归档记录
                      </td>
                    </tr>
                  ) : (
                    clearedPositions.map((pos) => {
                      const pnl = pos.profit_loss || 0;
                      const isWin = pnl >= 0;
                      return (
                        <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4 font-sans">
                            <div
                              onClick={() => onSelectStock(pos.symbol)}
                              className="font-bold text-slate-100 hover:text-indigo-400 cursor-pointer flex items-center space-x-2"
                            >
                              <span>{pos.name}</span>
                              {pos.symbol.startsWith('15') || pos.symbol.startsWith('51') ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/50 rounded-md">
                                  ETF基金
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-800 text-slate-400 rounded-md">
                                  A股股票
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-slate-400">{pos.symbol}</div>
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-300">
                            ¥{pos.cost_price?.toFixed(3)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-semibold text-slate-100">
                            ¥{pos.current_price?.toFixed(3)}
                          </td>
                          <td className={`py-3.5 px-4 text-right font-bold ${isWin ? 'text-red-400' : 'text-emerald-400'}`}>
                            {isWin ? '+' : ''}¥{pnl.toFixed(2)}
                          </td>
                          <td className="py-3.5 px-4 text-center font-sans">
                            <span className="px-2.5 py-1 text-[11px] rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/50 font-medium">
                              已清仓 (0 股)
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <button
                              onClick={() => handleDeletePosition(pos.id)}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                              title="删除清仓归档"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800 select-none">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                      />
                    </th>
                    <th onClick={() => handleSort('name')} className="py-3 px-4 cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center space-x-1">
                        <span>股票/基金名称与代码</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('category')} className="py-3 px-4 text-center cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-center space-x-1">
                        <span>所属同花顺板块</span>
                        {renderSortIcon('category')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>最新股价/净值</span>
                        {renderSortIcon('current_price')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('pct_chg')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>今日涨跌幅</span>
                        {renderSortIcon('pct_chg')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('ma_trend')} className="py-3 px-4 text-center cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-center space-x-1">
                        <span>均线形态</span>
                        {renderSortIcon('ma_trend')}
                      </div>
                    </th>
                    <th className="py-3 px-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {sortedWatchlists.map((w) => (
                    <tr key={w.id} className={`hover:bg-slate-800/50 transition-colors ${selectedIds.includes(w.id) ? 'bg-indigo-950/30' : ''}`}>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(w.id)}
                          onChange={() => toggleSelectId(w.id)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td
                        onClick={() => onSelectStock(w.symbol)}
                        className="py-3.5 px-4 font-medium text-slate-100 cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-100">{w.name}</span>
                          {(w.symbol.startsWith('5') || w.symbol.startsWith('1') || w.name.includes('ETF') || w.name.includes('基金')) ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/50 rounded-md">
                              ETF基金
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-800 text-slate-400 rounded-md">
                              A股股票
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-400">{w.symbol}</div>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {/* Interactive Sector Badge with Relocation Selector */}
                        <select
                          value={w.category || '默认自选'}
                          onChange={(e) => handleChangeCategory(w.id, e.target.value)}
                          className="bg-indigo-950/80 text-indigo-300 border border-indigo-800/50 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value={w.category}>{w.category}</option>
                          {categoryStats.filter(c => c.name !== w.category).map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                          <option value="默认自选">默认自选</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-100">
                        ¥{w.current_price?.toFixed(w.current_price && w.current_price < 10 ? 3 : 2)}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-mono font-semibold ${w.pct_chg.startsWith('+') ? 'text-red-400' : (w.pct_chg.startsWith('-') ? 'text-emerald-400' : 'text-slate-300')}`}>
                        {w.pct_chg}
                      </td>
                      <td className="py-3.5 px-4 text-center text-xs text-slate-300">
                        {w.ma_trend}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleDeleteWatchlist(w.id)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Manual Add Card (1 col) */}
        <div className="surface-card rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-400" />
            {activeTab === 'position' ? '手动新增持仓股' : '手动新增自选股'}
          </h3>

          <form onSubmit={handleManualAddPosition} className="space-y-3.5">
            <div>
              <label className="block text-xs text-slate-400 mb-1">股票/ETF代码 (6位代码)</label>
              <input
                type="text"
                placeholder="如: 600519 或 510300"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">名称 (可选)</label>
              <input
                type="text"
                placeholder="如: 贵州茅台 或 沪深300ETF"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {activeTab === 'position' ? (
              <>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">买入成本均价 (元)</label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="1650.0 或 4.68"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">持仓数量 (股/份)</label>
                  <input
                    type="number"
                    placeholder="100 或 1000"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">策略分类</label>
                  <select
                    value={strategyTag}
                    onChange={(e) => setStrategyTag(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="长线持有">长线持有</option>
                    <option value="短线高吸">短线高吸</option>
                    <option value="深套做T">深套做T</option>
                    <option value="观察池">观察池</option>
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs text-slate-400 mb-1">归属板块分类</label>
                <input
                  type="text"
                  placeholder="如: 半导体 / 高股息 / 默认自选"
                  value={categoryTag}
                  onChange={(e) => setCategoryTag(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1"
            >
              <Plus className="w-4 h-4" />
              <span>保存项</span>
            </button>
          </form>
        </div>
      </div>

      {/* Flush Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="surface-card rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Clipboard className="w-5 h-5 text-indigo-400" />
                <span>同花顺板块 / 历史持仓表快速导入</span>
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                请选择上传同花顺导出的<strong>历史/当前持仓表</strong>或自选股文件 (支持 <strong>.xls / .xlsx / .htm / .csv / .sel / .txt</strong>)：
              </p>

              <textarea
                rows={4}
                placeholder="或直接粘贴同花顺持仓/自选数据，格式如：&#10;600519 贵州茅台 100 1650.50&#10;510300 沪深300ETF 1000 4.68"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
              />

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <label className="w-full sm:w-auto cursor-pointer px-4 py-2.5 bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-md">
                  <Upload className="w-4 h-4 text-indigo-400" />
                  <span>
                    {isParsing
                      ? `🔄 正在解析 ${selectedFileName}...`
                      : selectedFileName
                      ? `📄 已选择: ${selectedFileName} (点击重新选择)`
                      : '选择同花顺持仓/板块文件 (.xls/.xlsx/.htm/.csv)'}
                  </span>
                  <input
                    type="file"
                    accept=".xls,.xlsx,.htm,.html,.csv,.txt,.sel"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={handleParseText}
                  disabled={isParsing || !importText.trim()}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 flex items-center justify-center space-x-1.5"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>{isParsing ? '解析中...' : '解析文本预览'}</span>
                </button>
              </div>

              {parseAttempted && !isParsing && parsedPreview.length === 0 && (
                <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-xs text-amber-300 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-0.5">文件 [{selectedFileName}] 未能直接识别出有效持仓股票</div>
                    <div className="text-[11px] text-amber-400/90 leading-relaxed">
                      💡 极速解决方案：您可以直接用 Excel/记事本打开该文件全选内容复制（Ctrl+A / Ctrl+C），粘贴至上方框中，点击【解析文本预览】即可 100% 提取！
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Target Category & Type Selector */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-900 pb-2">
                <label className="text-xs font-bold text-slate-200">选择数据导入目标分类：</label>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center space-x-1 cursor-pointer text-indigo-300">
                    <input
                      type="radio"
                      name="targetType"
                      value="POSITION"
                      checked={importTargetType === 'POSITION'}
                      onChange={() => setImportTargetType('POSITION')}
                      className="text-indigo-600 focus:ring-0"
                    />
                    <span>💼 当前持仓 (自动对齐清仓)</span>
                  </label>

                  <label className="flex items-center space-x-1 cursor-pointer text-purple-300">
                    <input
                      type="radio"
                      name="targetType"
                      value="CLEARED"
                      checked={importTargetType === 'CLEARED'}
                      onChange={() => setImportTargetType('CLEARED')}
                      className="text-purple-600 focus:ring-0"
                    />
                    <span>📜 历史清仓归档</span>
                  </label>

                  <label className="flex items-center space-x-1 cursor-pointer text-slate-300">
                    <input
                      type="radio"
                      name="targetType"
                      value="WATCHLIST"
                      checked={importTargetType === 'WATCHLIST'}
                      onChange={() => setImportTargetType('WATCHLIST')}
                      className="text-indigo-600 focus:ring-0"
                    />
                    <span>🌐 板块自选池</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-400">板块/分组标签名称：</label>
                <input
                  type="text"
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                  placeholder="如: 当前持仓 / 历史清仓 / 热门板块"
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>
            </div>


            {/* Parsed Preview Table */}
            {parsedPreview.length > 0 && (
              <div className="space-y-3 border-t border-slate-800 pt-3">
                <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>已识别 ({parsedPreview.length} 项持仓/自选股票):</span>
                  <span className="text-[11px] text-emerald-400">一键同步至系统数据库</span>
                </h4>
                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 p-2">
                  <table className="w-full text-xs text-slate-300 text-left">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-800">
                        <th className="py-1.5 px-2">代码</th>
                        <th className="py-1.5 px-2">名称</th>
                        <th className="py-1.5 px-2 text-right">持仓股数</th>
                        <th className="py-1.5 px-2 text-right">持仓成本价</th>
                        <th className="py-1.5 px-2 text-right">浮动盈亏</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedPreview.map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-900 hover:bg-slate-900/60">
                          <td className="py-1.5 px-2 font-mono text-indigo-300">{item.symbol}</td>
                          <td className="py-1.5 px-2 font-bold text-slate-100">{item.name}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-slate-200">
                            {item.current_volume ? item.current_volume.toLocaleString() : '-'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-slate-200">
                            {item.cost_price ? `¥${item.cost_price.toFixed(2)}` : '-'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono font-bold ${
                            item.profit_loss > 0 ? 'text-red-400' : (item.profit_loss < 0 ? 'text-emerald-400' : 'text-slate-400')
                          }`}>
                            {item.profit_loss ? `¥${item.profit_loss.toLocaleString()}` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                  <button
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={isSubmitting}
                    className="px-5 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-500 shadow-md flex items-center space-x-1"
                  >
                    <Check className="w-4 h-4" />
                    <span>确认同步这 {parsedPreview.length} 项至系统</span>
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
