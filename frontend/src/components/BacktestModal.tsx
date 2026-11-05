import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { 
  X, Play, ShieldAlert, TrendingUp, TrendingDown, Award, 
  BarChart2, Zap, Layers, Activity, AlertTriangle, CheckCircle2,
  Filter, HelpCircle, DollarSign, Calendar, ChevronDown, ChevronUp,
  Percent, ArrowUpRight, ArrowDownRight, RefreshCw, Scale, Search, Eye, Brain,
  Sliders, Download, Grid, PieChart, Sparkles, Check
} from 'lucide-react';
import axios from 'axios';
import { BacktestStrategyItem, BacktestPoolItem, BacktestResult, BacktestTradeItem, KLineRecord, AIOptimizeResult } from '../types';

interface BacktestModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStrategyId?: string;
}

const DEFAULT_STRATEGIES: BacktestStrategyItem[] = [
  {
    id: 'WEEKLY_MA5_KDJ21',
    name: '周线MA5+KDJ(21)低位金叉波段战法',
    tier: '📈 中线波段',
    description: 'KDJ(21,3,3)在50以下低位金叉，且连续2周站稳5周均线；跌破5周均线(敏捷波段止盈)或跌破10周生命线(底线止损)离场。',
    default_params: {}
  },
  {
    id: 'SEPA_PIVOT_BREAKOUT',
    name: '米勒维尼 SEPA / 欧奈尔 VCP 枢轴临界突破战法',
    tier: '⚡ 短线交易',
    description: '前期窄幅波动收敛后首日放量突破20日箱体高点(量比>1.4x，涨幅+1.8%~+5.0%)；硬止损3.5%，目标+12%或破MA10止盈。',
    default_params: {}
  },
  {
    id: 'TREND_SURFING_MOMENTUM',
    name: '均线推土机顺势慢牛战法',
    tier: '📈 中线波段',
    description: 'MA5>MA10>MA20多头顺势爬坡，价格贴合短期均线(乖离率<3.0%)右侧建仓；跌破MA10或跌幅达5%纪律止损离场。',
    default_params: {}
  },
  {
    id: 'MA520_GOLDEN_CROSS',
    name: '520 经典均线趋势战法',
    tier: '📈 中线波段',
    description: 'MA5上穿MA20金叉且MA20趋势向上进场；收盘有效击破MA20生命线离场。',
    default_params: {}
  }
];

const DEFAULT_POOLS: BacktestPoolItem[] = [
  { id: 'WATCHLIST', name: '用户自选重点池 (精选前20只高优)' },
  { id: 'POSITIONS', name: '用户现有实盘持仓池 (当前在持标的)' },
  { id: 'CSI300_CORE', name: '沪深300核心权重白马池 (20只核心龙头)' },
  { id: 'TECH_LEADERS', name: '自主可控成长龙头池 (15只核心标的)' },
  { id: 'ETF_CORE', name: '核心宽基与行业ETF池 (10只核心ETF)' }
];

