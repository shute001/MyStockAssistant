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

