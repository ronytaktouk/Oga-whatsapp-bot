-- Create traders table
CREATE TABLE IF NOT EXISTS traders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  pin VARCHAR(255),
  language_pref VARCHAR(20) DEFAULT 'english',
  subscription_tier VARCHAR(20) DEFAULT 'trial',
  trial_end TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- sale, purchase, expense, payment_in, payment_out
  total_amount DECIMAL(15, 2),
  amount_paid DECIMAL(15, 2),
  balance_remaining DECIMAL(15, 2),
  party_name VARCHAR(100),
  item_description TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create parties table
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20), -- customer, supplier
  running_balance DECIMAL(15, 2) DEFAULT 0,
  phone VARCHAR(20),
  last_transaction TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create reminders table
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  reminder_type VARCHAR(50), -- self, other, recurring, cash_check
  message TEXT,
  amount DECIMAL(15, 2),
  party_name VARCHAR(100),
  party_whatsapp VARCHAR(20),
  scheduled_time TIMESTAMP WITH TIME ZONE,
  recurring VARCHAR(20), -- weekly, daily, monthly
  recurring_day VARCHAR(20),
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, cancelled, completed
  escalation_level INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create conversation_history table
CREATE TABLE IF NOT EXISTS conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id UUID NOT NULL REFERENCES traders(id) ON DELETE CASCADE,
  role VARCHAR(20), -- user, assistant
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_traders_whatsapp ON traders(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_transactions_trader_id ON transactions(trader_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_parties_trader_id ON parties(trader_id);
CREATE INDEX IF NOT EXISTS idx_reminders_trader_id ON reminders(trader_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_conversation_history_trader_id ON conversation_history(trader_id);