export const BacktestModal: React.FC<BacktestModalProps> = ({
  isOpen,
  onClose,
  initialStrategyId = 'WEEKLY_MA5_KDJ21'
}) => {
  // Pre-seed with robust default strategies and pools so the UI is NEVER blank
  const [strategies, setStrategies] = useState<BacktestStrategyItem[]>(DEFAULT_STRATEGIES);
  const [pools, setPools] = useState<BacktestPoolItem[]>(DEFAULT_POOLS);
  
  // Selection states
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(initialStrategyId);
  const [targetType, setTargetType] = useState<'POOL' | 'SINGLE'>('SINGLE');
  const [selectedPoolId, setSelectedPoolId] = useState<string>('WATCHLIST');
  const [singleSymbol, setSingleSymbol] = useState<string>('600519');
  const [days, setDays] = useState<number>(500); // 2 years
  const [timeMode, setTimeMode] = useState<'PRESET' | 'CUSTOM_RANGE'>('PRESET');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  // Advanced Strategy Parameters & Friction
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [commissionRate, setCommissionRate] = useState<number>(0.00025);
  const [stampDutyRate, setStampDutyRate] = useState<number>(0.0005);
  const [slippageRate, setSlippageRate] = useState<number>(0.0010);
  
  // Strategy specific tuning parameters
  const [hardStopLossPct, setHardStopLossPct] = useState<number>(0.07);
  const [targetProfitPct, setTargetProfitPct] = useState<number>(0.15);
  const [maxPositions, setMaxPositions] = useState<number>(5);

  // Execution states
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [tradeSearchText, setTradeSearchText] = useState<string>('');

  // AI Parameter Optimization states
  const [aiOptimizeResult, setAiOptimizeResult] = useState<AIOptimizeResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);

  // Mainstream Tab Views: 'OVERVIEW' | 'KLINE' | 'HEATMAP' | 'DISTRIBUTION' | 'TRADES' | 'PARAMS'
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'KLINE' | 'HEATMAP' | 'DISTRIBUTION' | 'TRADES' | 'PARAMS'>('OVERVIEW');

  // Selected Symbol for K-Line visualization
  const [activeChartSymbol, setActiveChartSymbol] = useState<string>('');
  const [klineRecords, setKlineRecords] = useState<KLineRecord[]>([]);
  const [isLoadingKline, setIsLoadingKline] = useState<boolean>(false);
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);

  const hasAutoRunRef = useRef<boolean>(false);

  const currentStrategy = strategies.find(s => s.id === selectedStrategyId) || strategies[0];

  const executeBacktest = async (overrideParams?: any) => {
    setIsRunning(true);
    setError(null);

    const isParamObject = overrideParams && !overrideParams.nativeEvent && typeof overrideParams === 'object';
    const params = isParamObject ? overrideParams : {};
    const sl = params.hard_stop_loss_pct ?? hardStopLossPct;
    const tp = params.target_profit_pct ?? targetProfitPct;
    const mp = params.max_positions ?? maxPositions;

    try {
      const payload = {
        strategy_id: selectedStrategyId,
        target_type: targetType,
        symbol: targetType === 'SINGLE' ? singleSymbol.trim() : null,
        pool_type: targetType === 'POOL' ? selectedPoolId : null,
        days: days,
        start_date: timeMode === 'CUSTOM_RANGE' && startDate ? startDate : null,
        end_date: timeMode === 'CUSTOM_RANGE' && endDate ? endDate : null,
        initial_capital: initialCapital,
        commission_rate: commissionRate,
        stamp_duty_rate: stampDutyRate,
        slippage_rate: slippageRate,
        custom_params: {
          hard_stop_loss_pct: sl,
          target_profit_pct: tp,
          max_positions: mp
        }
      };

      const res = await axios.post('/api/v1/backtest/run', payload);
      setResult(res.data);
    } catch (err: any) {
      let msg = err.response?.data?.detail || err.message || '回测执行失败，请确认后端服务已运行';
      if (msg === 'Network Error' || (typeof msg === 'string' && msg.includes('Network Error'))) {
        msg = '与后端服务通信失败 (Network Error)。请确认后端服务终端 (FastAPI http://127.0.0.1:8000) 正在运行，如已关闭请通过 py start.py 重新启动，然后点击“重试”。';
      }
      setError(msg);
    } finally {
      setIsRunning(false);
    }
  };

  const handleAIOptimize = async () => {
    if (!result) return;
    setIsOptimizing(true);
    try {
      const payload = {
        strategy_id: result.strategy_id,
        strategy_name: result.strategy_name,
        test_days: result.test_days,
        total_return_pct: result.total_return_pct,
        cagr: result.annualized_return_pct,
        benchmark_return_pct: result.benchmark_return_pct,
        excess_return_pct: result.alpha_pct,
        win_rate: result.win_rate,
        profit_loss_ratio: result.profit_loss_ratio,
        profit_factor: result.profit_factor || 0,
        max_drawdown: result.max_drawdown_pct,
        sharpe_ratio: result.sharpe_ratio,
        sortino_ratio: result.sortino_ratio || 0,
        total_trades: result.total_trades,
        current_params: {
          hard_stop_loss_pct: hardStopLossPct,
          target_profit_pct: targetProfitPct,
          max_positions: maxPositions
        },
        trades: result.trades.slice(0, 10)
      };

      const res = await axios.post('/api/v1/backtest/ai-optimize', payload);
      setAiOptimizeResult(res.data);
      setActiveTab('PARAMS');
    } catch (err: any) {
      console.error('AI optimize error:', err);
      alert('AI 诊断失败，请检查后端运行状态');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApplyAIOptimization = () => {
    if (!aiOptimizeResult?.recommended_params) return;
    const { hard_stop_loss_pct, target_profit_pct, max_positions } = aiOptimizeResult.recommended_params;
    setHardStopLossPct(hard_stop_loss_pct);
    setTargetProfitPct(target_profit_pct);
    setMaxPositions(max_positions);

    executeBacktest({
      hard_stop_loss_pct,
      target_profit_pct,
      max_positions
    });
  };

  useEffect(() => {
    if (!isOpen) {
      hasAutoRunRef.current = false;
      return;
    }

    // Fetch live strategy list and preset pools from backend if available
    const fetchData = async () => {
      try {
        const [stratRes, poolRes] = await Promise.all([
          axios.get('/api/v1/backtest/strategies'),
          axios.get('/api/v1/backtest/pools')
        ]);
        if (stratRes.data?.status === 'success' && stratRes.data.strategies?.length > 0) {
          setStrategies(stratRes.data.strategies);
        }
        if (poolRes.data?.status === 'success' && poolRes.data.pools?.length > 0) {
          setPools(poolRes.data.pools);
        }
      } catch (err: any) {
        console.warn('Backend strategies endpoint not reachable or pending restart, using default strategies:', err);
      }
    };

    fetchData();


  }, [isOpen]);

  // When backtest completes, default to first symbol with trades
  useEffect(() => {
    if (result && result.trades.length > 0) {
      const firstSym = result.symbols_with_trades?.[0]?.symbol || result.trades[0].symbol;
      setActiveChartSymbol(firstSym);
    }
  }, [result]);

  // Fetch K-line data for activeChartSymbol
  useEffect(() => {
    if (!activeChartSymbol) return;

    const fetchKline = async () => {
      setIsLoadingKline(true);
      try {
        const res = await axios.get(`/api/v1/stocks/${activeChartSymbol}/kline`, {
          params: {
            days: Math.min(Math.max(days + 40, 250), 1000),
            period: 'day'
          }
        });
        setKlineRecords(res.data || []);
      } catch (err) {
        console.error('Failed to fetch stock kline for chart:', err);
      } finally {
        setIsLoadingKline(false);
      }
    };

    fetchKline();
  }, [activeChartSymbol, days]);

  const filteredTrades = (result?.trades || []).filter(t => {
    if (tradeFilter === 'WIN' && t.net_profit <= 0) return false;
    if (tradeFilter === 'LOSS' && t.net_profit > 0) return false;
    if (tradeSearchText.trim()) {
      const q = tradeSearchText.trim().toLowerCase();
      return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || (t.exit_reason && t.exit_reason.toLowerCase().includes(q));
    }
    return true;
  });

  const activeStockTrades = result?.trades.filter(t => t.symbol === activeChartSymbol) || [];

  const handleFocusTrade = (trade: BacktestTradeItem) => {
    setActiveChartSymbol(trade.symbol);
    setSelectedTradeId(trade.trade_id);
    setActiveTab('KLINE');
  };

  // Export trade log to CSV
  const handleExportCSV = () => {
    if (!result || !result.trades || result.trades.length === 0) return;
    const headers = ['交易序号', '股票代码', '股票名称', '买入日期', '买入价', '买入信号', '卖出日期', '卖出价', '持股天数', '净收益率%', '净盈亏金额', '离场触发原因', '摩擦费用'];
    const rows = result.trades.map(t => [
      t.trade_id,
      t.symbol,
      `"${t.name}"`,
      t.buy_date,
      t.buy_price,
      `"${t.entry_signal || ''}"`,
      t.sell_date,
      t.sell_price,
      t.holding_days,
      t.return_pct,
      t.net_profit,
      `"${t.exit_reason || ''}"`,
      t.total_fee
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${result.strategy_name}_量化回测明细_${days}天.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Build Multi-layer Equity Chart (Upper NAV + Lower Underwater Drawdown)
  const equityChartOption = useMemo(() => {
    if (!result || !result.equity_curve || result.equity_curve.length < 2) return {};

    const dates = result.equity_curve.map(p => p.date);
    const stratValues = result.equity_curve.map(p => p.equity);
    const benchValues = result.equity_curve.map(p => p.benchmark);
    const drawdowns = result.equity_curve.map(p => p.drawdown_pct);

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#6366F1', width: 1, type: 'dashed' } },
        backgroundColor: '#0F172A',
        borderColor: '#334155',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return '';
          const idx = params[0].dataIndex;
          const p = result.equity_curve[idx];
          if (!p) return '';
          const stratGain = ((p.equity - result.initial_capital) / result.initial_capital * 100).toFixed(2);
          const benchGain = ((p.benchmark - result.initial_capital) / result.initial_capital * 100).toFixed(2);
          return `
            <div style="font-size:11px;padding:3px">
              <div style="font-weight:bold;color:#94A3B8;border-bottom:1px solid #334155;padding-bottom:3px;margin-bottom:4px">${p.date}</div>
              <div>策略净值: <span style="font-weight:bold;color:#818CF8;font-family:monospace">¥${p.equity.toLocaleString()} (${Number(stratGain) >= 0 ? '+' : ''}${stratGain}%)</span></div>
              <div>基准持有: <span style="font-family:monospace;color:#94A3B8">¥${p.benchmark.toLocaleString()} (${Number(benchGain) >= 0 ? '+' : ''}${benchGain}%)</span></div>
              <div>当前回撤: <span style="font-family:monospace;color:#34D399">${p.drawdown_pct.toFixed(2)}%</span></div>
              <div>可用现金: <span style="font-family:monospace;color:#CBD5E1">¥${p.cash.toLocaleString()}</span> | 持股: ${p.position_count}只</div>
            </div>
          `;
        }
      },
      legend: {
        data: ['策略净值资产', '标的买入持有基准', '水下动态回撤%'],
        textStyle: { color: '#94A3B8', fontSize: 11 },
        top: 0
      },
      grid: [
        { left: '5%', right: '3%', top: '8%', height: '58%' },
        { left: '5%', right: '3%', top: '74%', height: '20%' }
      ],
      xAxis: [
        { 
          type: 'category', 
          data: dates, 
          gridIndex: 0, 
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { color: '#64748B', fontSize: 10 }
        },
        { 
          type: 'category', 
          data: dates, 
          gridIndex: 1, 
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { show: false }
        }
      ],
      yAxis: [
        { 
          scale: true, 
          gridIndex: 0, 
          splitLine: { lineStyle: { color: '#1E293B' } }, 
          axisLabel: { color: '#64748B', fontSize: 10, formatter: (v: number) => `¥${Math.round(v).toLocaleString()}` } 
        },
        { 
          scale: true, 
          gridIndex: 1, 
          max: 0,
          splitNumber: 2, 
          splitLine: { lineStyle: { color: '#1E293B' } }, 
          axisLabel: { color: '#64748B', fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}%` } 
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1] },
        { 
          type: 'slider', 
          xAxisIndex: [0, 1], 
          bottom: 0, 
          height: 16, 
          borderColor: '#334155', 
          fillerColor: 'rgba(99, 102, 241, 0.15)',
          textStyle: { color: '#64748B', fontSize: 9 }
        }
      ],
      series: [
        {
          name: '策略净值资产',
          type: 'line',
          data: stratValues,
          smooth: true,
          lineStyle: { width: 2.2, color: '#6366F1' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(99, 102, 241, 0.3)' },
                { offset: 1, color: 'rgba(99, 102, 241, 0.0)' }
              ]
            }
          },
          symbol: 'none'
        },
        {
          name: '标的买入持有基准',
          type: 'line',
          data: benchValues,
          smooth: true,
          lineStyle: { width: 1.5, color: '#64748B', type: 'dashed' },
          symbol: 'none'
        },
        {
          name: '水下动态回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: drawdowns,
          lineStyle: { width: 1, color: '#10B981' },
          areaStyle: { color: 'rgba(16, 185, 129, 0.25)' },
          symbol: 'none'
        }
      ]
    };
  }, [result]);

  // Build Interactive K-Line Chart Option with B/S MarkPoints & DataZoom
  const klineOption = useMemo(() => {
    if (!klineRecords || klineRecords.length === 0) return {};

    const dates = klineRecords.map(r => r.date);
    const candlestickData = klineRecords.map(r => [r.open, r.close, r.low, r.high]);
    const ma5 = klineRecords.map(r => r.ma5 || null);
    const ma10 = klineRecords.map(r => r.ma10 || null);
    const ma20 = klineRecords.map(r => r.ma20 || null);
    const volumes = klineRecords.map((r, i) => [i, r.volume, r.close >= r.open ? 1 : -1]);

    const markPoints: any[] = [];
    const markAreas: any[] = [];

    activeStockTrades.forEach((t) => {
      const isWin = t.net_profit > 0;
      const isSelected = selectedTradeId === t.trade_id;

      // Buy Marker (🟢 B)
      markPoints.push({
        name: `买入 #${t.trade_id}`,
        coord: [t.buy_date, t.buy_price],
        value: `B ¥${t.buy_price.toFixed(2)}`,
        symbol: 'pin',
        symbolSize: isSelected ? 46 : 38,
        itemStyle: {
          color: '#10B981',
          borderColor: isSelected ? '#FFFFFF' : '#059669',
          borderWidth: isSelected ? 3 : 1.5,
          shadowBlur: 8,
          shadowColor: 'rgba(16, 185, 129, 0.5)'
        },
        label: {
          color: '#FFFFFF',
          fontSize: 10,
          fontWeight: 'bold',
          offset: [0, -2]
        },
        tooltip: {
          formatter: () => {
            return `
              <div style="font-size:12px;padding:4px">
                <div style="font-weight:bold;color:#10B981;margin-bottom:4px">🟢 买入点 #${t.trade_id} (成交: ¥${t.buy_price})</div>
                <div>日期: ${t.buy_date}</div>
                <div>买入信号: <span style="color:#6EE7B7">${t.entry_signal || '战法买点成立'}</span></div>
                <div>买入数量: ${t.shares} 股</div>
              </div>
            `;
          }
        }
      });

      // Sell Marker (🔴 S)
      markPoints.push({
        name: `卖出 #${t.trade_id}`,
        coord: [t.sell_date, t.sell_price],
        value: `S ¥${t.sell_price.toFixed(2)}`,
        symbol: 'pin',
        symbolSize: isSelected ? 46 : 38,
        itemStyle: {
          color: isWin ? '#F43F5E' : '#64748B',
          borderColor: isSelected ? '#FFFFFF' : (isWin ? '#E11D48' : '#475569'),
          borderWidth: isSelected ? 3 : 1.5,
          shadowBlur: 8,
          shadowColor: isWin ? 'rgba(244, 63, 94, 0.5)' : 'rgba(100, 116, 139, 0.3)'
        },
        label: {
          color: '#FFFFFF',
          fontSize: 10,
          fontWeight: 'bold',
          offset: [0, -2]
        },
        tooltip: {
          formatter: () => {
            const color = isWin ? '#FB7185' : '#34D399';
            return `
              <div style="font-size:12px;padding:4px">
                <div style="font-weight:bold;color:${color};margin-bottom:4px">🔴 卖出点 #${t.trade_id} (成交: ¥${t.sell_price})</div>
                <div>日期: ${t.sell_date} (持股 ${t.holding_days} 天)</div>
                <div>净收益率: <span style="font-weight:bold;color:${color}">${t.return_pct > 0 ? `+${t.return_pct}%` : `${t.return_pct}%`} (¥${t.net_profit})</span></div>
                <div>离场原因: <span style="color:#CBD5E1">${t.exit_reason}</span></div>
                <div>规费滑点: ¥${t.total_fee}</div>
              </div>
            `;
          }
        }
      });

      // Shaded Holding Period MarkArea (from buy_date to sell_date)
      markAreas.push([
        {
          name: `#${t.trade_id} ${isWin ? `+${t.return_pct}%` : `${t.return_pct}%`}`,
          xAxis: t.buy_date,
          itemStyle: {
            color: isWin ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'
          },
          label: {
            show: true,
            position: 'top',
            color: isWin ? '#34D399' : '#F87171',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 'bold'
          }
        },
        {
          xAxis: t.sell_date
        }
      ]);
    });

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#6366F1', width: 1, type: 'dashed' } },
        backgroundColor: '#0F172A',
        borderColor: '#334155',
        borderWidth: 1,
        textStyle: { color: '#E2E8F0', fontSize: 11 },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return '';
          const idx = params[0].dataIndex;
          const r = klineRecords[idx];
          if (!r) return '';
          const isUp = r.close >= r.open;
          const colorClass = isUp ? '#EF4444' : '#10B981';

          let html = `<div style="font-weight:bold;margin-bottom:4px;border-bottom:1px solid #334155;padding-bottom:3px;color:#94A3B8">${r.date}</div>`;
          html += `<div style="display:grid;grid-template-columns:auto auto;gap:2px 14px;font-size:11px">`;
          html += `<span>收盘:</span><span style="font-weight:bold;color:${colorClass};font-family:monospace">¥${r.close.toFixed(2)} (${r.pct_chg >= 0 ? '+' : ''}${r.pct_chg.toFixed(2)}%)</span>`;
          html += `<span>开盘:</span><span style="font-family:monospace">¥${r.open.toFixed(2)}</span>`;
          html += `<span>最高:</span><span style="font-family:monospace">¥${r.high.toFixed(2)}</span>`;
          html += `<span>最低:</span><span style="font-family:monospace">¥${r.low.toFixed(2)}</span>`;
          if (r.ma5) html += `<span>MA5:</span><span style="color:#38BDF8;font-family:monospace">¥${r.ma5.toFixed(2)}</span>`;
          if (r.ma10) html += `<span>MA10:</span><span style="color:#F59E0B;font-family:monospace">¥${r.ma10.toFixed(2)}</span>`;
          if (r.ma20) html += `<span>MA20:</span><span style="color:#EC4899;font-family:monospace">¥${r.ma20.toFixed(2)}</span>`;
          html += `</div>`;
          return html;
        }
      },
      legend: {
        data: ['日K线', 'MA5', 'MA10', 'MA20'],
        textStyle: { color: '#94A3B8', fontSize: 11 },
        top: 0
      },
      grid: [
        { left: '4%', right: '3%', top: '8%', height: '62%' },
        { left: '4%', right: '3%', top: '75%', height: '18%' }
      ],
      xAxis: [
        { 
          type: 'category', 
          data: dates, 
          gridIndex: 0, 
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { color: '#64748B', fontSize: 10 }
        },
        { 
          type: 'category', 
          data: dates, 
          gridIndex: 1, 
          axisLine: { lineStyle: { color: '#334155' } },
          axisLabel: { show: false }
        }
      ],
      yAxis: [
        { 
          scale: true, 
          gridIndex: 0, 
          splitLine: { lineStyle: { color: '#1E293B' } }, 
          axisLabel: { color: '#64748B', fontSize: 10, formatter: (v: number) => `¥${v.toFixed(1)}` } 
        },
        { 
          scale: true, 
          gridIndex: 1, 
          splitNumber: 2, 
          splitLine: { lineStyle: { color: '#1E293B' } }, 
          axisLabel: { show: false } 
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1] },
        { 
          type: 'slider', 
          xAxisIndex: [0, 1], 
          bottom: 0, 
          height: 16, 
          borderColor: '#334155', 
          fillerColor: 'rgba(99, 102, 241, 0.15)',
          textStyle: { color: '#64748B', fontSize: 9 }
        }
      ],
      series: [
        {
          name: '日K线',
          type: 'candlestick',
          data: candlestickData,
          itemStyle: {
            color: '#EF4444',
            color0: '#10B981',
            borderColor: '#EF4444',
            borderColor0: '#10B981'
          },
          markPoint: {
            data: markPoints
          },
          markArea: {
            data: markAreas
          }
        },
        { name: 'MA5', type: 'line', data: ma5, smooth: true, lineStyle: { width: 1.2, color: '#38BDF8' }, symbol: 'none' },
        { name: 'MA10', type: 'line', data: ma10, smooth: true, lineStyle: { width: 1.2, color: '#F59E0B' }, symbol: 'none' },
        { name: 'MA20', type: 'line', data: ma20, smooth: true, lineStyle: { width: 1.2, color: '#EC4899' }, symbol: 'none' },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes.map((v) => ({
            value: v[1],
            itemStyle: { color: v[2] === 1 ? '#EF4444' : '#10B981' }
          }))
        }
      ]
    };
  }, [klineRecords, activeStockTrades, selectedTradeId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-6xl max-h-[94vh] surface-card rounded-2xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden bg-slate-950 text-slate-100">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-slate-100">专业级 A 股量化策略回测与验证工作台</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                  防未来函数 · 真实摩擦 · 大数定律
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                对标主流专业量化平台：计入 T+1、0.05% 印花税、万2.5 佣金与滑点冲击成本
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">

          {/* Top Quick Settings Bar */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              
              {/* 1. Strategy Selector */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>核心战法</span>
                </label>
                <select
                  value={selectedStrategyId}
                  onChange={(e) => setSelectedStrategyId(e.target.value)}
                  className="w-full text-xs rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.tier} | {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Target Pool or Single Symbol */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span>标的范围</span>
                  </label>
                  <div className="flex text-[10px] font-medium bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setTargetType('POOL')}
                      className={`px-2 py-0.5 rounded-md transition-colors ${
                        targetType === 'POOL' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      股票池
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetType('SINGLE')}
                      className={`px-2 py-0.5 rounded-md transition-colors ${
                        targetType === 'SINGLE' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      单股
                    </button>
                  </div>
                </div>

                {targetType === 'POOL' ? (
                  <div>
                    <select
                      value={selectedPoolId}
                      onChange={(e) => setSelectedPoolId(e.target.value)}
                      className="w-full text-xs rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {pools.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1 text-[10px] text-emerald-400 mt-1">
                      <Sparkles className="w-3 h-3" />
                      <span>已启用多线程并发加速 (毫秒级测算前20只核心)</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={singleSymbol}
                      onChange={(e) => setSingleSymbol(e.target.value)}
                      placeholder="6位代码 (如 600519)"
                      className="w-full text-xs font-mono rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                      <span>快捷标的:</span>
                      <button type="button" onClick={() => setSingleSymbol('600519')} className="text-slate-300 hover:text-indigo-400 underline">茅台</button>
                      <button type="button" onClick={() => setSingleSymbol('300750')} className="text-slate-300 hover:text-indigo-400 underline">宁德</button>
                      <button type="button" onClick={() => setSingleSymbol('688981')} className="text-slate-300 hover:text-indigo-400 underline">中芯</button>
                      <button type="button" onClick={() => setSingleSymbol('000001')} className="text-slate-300 hover:text-indigo-400 underline">平安</button>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Time Horizon with Custom Range */}
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                    <span>历史周期 / 区间</span>
                  </label>
                  <div className="flex text-[10px] font-medium bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setTimeMode('PRESET')}
                      className={`px-2 py-0.5 rounded-md transition-colors ${
                        timeMode === 'PRESET' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      预设
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimeMode('CUSTOM_RANGE')}
                      className={`px-2 py-0.5 rounded-md transition-colors ${
                        timeMode === 'CUSTOM_RANGE' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      自定义起止 📅
                    </button>
                  </div>
                </div>

                {timeMode === 'PRESET' ? (
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { label: '半年(120日)', val: 120 },
                      { label: '1年(250日)', val: 250 },
                      { label: '2年(500日)', val: 500 },
                      { label: '3年(750日)', val: 750 }
                    ].map((item) => (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setDays(item.val)}
                        className={`text-[10px] py-1.5 rounded-lg border text-center transition-all ${
                          days === item.val
                            ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full text-[10px] font-mono rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full text-[10px] font-mono rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-0.5 overflow-x-auto">
                      <span className="flex-shrink-0 text-[9px] text-slate-500">快捷:</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          const now = new Date();
                          const ytd = `${now.getFullYear()}-01-01`;
                          setStartDate(ytd);
                          setEndDate('');
                        }} 
                        className="text-indigo-400 hover:underline flex-shrink-0"
                      >
                        今年以来
                      </button>
                      <button 
                        type="button" 
                        onClick={() => {
                          setStartDate('2024-09-18');
                          setEndDate('');
                        }} 
                        className="text-amber-400 hover:underline flex-shrink-0"
                      >
                        2024牛市脉冲
                      </button>
                      <button 
                        type="button" 
                        onClick={() => {
                          setStartDate('2023-01-01');
                          setEndDate('2023-12-31');
                        }} 
                        className="text-slate-300 hover:underline flex-shrink-0"
                      >
                        2023全年
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Action Button */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => executeBacktest()}
                  disabled={isRunning}
                  className="w-full py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在全量回测...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>启动量化回测</span>
                    </>
                  )}
                </button>
              </div>

            </div>

            {/* Current Strategy Logic Quick Text */}
            {currentStrategy && (
              <div className="text-[11px] text-indigo-200/90 pt-1.5 border-t border-slate-800/60 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"></span>
                <span className="truncate">
                  <strong className="text-indigo-300 font-semibold">{currentStrategy.name}: </strong>
                  {currentStrategy.description}
                </span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => executeBacktest()}
                className="px-2.5 py-1 text-[11px] bg-rose-800/80 hover:bg-rose-700 rounded-lg text-white font-semibold transition-colors cursor-pointer"
              >
                重试
              </button>
            </div>
          )}

          {/* Loading Indicator State */}
          {isRunning && !result && (
            <div className="py-24 flex flex-col items-center justify-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 animate-pulse">
                <RefreshCw className="w-7 h-7 animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <h4 className="text-sm font-bold text-slate-100">正在执行 A 股严肃量化历史回测</h4>
                <p className="text-xs text-slate-400">
                  严防未来函数 · 逐日复盘 · 模拟 T+1 交易锁 · 扣除单边 0.05% 印花税与滑点
                </p>
              </div>
            </div>
          )}

          {/* Empty / Welcome State if not yet run */}
          {!result && !isRunning && (
            <div className="py-12 px-6 rounded-2xl bg-slate-900/50 border border-slate-800/80 text-center space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto shadow-inner">
                <Scale className="w-8 h-8" />
              </div>
              
              <div className="max-w-xl mx-auto space-y-2">
                <h3 className="text-base font-bold text-slate-100">量化策略验证准备就绪</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  选择上方战法模型并点击【启动量化回测】，系统将使用真实历史行情，为您生成对标专业量化平台的资产净值走势、水下回撤图、K线买卖点明细与月度胜率热力矩阵。
                </p>
              </div>

              {/* 4 Strategy Quick Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto text-left">
                {DEFAULT_STRATEGIES.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSelectedStrategyId(s.id);
                      executeBacktest();
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      selectedStrategyId === s.id
                        ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-600/20'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-indigo-400 block mb-1">{s.tier}</span>
                    <h5 className="font-bold text-xs text-slate-200 mb-1">{s.name}</h5>
                    <p className="text-[10px] text-slate-400 leading-normal line-clamp-3">{s.description}</p>
                    <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-indigo-300 font-medium">
                      <span>点击即刻测算</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Primary Call to Action Button */}
              <div>
                <button
                  type="button"
                  onClick={() => executeBacktest()}
                  className="px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-xl shadow-indigo-600/30 cursor-pointer inline-flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>一键启动默认回测 (周线MA5+KDJ21战法)</span>
                </button>
              </div>
            </div>
          )}

          {/* Main Professional Quant Workspace (Results Area) */}
          {result && (
            <div className="space-y-4">

              {/* Assessment Banner with exact date range */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-900/50 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-indigo-300 font-mono border-b border-indigo-900/30 pb-1">
                  <span>📅 回测实测时间区间: {result.date_range_desc || `${result.start_date || ''} 至 ${result.end_date || ''} (共 ${result.test_days} 个交易日)`}</span>
                  <span className="text-slate-400">{result.target_desc}</span>
                </div>
                <div className="text-xs leading-relaxed text-slate-200 whitespace-pre-line font-sans">
                  {result.assessment_summary}
                </div>
              </div>

              {/* Mainstream 10-Metric Comprehensive Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                
                {/* 1. 累计收益率 */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-indigo-400" />
                    <span>累计收益率</span>
                  </span>
                  <div className="my-1">
                    <span className={`text-lg font-mono font-bold ${
                      result.total_return_pct >= 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {result.total_return_pct >= 0 ? `+${result.total_return_pct}%` : `${result.total_return_pct}%`}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Alpha: {result.alpha_pct >= 0 ? `+${result.alpha_pct}%` : `${result.alpha_pct}%`}
                  </span>
                </div>

                {/* 2. 年化收益 CAGR */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Activity className="w-3 h-3 text-purple-400" />
                    <span>年化 CAGR</span>
                  </span>
                  <div className="my-1">
                    <span className={`text-lg font-mono font-bold ${
                      result.annualized_return_pct >= 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {result.annualized_return_pct >= 0 ? `+${result.annualized_return_pct}%` : `${result.annualized_return_pct}%`}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    基准年化: {result.benchmark_return_pct}%
                  </span>
                </div>

                {/* 3. 真实胜率 */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Award className="w-3 h-3 text-amber-400" />
                    <span>真实胜率</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-amber-300">
                      {result.win_rate}%
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {result.winning_trades_count}胜 / {result.losing_trades_count}负 (共{result.total_trades}单)
                  </span>
                </div>

                {/* 4. 🌟 核心盈亏比 */}
                <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-950/50 to-slate-900 border border-indigo-700/60 flex flex-col justify-between">
                  <span className="text-[11px] text-indigo-300 font-semibold flex items-center gap-1">
                    <Scale className="w-3 h-3 text-indigo-400" />
                    <span>核心盈亏比</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-indigo-200">
                      {result.profit_loss_ratio} : 1
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    赢+{result.avg_win_pct}% / 亏{result.avg_loss_pct}%
                  </span>
                </div>

                {/* 5. 获利因子 (Profit Factor) */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-emerald-400" />
                    <span>获利因子 (PF)</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-emerald-300">
                      {result.profit_factor || result.profit_loss_ratio}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    毛利润 / 毛亏损
                  </span>
                </div>

                {/* 6. 最大回撤 */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-emerald-400" />
                    <span>最大回撤 (MaxDD)</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-emerald-400">
                      -{result.max_drawdown_pct}%
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    卡玛比率: {result.calmar_ratio}
                  </span>
                </div>

                {/* 7. 夏普比率 Sharpe */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <BarChart2 className="w-3 h-3 text-sky-400" />
                    <span>夏普比率 (Sharpe)</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-sky-300">
                      {result.sharpe_ratio}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    无风险利率 2.0%
                  </span>
                </div>

                {/* 8. 索提诺比率 Sortino */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-indigo-400" />
                    <span>索提诺 (Sortino)</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-indigo-300">
                      {result.sortino_ratio || result.sharpe_ratio}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    仅惩罚下行波动
                  </span>
                </div>

                {/* 9. 年化波动率 & Beta */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Percent className="w-3 h-3 text-amber-400" />
                    <span>年化波动率 / Beta</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-slate-200">
                      {result.annual_volatility || 0}%
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Beta: {result.beta || 1.0}
                  </span>
                </div>

                {/* 10. 真实摩擦规费 */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-slate-400" />
                    <span>真实扣除规费</span>
                  </span>
                  <div className="my-1">
                    <span className="text-lg font-mono font-bold text-slate-300">
                      ¥{result.total_friction_fees.toLocaleString()}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    印花税+佣金+滑点
                  </span>
                </div>

              </div>

              {/* Mainstream Tab Navigation Bar */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { id: 'OVERVIEW', label: '📊 净值与水下回撤', icon: BarChart2 },
                    { id: 'KLINE', label: '📈 K线买卖轨迹复盘', icon: Eye },
                    { id: 'HEATMAP', label: '🗓️ 月度收益热力图', icon: Grid },
                    { id: 'DISTRIBUTION', label: '📊 盈亏分布直方图', icon: PieChart },
                    { id: 'TRADES', label: `📋 逐笔流水 (${result.trades.length})`, icon: Layers },
                    { id: 'PARAMS', label: '⚙️ 战法参数优化', icon: Sliders },
                  ].map((tab) => {
                    const IconComponent = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {activeTab === 'TRADES' && (
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                    title="导出完整交易流水至 CSV 表格"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出 CSV</span>
                  </button>
                )}
              </div>

              {/* TAB 1: OVERVIEW & UNDERWATER DRAWDOWN */}
              {activeTab === 'OVERVIEW' && (
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200">
                      投资组合净值走势 (上层) 与 动态水下回撤 (下层)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      初始资金: ¥{result.initial_capital.toLocaleString()} $\rightarrow$ 最终净值: ¥{Math.round(result.final_equity).toLocaleString()}
                    </span>
                  </div>
                  <div className="h-80 w-full pt-1">
                    <ReactECharts option={equityChartOption} style={{ height: '100%', width: '100%' }} />
                  </div>
                </div>
              )}

              {/* TAB 2: INTERACTIVE K-LINE WITH B / S MARKPOINTS & DATAZOOM */}
              {activeTab === 'KLINE' && (
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">选择复盘标的:</span>
                      <select
                        value={activeChartSymbol}
                        onChange={(e) => {
                          setActiveChartSymbol(e.target.value);
                          setSelectedTradeId(null);
                        }}
                        className="text-xs font-semibold rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        {result.symbols_with_trades && result.symbols_with_trades.length > 0 ? (
                          result.symbols_with_trades.map(s => (
                            <option key={s.symbol} value={s.symbol}>
                              {s.name} ({s.symbol}) — {s.trades_count}笔交易 (盈利¥{s.total_profit})
                            </option>
                          ))
                        ) : (
                          <option value={activeChartSymbol}>{activeChartSymbol}</option>
                        )}
                      </select>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block font-mono text-[8px] text-center text-white font-bold leading-2.5">B</span>
                        <span className="text-emerald-400">🟢 买入点</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block font-mono text-[8px] text-center text-white font-bold leading-2.5">S</span>
                        <span className="text-rose-400">🔴 卖出点</span>
                      </div>
                      <span className="text-[10px] text-slate-500">底部滑块可缩放区间</span>
                    </div>
                  </div>

                  {isLoadingKline ? (
                    <div className="h-80 flex items-center justify-center text-xs text-slate-500">
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                      <span>K线行情与买卖点标记载入中...</span>
                    </div>
                  ) : klineRecords.length === 0 ? (
                    <div className="h-80 flex items-center justify-center text-xs text-slate-500">
                      暂无该标的K线历史数据
                    </div>
                  ) : (
                    <div className="h-[380px] w-full">
                      <ReactECharts option={klineOption} style={{ height: '100%', width: '100%' }} />
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: MONTHLY RETURNS HEATMAP MATRIX */}
              {activeTab === 'HEATMAP' && (
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">
                      年度与月度收益率热力图矩阵 (检验不同行情周期的盈利韧性)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      红色为正收益，绿色为负收益 (A股标准)
                    </span>
                  </div>

                  {result.monthly_matrix && Object.keys(result.monthly_matrix).length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-center text-xs font-mono">
                        <thead className="bg-slate-950 text-slate-400 text-[11px]">
                          <tr>
                            <th className="py-2.5 px-3 text-left">年份</th>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                              <th key={m} className="py-2.5 px-2">{m}月</th>
                            ))}
                            <th className="py-2.5 px-3 font-bold text-slate-200">全年总计</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-[11px]">
                          {Object.keys(result.monthly_matrix).sort().reverse().map(yr => {
                            const yrData = result.monthly_matrix![yr];
                            const yrTotal = yrData.total || 0;
                            return (
                              <tr key={yr} className="hover:bg-slate-800/40">
                                <td className="py-2.5 px-3 text-left font-bold text-slate-300">{yr}</td>
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => {
                                  const val = yrData[String(m)];
                                  if (val === undefined) {
                                    return <td key={m} className="py-2.5 px-2 text-slate-700">-</td>;
                                  }
                                  const isPos = val >= 0;
                                  return (
                                    <td key={m} className="py-2.5 px-2">
                                      <span className={`px-1.5 py-0.5 rounded font-bold ${
                                        isPos ? 'bg-rose-500/15 text-rose-400' : 'bg-emerald-500/15 text-emerald-400'
                                      }`}>
                                        {val > 0 ? `+${val}%` : `${val}%`}
                                      </span>
                                    </td>
                                  );
                                })}
                                <td className="py-2.5 px-3">
                                  <span className={`px-2 py-0.5 rounded font-bold ${
                                    yrTotal >= 0 ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40' : 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                                  }`}>
                                    {yrTotal >= 0 ? `+${yrTotal}%` : `${yrTotal}%`}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-xs text-slate-500">
                      数据跨度不足，未能生成月度收益热力矩阵
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: P&L DISTRIBUTION HISTOGRAM */}
              {activeTab === 'DISTRIBUTION' && (
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200">
                      单笔交易盈亏分布直方图 (检验右偏正期望与肥尾分布)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      胜率: {result.win_rate}% | 盈亏比: {result.profit_loss_ratio}:1
                    </span>
                  </div>

                  {result.pnl_distribution ? (
                    <div className="h-72 w-full pt-2">
                      {(() => {
                        const bins = result.pnl_distribution;
                        const labels = bins.map(b => b.label);
                        const counts = bins.map(b => b.count);

                        const option = {
                          backgroundColor: 'transparent',
                          tooltip: {
                            trigger: 'axis',
                            formatter: (params: any[]) => {
                              const b = bins[params[0].dataIndex];
                              return `<div style="font-size:11px">收益区间: <b>${b.label}</b><br>成交单数: <b>${b.count} 笔</b></div>`;
                            }
                          },
                          xAxis: {
                            type: 'category',
                            data: labels,
                            axisLabel: { color: '#94A3B8', fontSize: 10, rotate: 20 },
                            axisLine: { lineStyle: { color: '#334155' } }
                          },
                          yAxis: {
                            type: 'value',
                            splitLine: { lineStyle: { color: '#1E293B' } },
                            axisLabel: { color: '#94A3B8', fontSize: 10 }
                          },
                          series: [
                            {
                              type: 'bar',
                              data: bins.map(b => ({
                                value: b.count,
                                itemStyle: {
                                  color: b.min >= 0 ? '#F43F5E' : '#10B981',
                                  borderRadius: [4, 4, 0, 0]
                                }
                              })),
                              label: {
                                show: true,
                                position: 'top',
                                color: '#CBD5E1',
                                fontSize: 10
                              }
                            }
                          ]
                        };

                        return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />;
                      })()}
                    </div>
                  ) : null}
                </div>
              )}

              {/* TAB 5: TRADE LOG TABLE */}
              {activeTab === 'TRADES' && (
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          value={tradeSearchText}
                          onChange={(e) => setTradeSearchText(e.target.value)}
                          placeholder="搜索代码、名称或离场理由..."
                          className="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 w-48 sm:w-64"
                        />
                      </div>
                    </div>

                    <div className="flex gap-1 text-[11px] bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setTradeFilter('ALL')}
                        className={`px-2.5 py-0.5 rounded-md ${tradeFilter === 'ALL' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'}`}
                      >
                        全部 ({result.trades.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTradeFilter('WIN')}
                        className={`px-2.5 py-0.5 rounded-md ${tradeFilter === 'WIN' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400'}`}
                      >
                        盈利 ({result.winning_trades_count})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTradeFilter('LOSS')}
                        className={`px-2.5 py-0.5 rounded-md ${tradeFilter === 'LOSS' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400'}`}
                      >
                        止损 ({result.losing_trades_count})
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-950/90 text-[11px] font-mono text-slate-400 uppercase border-b border-slate-800 sticky top-0 z-10">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">标的代码/名称</th>
                          <th className="py-2.5 px-3">🟢 买入点与触发信号</th>
                          <th className="py-2.5 px-3">🔴 卖出点与离场原因</th>
                          <th className="py-2.5 px-3">持仓天数</th>
                          <th className="py-2.5 px-3">净收益率</th>
                          <th className="py-2.5 px-3">规费滑点</th>
                          <th className="py-2.5 px-3 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {filteredTrades.map((t) => {
                          const isWin = t.net_profit > 0;
                          return (
                            <tr 
                              key={t.trade_id} 
                              onClick={() => handleFocusTrade(t)}
                              className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                            >
                              <td className="py-2.5 px-3 text-slate-500 font-bold">{t.trade_id}</td>
                              
                              <td className="py-2.5 px-3 font-sans">
                                <span className="font-bold text-slate-100 block">{t.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{t.symbol}</span>
                              </td>

                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                                    买 ¥{t.buy_price.toFixed(2)}
                                  </span>
                                  <span className="text-[10px] text-slate-400">{t.buy_date}</span>
                                </div>
                                <span className="text-[10px] text-emerald-300/80 block mt-0.5 truncate max-w-xs font-sans">
                                  {t.entry_signal || '战法买点共振'}
                                </span>
                              </td>

                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                    isWin ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-700/60 text-slate-300'
                                  }`}>
                                    卖 ¥{t.sell_price.toFixed(2)}
                                  </span>
                                  <span className="text-[10px] text-slate-400">{t.sell_date}</span>
                                </div>
                                <span className="text-[10px] text-slate-400 block mt-0.5 truncate max-w-xs font-sans">
                                  {t.exit_reason}
                                </span>
                              </td>

                              <td className="py-2.5 px-3 text-slate-300">{t.holding_days} 天</td>

                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded font-bold ${
                                  isWin 
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' 
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                }`}>
                                  {t.return_pct > 0 ? `+${t.return_pct}%` : `${t.return_pct}%`}
                                </span>
                                <span className="text-[10px] text-slate-500 block mt-0.5">
                                  (¥{t.net_profit > 0 ? `+${t.net_profit}` : t.net_profit})
                                </span>
                              </td>

                              <td className="py-2.5 px-3 text-slate-400">¥{t.total_fee}</td>

                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFocusTrade(t);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/40 text-[10px] transition-colors flex items-center gap-1 ml-auto cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>查看K线</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 6: STRATEGY PARAMETER OPTIMIZATION & TUNING */}
              {activeTab === 'PARAMS' && (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-indigo-400" />
                        <span>策略敏感性调参与仓位风控试验</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">调节止盈止损与持仓上限，或点击上方【🤖 AI 诊断与参数调优】获取最优解</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAIOptimize}
                      disabled={isOptimizing}
                      className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Brain className={`w-3.5 h-3.5 ${isOptimizing ? 'animate-spin' : ''}`} />
                      <span>{isOptimizing ? 'AI 分析中...' : '让 AI 推荐最佳参数'}</span>
                    </button>
                  </div>

                  {/* AI Diagnosis & Recommendation Card (if generated) */}
                  {aiOptimizeResult && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-purple-950/40 via-indigo-950/30 to-slate-950 border border-purple-500/40 shadow-xl space-y-3.5 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between border-b border-purple-500/20 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                            <Brain className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="font-bold text-xs text-purple-200">AI 量化投资总监 · 策略归因与调优方案</h5>
                            <span className="text-[10px] text-purple-400/80 font-mono">基于大数定律、胜率盈亏比与尾部回撤控制模型</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyAIOptimization}
                          disabled={isRunning}
                          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Zap className="w-3.5 h-3.5 fill-white" />
                          <span>⚡ 一键应用 AI 优化参数并再次回测</span>
                        </button>
                      </div>

                      {/* Diagnosis Summary */}
                      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-purple-900/30 text-xs text-purple-100 leading-relaxed font-sans">
                        <strong className="text-purple-300">📊 诊断归因: </strong>
                        {aiOptimizeResult.diagnosis_summary}
                      </div>

                      {/* Key Flaws */}
                      {aiOptimizeResult.key_flaws?.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>当前参数的核心瓶颈:</span>
                          </span>
                          <ul className="text-[11px] text-slate-300 space-y-0.5 pl-4 list-disc">
                            {aiOptimizeResult.key_flaws.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Parameter Comparison Table */}
                      <div className="overflow-x-auto rounded-lg border border-purple-900/40">
                        <table className="w-full text-left text-xs text-slate-300">
                          <thead className="bg-slate-950/80 text-[10px] uppercase text-purple-300 border-b border-purple-900/40">
                            <tr>
                              <th className="py-1.5 px-3">参数维度</th>
                              <th className="py-1.5 px-3">当前参数</th>
                              <th className="py-1.5 px-3 text-emerald-400 font-bold">AI 推荐优化值</th>
                              <th className="py-1.5 px-3">调整意图与量化依据</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-purple-900/20 text-[11px] font-mono">
                            <tr>
                              <td className="py-2 px-3 font-sans font-semibold text-slate-200">硬止损阈值</td>
                              <td className="py-2 px-3 text-slate-400">{(hardStopLossPct * 100).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-emerald-300 font-bold">
                                {(aiOptimizeResult.recommended_params.hard_stop_loss_pct * 100).toFixed(1)}%
                              </td>
                              <td className="py-2 px-3 font-sans text-slate-400 text-[10px]">
                                {aiOptimizeResult.recommended_params.hard_stop_loss_pct > hardStopLossPct ? '放宽防线，减少日间正常震荡洗盘' : '收紧防线，压低尾部黑天鹅回撤'}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-sans font-semibold text-slate-200">目标止盈阈值</td>
                              <td className="py-2 px-3 text-slate-400">{(targetProfitPct * 100).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-emerald-300 font-bold">
                                {(aiOptimizeResult.recommended_params.target_profit_pct * 100).toFixed(1)}%
                              </td>
                              <td className="py-2 px-3 font-sans text-slate-400 text-[10px]">
                                {aiOptimizeResult.recommended_params.target_profit_pct > targetProfitPct ? '调高止盈线，让波段主升浪利润充分奔跑' : '适度收割，防范利润过大回吐'}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-sans font-semibold text-slate-200">最大并发持仓</td>
                              <td className="py-2 px-3 text-slate-400">{maxPositions} 只</td>
                              <td className="py-2 px-3 text-emerald-300 font-bold">
                                {aiOptimizeResult.recommended_params.max_positions} 只
                              </td>
                              <td className="py-2 px-3 font-sans text-slate-400 text-[10px]">
                                {aiOptimizeResult.recommended_params.max_positions < maxPositions ? '集中优势兵力，减少弱势个股拖累' : '适当分散风险'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Rationale & Market Advice */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-300 space-y-1">
                          <span className="font-bold text-indigo-300 block">💡 调优理论依据:</span>
                          <p className="text-slate-400 leading-normal">{aiOptimizeResult.rationale}</p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-300 space-y-1">
                          <span className="font-bold text-emerald-300 block">🛡️ 市场适用环境:</span>
                          <p className="text-slate-400 leading-normal">{aiOptimizeResult.market_regime_advice}</p>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center justify-between">
                        <span className="text-[10px] text-purple-300/80">
                          🎯 预期调优效果: 胜率 {aiOptimizeResult.expected_impact?.win_rate} | 盈亏比 {aiOptimizeResult.expected_impact?.profit_loss_ratio} | 回撤 {aiOptimizeResult.expected_impact?.max_drawdown}
                        </span>
                        <button
                          type="button"
                          onClick={handleApplyAIOptimization}
                          disabled={isRunning}
                          className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Zap className="w-3.5 h-3.5 fill-white" />
                          <span>⚡ 一键应用并重新回测</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Hard Stop Loss */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-semibold">单笔硬止损阈值</span>
                        <span className="font-mono text-emerald-400 font-bold">{(hardStopLossPct * 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.03"
                        max="0.10"
                        step="0.005"
                        value={hardStopLossPct}
                        onChange={(e) => setHardStopLossPct(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-500 block">建议 4%~7%，过窄易被正常震荡洗出，过宽承受较大回撤</span>
                    </div>

                    {/* Target Profit */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-semibold">预期目标止盈阈值</span>
                        <span className="font-mono text-rose-400 font-bold">{(targetProfitPct * 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.08"
                        max="0.30"
                        step="0.01"
                        value={targetProfitPct}
                        onChange={(e) => setTargetProfitPct(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-500 block">短线建议 8%~12%，中线波段建议 15%~25%</span>
                    </div>

                    {/* Max Positions */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-semibold">最大并发持仓只数</span>
                        <span className="font-mono text-purple-400 font-bold">{maxPositions} 只 (每只{(100/maxPositions).toFixed(0)}%仓)</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={maxPositions}
                        onChange={(e) => setMaxPositions(Number(e.target.value))}
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-500 block">检验集中持股 (1~2只) vs 分散组合 (5~8只) 的风险收益特征</span>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => executeBacktest()}
                      disabled={isRunning}
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md shadow-indigo-600/30"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                      <span>应用新参数并重新回测</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
