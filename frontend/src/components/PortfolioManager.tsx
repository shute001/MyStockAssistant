import React, { useState, useMemo } from 'react';
import { Plus, Upload, Trash2, Clipboard, FileText, Check, FolderPlus, Edit3, Layers, ArrowUpDown, ArrowUp, ArrowDown, MoveRight, AlertTriangle } from 'lucide-react';
import { PositionItem, WatchlistItem } from '../types';
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
  const [activeTab, setActiveTab] = useState<'position' | 'watchlist'>('position');
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

  // Checkbox selection helpers
  const currentVisibleItems = activeTab === 'position' ? sortedPositions : sortedWatchlists;
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setIsParsing(true);
    setParseAttempted(true);
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
        items: parsedPreview.map((item) => ({
          ...item,
          target_type: activeTab === 'position' ? 'POSITION' : 'WATCHLIST',
          category: importCategory || '同花顺板块'
        }))
      });
      setIsImportModalOpen(false);
      setImportText('');
      setParsedPreview([]);
      onRefresh();
    } catch (err) {
      alert('确认导入失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Primary Tab Switcher & Quick Import Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => { setActiveTab('position'); setSortField(null); setSelectedIds([]); }}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'position' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            我的持仓股 ({positions.length})
          </button>
          <button
            onClick={() => { setActiveTab('watchlist'); setSortField(null); setSelectedIds([]); }}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'watchlist' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            板块自选池 ({watchlists.length})
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

      {/* Flush-Style Sector/Category Tab Bar (Visible when Watchlist active) */}
      {activeTab === 'watchlist' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
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
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-6">
          {activeTab === 'position' ? (
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
                        <span>股票名称/代码</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('cost_price')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>持仓成本</span>
                        {renderSortIcon('cost_price')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('current_volume')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>持仓数量</span>
                        {renderSortIcon('current_volume')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>最新行情</span>
                        {renderSortIcon('current_price')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('profit_loss')} className="py-3 px-4 text-right cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-end space-x-1">
                        <span>持仓盈亏</span>
                        {renderSortIcon('profit_loss')}
                      </div>
                    </th>
                    <th onClick={() => handleSort('strategy_tag')} className="py-3 px-4 text-center cursor-pointer hover:text-indigo-400 transition-colors">
                      <div className="flex items-center justify-center space-x-1">
                        <span>策略标签</span>
                        {renderSortIcon('strategy_tag')}
                      </div>
                    </th>
                    <th className="py-3 px-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {sortedPositions.map((pos) => (
                    <tr key={pos.id} className={`hover:bg-slate-800/50 transition-colors ${selectedIds.includes(pos.id) ? 'bg-indigo-950/30' : ''}`}>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(pos.id)}
                          onChange={() => toggleSelectId(pos.id)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td
                        onClick={() => onSelectStock(pos.symbol)}
                        className="py-3.5 px-4 font-medium text-slate-100 cursor-pointer"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-100">{pos.name}</span>
                          {(pos.symbol.startsWith('5') || pos.symbol.startsWith('1') || pos.name.includes('ETF') || pos.name.includes('基金')) ? (
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
                      <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                        ¥{pos.cost_price?.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                        {pos.current_volume} 股
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-100">
                        ¥{pos.current_price?.toFixed(2)}
                      </td>
                      <td className={`py-3.5 px-4 text-right font-mono font-bold ${pos.profit_loss >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {pos.profit_loss >= 0 ? '+' : ''}¥{pos.profit_loss?.toFixed(2)} ({pos.profit_ratio?.toFixed(2)}%)
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2.5 py-1 text-xs rounded-full bg-slate-800 text-indigo-300 font-medium">
                          {pos.strategy_tag}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleDeletePosition(pos.id)}
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl">
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

            {/* Target Category Selector */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">导入后归入目标板块/类型：</label>
              <input
                type="text"
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
                placeholder="如: 同花顺自选 / 持仓股票"
                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-medium"
              />
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
