import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { X, TrendingUp, Cpu, AlertTriangle } from 'lucide-react';
import { KLineRecord } from '../types';
import axios from 'axios';

interface StockDetailModalProps {
  symbol: string;
  onClose: () => void;
  onTriggerStockAI: (symbol: string) => void;
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({
  symbol,
  onClose,
  onTriggerStockAI
}) => {
  const [klineData, setKlineData] = useState<KLineRecord[]>([]);
  const [stockName, setStockName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [dataHealth, setDataHealth] = useState({ status: 'unknown', source: '', updatedAt: '' });

  useEffect(() => {
    const fetchKline = async () => {
      setIsLoading(true);
      try {
        const [klineRes, watchRes] = await Promise.all([
          axios.get(`/api/v1/stocks/${symbol}/kline?days=60`),
          axios.get('/api/v1/stocks/watchlists').catch(() => ({ data: [] }))
        ]);
        const records: KLineRecord[] = klineRes.data || [];
        setKlineData(records);
        setDataHealth({
          status: klineRes.headers['x-market-data-status'] || 'unknown',
          source: klineRes.headers['x-market-data-source'] || '',
          updatedAt: klineRes.headers['x-market-data-updated-at'] || ''
        });

        // Resolve Chinese name
        const match = watchRes.data.find((w: any) => w.symbol === symbol);
        if (match && match.name) {
          setStockName(match.name);
        }
      } catch (err) {
        console.error('Error fetching K-line data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchKline();
  }, [symbol]);

  // Format ECharts Options
  const dates = klineData.map((d) => d.date);
  const candlestickData = klineData.map((d) => [d.open, d.close, d.low, d.high]);
  const ma5 = klineData.map((d) => d.ma5 || null);
  const ma10 = klineData.map((d) => d.ma10 || null);
  const ma20 = klineData.map((d) => d.ma20 || null);
  const volumes = klineData.map((d, idx) => [idx, d.volume, d.close >= d.open ? 1 : -1]);

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#0F172A',
      borderColor: '#334155',
      borderWidth: 1,
      padding: 12,
      textStyle: { color: '#E2E8F0', fontSize: 12 },
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        const dataIndex = params[0].dataIndex;
        const record = klineData[dataIndex];
        if (!record) return '';

        const isUp = record.close >= record.open;
        const colorClass = isUp ? '#EF4444' : '#10B981';
        const digits = record.close < 10 ? 3 : 2;

        let html = `<div style="font-weight:bold;margin-bottom:6px;border-bottom:1px solid #334155;padding-bottom:4px;color:#94A3B8">${record.date}</div>`;
        html += `<div style="display:grid;grid-template-columns:auto auto;gap:4px 16px;font-size:12px">`;
        html += `<span>收盘价:</span><span style="font-weight:bold;color:${colorClass};font-family:monospace">¥${record.close?.toFixed(digits)}</span>`;
        html += `<span>开盘价:</span><span style="font-family:monospace">¥${record.open?.toFixed(digits)}</span>`;
        html += `<span>最高价:</span><span style="font-family:monospace">¥${record.high?.toFixed(digits)}</span>`;
        html += `<span>最低价:</span><span style="font-family:monospace">¥${record.low?.toFixed(digits)}</span>`;
        html += `<span>日涨跌:</span><span style="font-weight:bold;color:${colorClass};font-family:monospace">${record.pct_chg >= 0 ? '+' : ''}${record.pct_chg?.toFixed(2)}%</span>`;
        html += `<span>成交量:</span><span style="font-family:monospace">${record.volume?.toLocaleString()} 手</span>`;
        
        if (record.ma5) html += `<span>MA5:</span><span style="color:#38BDF8;font-family:monospace">¥${record.ma5.toFixed(digits)}</span>`;
        if (record.ma10) html += `<span>MA10:</span><span style="color:#F59E0B;font-family:monospace">¥${record.ma10.toFixed(digits)}</span>`;
        if (record.ma20) html += `<span>MA20:</span><span style="color:#EC4899;font-family:monospace">¥${record.ma20.toFixed(digits)}</span>`;
        
        html += `</div>`;
        return html;
      }
    },
    legend: {
      data: ['日K', 'MA5', 'MA10', 'MA20'],
      textStyle: { color: '#94A3B8' }
    },
    grid: [
      { left: '6%', right: '4%', top: '10%', height: '54%' },
      { left: '6%', right: '4%', top: '72%', height: '20%' }
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, axisLine: { lineStyle: { color: '#334155' } } },
      { type: 'category', data: dates, gridIndex: 1, axisLine: { lineStyle: { color: '#334155' } } }
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: '#1E293B' } }, axisLine: { lineStyle: { color: '#334155' } } },
      { scale: true, gridIndex: 1, splitNumber: 2, splitLine: { lineStyle: { color: '#1E293B' } }, axisLine: { lineStyle: { color: '#334155' } } }
    ],
    series: [
      {
        name: '日K',
        type: 'candlestick',
        data: candlestickData,
        itemStyle: {
          color: '#EF4444',      // A股红涨
          color0: '#10B981',     // A股绿跌
          borderColor: '#EF4444',
          borderColor0: '#10B981'
        }
      },
      { name: 'MA5', type: 'line', data: ma5, smooth: true, lineStyle: { width: 1.5, color: '#38BDF8' } },
      { name: 'MA10', type: 'line', data: ma10, smooth: true, lineStyle: { width: 1.5, color: '#F59E0B' } },
      { name: 'MA20', type: 'line', data: ma20, smooth: true, lineStyle: { width: 1.5, color: '#EC4899' } },
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

  const latest = klineData[klineData.length - 1];
  const digits = (latest && latest.close < 10) ? 3 : 2;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="surface-card rounded-2xl max-w-4xl w-full p-4 sm:p-6 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <span>{stockName ? `${stockName} (${symbol})` : `行情看板 (${symbol})`}</span>
            </h3>
            {dataHealth.status === 'mock' && (
              <span className="hidden sm:flex items-center gap-1 rounded-full border border-amber-800/60 bg-amber-950/60 px-2 py-1 text-[10px] font-medium text-amber-200">
                <AlertTriangle className="w-3 h-3" /> 演示 K 线
              </span>
            )}
            {latest && (
              <span className={`text-base font-mono font-bold ${latest.pct_chg >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                ¥{latest.close?.toFixed(digits)} ({latest.pct_chg >= 0 ? '+' : ''}{latest.pct_chg?.toFixed(2)}%)
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onTriggerStockAI(symbol)}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center space-x-1 shadow"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>AI 单股诊断</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {dataHealth.status === 'mock' && (
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            当前无法连接真实 K 线源，图表为模拟数据，仅用于演示，不应作为交易决策依据。
          </div>
        )}

        {/* Chart Area */}
        {isLoading ? (
          <div className="h-96 flex items-center justify-center text-slate-500">
            行情与 K 线数据加载中...
          </div>
        ) : (
          <div className="h-[340px] sm:h-[430px] w-full">
            <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
          </div>
        )}
        {dataHealth.updatedAt && <p className="text-right text-[10px] text-slate-500">数据源：{dataHealth.source} · 更新于 {dataHealth.updatedAt}</p>}
      </div>
    </div>
  );
};
