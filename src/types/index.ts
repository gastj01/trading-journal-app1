export type Side = 'long' | 'short'
export type TradeStatus = 'open' | 'closed'
export type AccountType = 'live' | 'demo' | 'prop' | 'backtest'
export type TagType = 'mistake' | 'execution' | 'context'
export type ManagementEventType =
  | 'limit_placed'
  | 'limit_filled'
  | 'partial_close'
  | 'manual_exit'
  | 'sl_moved_to_be'
  | 'sl_moved_manual'
  | 'sl_hit'
  | 'tp_moved_manual'
  | 'tp_hit'
  | 'note'

export interface TradingAccount {
  id: string
  user_id: string
  name: string
  account_type: AccountType
  initial_balance: number
  currency: string
  platform: string
  description: string
  default_market: string
  default_symbol: string
  default_exchange: string
  default_timeframe: string
  is_default: boolean
  is_active: boolean
  default_risk_percent: number
  default_leverage: number
  created_at: string
  updated_at: string
}

export interface Trade {
  id: string
  user_id: string
  account_id: string
  strategy_id: string | null
  symbol: string
  market: string
  exchange: string
  timeframe: string
  side: Side
  status: TradeStatus
  entry_price: number
  stop_loss: number
  exit_price: number | null
  break_even: boolean
  position_size: number
  risk_amount: number
  risk_percent: number
  leverage: number
  setup: string
  notes: string
  ki_notes: string | null
  ki_sample_reviewed_at: string | null
  screenshot_path: string | null
  chart_time_label: string | null
  trade_data_quality: string | null
  opened_at: string
  closed_at: string | null
  created_at: string
  updated_at: string
  // joined
  partial_profits?: PartialProfit[]
  management_events?: ManagementEvent[]
  tags?: TradeTag[]
}

export interface PartialProfit {
  id: string
  trade_id: string
  user_id: string
  label: string
  target_price: number
  quantity_percent: number
  filled: boolean
  filled_price: number | null
  filled_at: string | null
  created_at: string
}

export interface ManagementEvent {
  id: string
  trade_id: string
  user_id: string
  event_type: ManagementEventType
  event_time: string
  price: number
  size_percent: number | null
  note: string
  created_at: string
}

export interface TagDefinition {
  id: string
  user_id: string
  name: string
  tag_type: TagType
  created_at: string
}

export interface TradeTag {
  id: string
  trade_id: string
  tag_id: string
  tag?: TagDefinition
}

export interface StrategyProfile {
  id: string
  user_id: string
  name: string
  description: string
  tp1_close_percent: number
  default_tp1_r_multiple: number
  move_remaining_to_be_after_tp1: boolean
  default_timeframe: string | null
  created_at: string
  updated_at: string
}

export interface TradeScreenshot {
  id: string
  trade_id: string
  url: string
  created_at: string
}

export interface ChecklistItem {
  id: string
  user_id: string
  strategy_id: string | null
  kind: string
  category: string
  title: string
  description: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ChecklistResponse {
  id: string
  user_id: string
  trade_id: string
  checklist_item_id: string
  status: 'checked' | 'unchecked'
  notes: string | null
  created_at: string
  updated_at: string
}

// Computed stats
export interface TradeStats {
  totalTrades: number
  winRate: number
  avgR: number
  profitFactor: number
  totalR: number
  maxDrawdown: number
  bestDay: string
  worstDay: string
}
