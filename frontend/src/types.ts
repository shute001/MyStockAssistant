export interface PositionItem {
  id: number;
  symbol: string;
  name: string;
  cost_price: number;
  current_volume: number;
  available_volume?: number;
  strategy_tag: string;
  current_price: number;
  total_cost: number;
  current_value: number;
  profit_loss: number;
  profit_ratio: number;
  today_profit_loss?: number;
  today_profit_loss_ratio?: number;
  market_value?: number;
  position_weight?: number;
  market_name?: string;
  pct_chg: string;
  ma_trend: string;
  macd_status: string;
  support_price?: number;
  resistance_price?: number;
  condition_count?: number;
  quote_status?: 'live' | 'unavailable' | string;
  quote_updated_at?: string;
}


export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string;
  category: string;
  target_buy_price?: number;
  stop_loss_price?: number;
  remark?: string;
  current_price?: number;
  pct_chg: string;
  ma_trend: string;
  macd_status: string;
  support_price?: number;
  resistance_price?: number;
  quote_status?: 'live' | 'unavailable' | string;
  quote_updated_at?: string;
}

export interface CategoryStat {
  name: string;
  count: number;
}

export interface AnalysisReportItem {
  id: number;
  report_type: string;
  provider_model: string;
  input_summary: string;
  content_md: string;
  generated_at: string;
}

export interface LLMConfigItem {
  id: number;
  provider_name: string;
  api_key_masked: string;
  has_key: boolean;
  base_url?: string;
  selected_model: string;
  is_active: boolean;
}

export interface KLineRecord {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  pct_chg: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  macd_dif?: number;
  macd_dea?: number;
  macd_hist?: number;
}

export interface TradeRecordItem {
  id: number;
  symbol: string;
  name: string;
  trade_type: 'BUY' | 'SELL';
  price: number;
  volume: number;
  amount: number;
  fee?: number;
  strategy_reason?: string;
  is_planned?: boolean;
  trade_tag?: string;
  trade_date: string;
  created_at: string;
}

export type StrategyCategory = 'SHORT_TERM' | 'MID_TERM' | 'LONG_TERM' | 'ETF_FUND' | 'GENERAL';

export interface AgentMemoryItem {
  id: number;
  memory_type: 'MASTER_PLAYBOOK' | 'USER_HABIT' | 'LESSON_LEARNED' | 'TRADING_STYLE' | 'SCREENING_RULE' | 'POSITION_RULE' | string;
  category?: StrategyCategory | string;
  category_label?: string;
  content: string;
  importance: number;
  source_info: string;
  created_at: string;
  updated_at: string;
}

export interface MasterPlaybookItem {
  id: string;
  name: string;
  category?: StrategyCategory | string;
  description: string;
  content: string;
  importance: number;
  is_activated?: boolean;
}

export interface PushConfigItem {
  id?: number;
  channel: 'serverchan' | 'pushplus' | 'wechat_work' | string;
  has_key: boolean;
  secret_key_masked: string;
  is_enabled: boolean;
  auto_push_review: boolean;
}

export type ThemeId = 'indigo' | 'gold' | 'emerald' | 'cyan' | 'rose' | 'apple-silver' | 'apple-warm';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  color: string;
  accentClass: string;
  badgeClass: string;
  desc: string;
}

export type ConditionType =
  | 'TARGET_PROFIT'
  | 'STOP_LOSS'
  | 'MA_CROSS_BELOW'
  | 'MA_CROSS_ABOVE'
  | 'MACD_DEATH_CROSS'
  | 'MACD_GOLDEN_CROSS'
  | 'TRAILING_STOP';

export interface PositionConditionItem {
  id: number;
  symbol: string;
  name: string;
  condition_type: ConditionType;
  condition_label?: string;
  target_value?: number;
  ma_period?: number;
  trail_percent?: number;
  highest_price?: number;
  notify_wechat: boolean;
  notify_popup: boolean;
  is_active: boolean;
  is_triggered: boolean;
  triggered_at?: string;
  trigger_reason?: string;
  strategy_note?: string;
  created_at?: string;
  current_price?: number;
  is_held?: boolean;
}

export interface AlertNotificationItem {
  id: number;
  condition_id?: number;
  symbol: string;
  name: string;
  alert_type: string;
  title: string;
  message: string;
  trigger_price?: number;
  cost_price?: number;
  profit_ratio?: number;
  is_read: boolean;
  wechat_status?: string;
  created_at?: string;
}

export interface SuggestedCondition {
  condition_type: ConditionType;
  condition_label: string;
  target_value?: number;
  ma_period?: number;
  trail_percent?: number;
  strategy_note: string;
  notify_wechat: boolean;
  notify_popup: boolean;
}

export interface AIConditionProposal {
  symbol: string;
  name: string;
  conditions: SuggestedCondition[];
}

export interface BacktestStrategyItem {
  id: string;
  name: string;
  tier: string;
  description: string;
  default_params: Record<string, any>;
}

export interface BacktestPoolItem {
  id: string;
  name: string;
}

export interface BacktestTradeItem {
  trade_id: number;
  symbol: string;
  name: string;
  buy_date: string;
  buy_price: number;
  entry_signal?: string;
  sell_date: string;
  sell_price: number;
  shares: number;
  holding_days: number;
  net_profit: number;
  return_pct: number;
  exit_reason: string;
  total_fee: number;
}

export interface BacktestEquityPoint {
  date: string;
  equity: number;
  cash: number;
  position_count: number;
  benchmark: number;
  drawdown_pct: number;
}

export interface BacktestResult {
  status: string;
  message?: string;
  strategy_id: string;
  strategy_name: string;
  strategy_tier: string;
  strategy_description: string;
  target_desc: string;
  test_days: number;
  start_date?: string;
  end_date?: string;
  date_range_desc?: string;
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  annualized_return_pct: number;
  benchmark_return_pct: number;
  alpha_pct: number;
  win_rate: number;
  profit_loss_ratio: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  sortino_ratio?: number;
  profit_factor?: number;
  annual_volatility?: number;
  beta?: number;
  calmar_ratio: number;
  total_trades: number;
  winning_trades_count: number;
  losing_trades_count: number;
  avg_holding_days: number;
  max_consecutive_losses: number;
  total_friction_fees: number;
  assessment_summary: string;
  equity_curve: BacktestEquityPoint[];
  trades: BacktestTradeItem[];
  monthly_matrix?: Record<string, Record<string, number>>;
  pnl_distribution?: Array<{ label: string; min: number; max: number; count: number }>;
  symbols_with_trades?: Array<{
    symbol: string;
    name: string;
    trades_count: number;
    win_count: number;
    total_profit: number;
  }>;
}




export interface AIOptimizeResult {
  status: string;
  source?: string;
  diagnosis_summary: string;
  key_flaws: string[];
  recommended_params: {
    hard_stop_loss_pct: number;
    target_profit_pct: number;
    max_positions: number;
  };
  rationale: string;
  expected_impact: {
    win_rate: string;
    profit_loss_ratio: string;
    max_drawdown: string;
  };
  market_regime_advice: string;
}
