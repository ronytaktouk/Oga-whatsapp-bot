// OGA WhatsApp Business Assistant - Main Bot Logic
// Handles all message processing, transaction detection, and AI responses

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Import helper functions
const {
  parseNumberFormat,
  parseDateFormat,
  detectBusinessType,
  categorizeExpense,
  formatNaira,
  extractAmounts
} = require('./helpers');
const moment = require('moment-timezone');

// ============================================
// TIME, NUMBERS AND SAFETY HELPERS
// ============================================

const TZ = 'Africa/Lagos';
const TRANSACTION_TYPES = ['sale', 'purchase', 'expense', 'payment_in', 'payment_out'];
const DAILY_MESSAGE_CAP = parseInt(process.env.DAILY_MESSAGE_CAP || '150', 10);

/** Today's date in Lagos time, e.g. "2026-10-26" */
function lagosToday() {
  return moment.tz(TZ).format('YYYY-MM-DD');
}

/** Store numbers as "+234..." — the same format works for Twilio and Meta later */
function normalizeNumber(phone) {
  return (phone || '').replace(/^whatsapp:/, '').trim();
}

/** Twilio needs the "whatsapp:" prefix when sending */
function toWhatsApp(phone) {
  return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
}

/** Turn 5000, "5,000" or "₦5,000" into a number. Returns null if it is not a number. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = parseFloat(String(value).replace(/[₦,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Clean up a party name ("null" or blank → null) */
function cleanParty(party) {
  if (!party) return null;
  const p = String(party).trim();
  return !p || p.toLowerCase() === 'null' ? null : p;
}

/**
 * Check the numbers in a transaction before it is saved.
 * Returns a cleaned transaction, or null if it should not be saved.
 * Paid + balance always adds up to the total.
 */
function sanitizeTransaction(tx, fallbackDate) {
  if (!tx || !TRANSACTION_TYPES.includes(tx.type)) return null;

  const amount = toNumber(tx.amount);
  if (amount === null || amount <= 0) return null;

  let paid = toNumber(tx.paid);
  let balance = toNumber(tx.balance);

  if (tx.type === 'sale' || tx.type === 'purchase') {
    if (paid === null && balance === null) paid = amount; // nothing said = fully paid
    else if (paid === null) paid = amount - balance;
    paid = Math.min(Math.max(paid, 0), amount);
    balance = amount - paid;
  } else {
    paid = amount;
    balance = 0;
  }

  const date = tx.transaction_date && !isNaN(Date.parse(tx.transaction_date))
    ? tx.transaction_date
    : fallbackDate.toISOString();

  return {
    ...tx,
    amount,
    paid,
    balance,
    party: cleanParty(tx.party),
    item: tx.item && String(tx.item).toLowerCase() !== 'null' ? tx.item : null,
    transaction_date: date,
  };
}

// Twilio sometimes resends the same message. Remember recent message IDs to skip repeats.
const recentMessageIds = new Set();
function isDuplicateMessage(messageSid) {
  if (!messageSid) return false;
  if (recentMessageIds.has(messageSid)) return true;
  recentMessageIds.add(messageSid);
  if (recentMessageIds.size > 2000) {
    recentMessageIds.delete(recentMessageIds.values().next().value);
  }
  return false;
}

// Daily message counter per trader (resets each Lagos day, and on restart)
const dailyCounts = new Map();
let dailyCountsDate = lagosToday();
function countMessage(phone) {
  const today = lagosToday();
  if (today !== dailyCountsDate) {
    dailyCounts.clear();
    dailyCountsDate = today;
  }
  const count = (dailyCounts.get(phone) || 0) + 1;
  dailyCounts.set(phone, count);
  return count;
}

// ============================================
// ADDITIONAL HELPER FUNCTIONS
// ============================================

/**
 * Detect if user is asking for a summary or comparison
 */
function isSummaryQuery(message) {
  const msg = message.toLowerCase();
  const summaryKeywords = [
    'summary', 'total', 'how much', 'balance', 'owe',
    'compare', 'last month', 'this month', 'last week',
    'this week', 'this year', 'profit', 'loss', 'sales',
    'expenses', 'breakdown', 'report', 'statement',
    'how many', 'count', 'all transactions'
  ];
  return summaryKeywords.some(keyword => msg.includes(keyword));
}

/**
 * Parse time range from message (e.g., "last month", "this week", "2 weeks ago")
 */
function parseTimeRange(message) {
  const msg = message.toLowerCase();
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  let startDate, endDate;

  // Last month
  if (msg.includes('last month')) {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    startDate = lastMonth.toISOString().split('T')[0];
    endDate = lastMonthEnd.toISOString().split('T')[0];
  }
  // This month
  else if (msg.includes('this month')) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate = monthStart.toISOString().split('T')[0];
    endDate = today;
  }
  // Last week
  else if (msg.includes('last week')) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    startDate = weekAgo.toISOString().split('T')[0];
    endDate = today;
  }
  // This week
  else if (msg.includes('this week')) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    startDate = weekStart.toISOString().split('T')[0];
    endDate = today;
  }
  // X days/weeks ago
  else {
    const daysAgoMatch = msg.match(/(\d+)\s*days?\s*ago/);
    const weeksAgoMatch = msg.match(/(\d+)\s*weeks?\s*ago/);

    if (daysAgoMatch) {
      const days = parseInt(daysAgoMatch[1]);
      const dateAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      startDate = dateAgo.toISOString().split('T')[0];
      endDate = today;
    } else if (weeksAgoMatch) {
      const weeks = parseInt(weeksAgoMatch[1]);
      const dateAgo = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
      startDate = dateAgo.toISOString().split('T')[0];
      endDate = today;
    } else {
      // Default: last 30 days
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = thirtyDaysAgo.toISOString().split('T')[0];
      endDate = today;
    }
  }

  return { startDate, endDate };
}

/**
 * Get comprehensive transaction summary for a time period
 */
async function getTransactionSummary(traderId, startDate, endDate, supabase) {
  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('trader_id', traderId)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false });

    if (error) {
      console.error('❌ Error fetching transactions:', error);
      return null;
    }

    // Calculate totals by type
    const sales = transactions
      ?.filter(t => t.type === 'sale')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

    const purchases = transactions
      ?.filter(t => t.type === 'purchase')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

    const expenses = transactions
      ?.filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

    const paymentsOut = transactions
      ?.filter(t => t.type === 'payment_out')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

    const paymentsIn = transactions
      ?.filter(t => t.type === 'payment_in')
      .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

    // Calculate profit
    const profit = sales - purchases - expenses;

    // Group by category
    const byCategory = {};
    transactions?.forEach(t => {
      const cat = t.category || 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = 0;
      if (t.type === 'expense' || t.type === 'purchase') {
        byCategory[cat] -= (t.total_amount || 0);
      } else {
        byCategory[cat] += (t.total_amount || 0);
      }
    });

    return {
      period: `${startDate} to ${endDate}`,
      totalTransactions: transactions?.length || 0,
      sales: formatNaira(sales),
      purchases: formatNaira(purchases),
      expenses: formatNaira(expenses),
      paymentsIn: formatNaira(paymentsIn),
      paymentsOut: formatNaira(paymentsOut),
      profit: formatNaira(profit),
      byCategory,
      rawData: transactions || []
    };
  } catch (error) {
    console.error('❌ Error in getTransactionSummary:', error);
    return null;
  }
}

// Import system prompt
const SYSTEM_PROMPT = require('./system-prompt');

// Import cron jobs
const { initializeCrons } = require('./crons');

// ============================================
// INITIALIZE EXPRESS APP
// ============================================
const app = express();
app.use(express.urlencoded({ extended: true }));

// ============================================
// INITIALIZE CLIENTS
// ============================================
// Uses the service role key if set (server-side only, bypasses Row Level Security),
// otherwise falls back to the anon key. Never expose the service role key publicly.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// AI model is set by the CLAUDE_MODEL variable in Railway.
// To switch or roll back, change the variable — no code change needed.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============================================
// DATABASE FUNCTIONS
// ============================================

/**
 * Get trader by WhatsApp number
 */
async function getTrader(phone) {
  const number = normalizeNumber(phone);

  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('whatsapp_number', number)
    .maybeSingle();
  if (error) console.error('❌ Error finding trader:', error);
  if (data) return data;

  // Older records were saved as "whatsapp:+234...". Find them and move them to the new format.
  const { data: legacy } = await supabase
    .from('traders')
    .select('*')
    .eq('whatsapp_number', `whatsapp:${number}`)
    .maybeSingle();
  if (!legacy) return null;

  const { error: updateError } = await supabase
    .from('traders')
    .update({ whatsapp_number: number })
    .eq('id', legacy.id);
  if (updateError) {
    console.error('⚠️ Could not update number format, keeping old one:', updateError);
    return legacy;
  }
  return { ...legacy, whatsapp_number: number };
}

/**
 * Create new trader
 */
async function createTrader(phone) {
  const { data, error } = await supabase
    .from('traders')
    .insert({
      whatsapp_number: normalizeNumber(phone),
      subscription_tier: 'trial',
      trial_start: new Date(),
      trial_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      is_active: true,
      language_pref: 'pidgin'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error creating trader:', error);
    return null;
  }

  return data;
}

/**
 * Save transaction to database
 */
async function saveTransaction(traderId, txData) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      trader_id: traderId,
      type: txData.type,
      total_amount: txData.amount,
      amount_paid: txData.paid || 0,
      balance_remaining: txData.balance || 0,
      party_name: txData.party,
      item_description: txData.item,
      category: txData.category || 'other',
      business_type: txData.business_type || 'general',
      notes: txData.notes || '',
      transaction_date: txData.transaction_date || new Date()
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Transaction save error:', error);
    return null;
  }

  return data;
}

/**
 * Apply a correction from the trader ("no be 5k na 3k", or delete after YES).
 * Targets the most recent transaction, or the most recent one with the named person.
 */
async function applyCorrection(traderId, correction) {
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('trader_id', traderId)
    .in('type', TRANSACTION_TYPES);

  const party = cleanParty(correction.party);
  if (party) query = query.ilike('party_name', party);

  const { data: rows, error } = await query
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !rows || rows.length === 0) {
    console.error('⚠️ Correction: no matching transaction found', error || '');
    return false;
  }
  const target = rows[0];

  if (correction.action === 'delete') {
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('id', target.id);
    if (deleteError) {
      console.error('❌ Correction delete error:', deleteError);
      return false;
    }
    console.log(`🗑️ Deleted transaction ${target.id}`);
    return true;
  }

  if (correction.action === 'update') {
    const newAmount = toNumber(correction.amount) ?? Number(target.total_amount);
    if (!(newAmount > 0)) return false;

    let newPaid = newAmount;
    if (target.type === 'sale' || target.type === 'purchase') {
      if (toNumber(correction.paid) !== null) newPaid = toNumber(correction.paid);
      else if (toNumber(correction.balance) !== null) newPaid = newAmount - toNumber(correction.balance);
      else if (Number(target.balance_remaining) === 0) newPaid = newAmount; // was fully paid, still is
      else newPaid = Number(target.amount_paid) || 0;
      newPaid = Math.min(Math.max(newPaid, 0), newAmount);
    }

    const updates = {
      total_amount: newAmount,
      amount_paid: newPaid,
      balance_remaining: newAmount - newPaid,
    };
    if (correction.item && String(correction.item).toLowerCase() !== 'null') {
      updates.item_description = correction.item;
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', target.id);
    if (updateError) {
      console.error('❌ Correction update error:', updateError);
      return false;
    }
    console.log(`✏️ Corrected transaction ${target.id} to ${newAmount}`);
    return true;
  }

  return false;
}

/**
 * Save conversation history
 */
async function saveConversationHistory(traderId, role, content) {
  const { data, error } = await supabase
    .from('conversation_history')
    .insert({
      trader_id: traderId,
      role: role,
      content: content,
    });
  if (error) console.error('❌ Error saving conversation:', error);

  // Keep only last 20 messages
  const { data: allMessages } = await supabase
    .from('conversation_history')
    .select('id')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false });

  if (allMessages && allMessages.length > 20) {
    const idsToDelete = allMessages.slice(20).map((m) => m.id);
    await supabase
      .from('conversation_history')
      .delete()
      .in('id', idsToDelete);
  }

  return data;
}

/**
 * Load trader context for Claude
 */
async function loadTraderContext(traderId, userMessage = '') {
  const today = lagosToday();

  // Get recent transactions (skips any old empty "none" rows)
  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('trader_id', traderId)
    .in('type', TRANSACTION_TYPES)
    .order('created_at', { ascending: false })
    .limit(50);
  if (txError) console.error('❌ Error loading transactions:', txError);

  // Get all party-linked transactions to work out who owes whom
  const { data: partyTx, error: partyError } = await supabase
    .from('transactions')
    .select('party_name, type, total_amount, balance_remaining')
    .eq('trader_id', traderId)
    .not('party_name', 'is', null);
  if (partyError) console.error('❌ Error loading balances:', partyError);

  // Get conversation history (6 = 3 full exchanges)
  const { data: history, error: historyError } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(6);
  if (historyError) console.error('❌ Error loading history:', historyError);

  // Work out balances per person
  // Positive = they owe the trader. Negative = the trader owes them.
  const balances = {};
  (partyTx || []).forEach((t) => {
    const name = (t.party_name || '').trim();
    if (!name || name.toLowerCase() === 'null') return;
    const key = name.toLowerCase();
    if (!balances[key]) balances[key] = { name, amount: 0 };
    const total = Number(t.total_amount) || 0;
    const remaining = Number(t.balance_remaining) || 0;
    if (t.type === 'sale') balances[key].amount += remaining;
    else if (t.type === 'payment_in') balances[key].amount -= total;
    else if (t.type === 'purchase') balances[key].amount -= remaining;
    else if (t.type === 'payment_out') balances[key].amount += total;
  });
  const outstandingBalances = Object.values(balances)
    .filter((b) => Math.round(b.amount) !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 20);

  // Calculate today's summary (in Lagos time)
  const isToday = (t) =>
    t.transaction_date && moment.tz(t.transaction_date, TZ).format('YYYY-MM-DD') === today;

  const todaySales = transactions
    ?.filter((t) => t.type === 'sale' && isToday(t))
    .reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0) || 0;

  const todayExpenses = transactions
    ?.filter((t) => t.type === 'expense' && isToday(t))
    .reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0) || 0;

  // Check if user is asking for a summary
  let summaryData = null;
  if (isSummaryQuery(userMessage)) {
    const timeRange = parseTimeRange(userMessage);
    summaryData = await getTransactionSummary(
      traderId,
      timeRange.startDate,
      timeRange.endDate,
      supabase
    );
  }

  return {
    todaySales,
    todayExpenses,
    recentTransactions: transactions?.slice(0, 10) || [],
    outstandingBalances,
    conversationHistory: history || [],
    summaryData
  };
}

/**
 * Send WhatsApp message via Twilio
 */
async function sendMessage(to, message) {
  try {
    const chunks = message.match(/[\s\S]{1,1600}/g) || [message];
    for (const chunk of chunks) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: toWhatsApp(to),
        body: chunk,
      });
    }
    console.log(`📤 Message sent to ${to}`);
  } catch (error) {
    // Only log. The old code put OGA's own reply into the incoming message queue,
    // which would later be processed as if the trader had sent it.
    console.error('❌ Error sending message:', error);
  }
}

// ============================================
// ONBOARDING FLOW
// ============================================

async function handleOnboarding(from, trader, message) {
  if (!trader.name) {
    // Collect name
    await supabase
      .from('traders')
      .update({ name: message.trim() })
      .eq('id', trader.id);

    await sendMessage(
      from,
      `Good to meet you ${message.trim()}! 🙏\nChoose a 4-digit PIN to protect your account — you will need it if you ever change your number.`
    );
  } else if (!trader.pin) {
    // Collect PIN
    if (message.length !== 4 || !/^\d+$/.test(message)) {
      await sendMessage(from, 'Please enter a valid 4-digit PIN');
      return;
    }

    const hashedPin = await bcrypt.hash(message, 10);
    await supabase
      .from('traders')
      .update({ pin: hashedPin })
      .eq('id', trader.id);

    await sendMessage(
      from,
      `✅ You are all set ${trader.name}!\nJust talk to me normally — tell me what happens in your business and I handle the rest.\nWhat happened today? 🚀`
    );
  }
}

// ============================================
// MESSAGE HANDLER - MAIN LOGIC
// ============================================

async function handleMessage(from, trader, message, messageTimestamp = new Date(), options = {}) {
  let recordsTouched = false;
  try {
    // Load trader context (pass message for summary detection)
    const context = await loadTraderContext(trader.id, message);

    // Format message date for Claude context (Lagos time)
    const messageDateFormatted = messageTimestamp.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: TZ,
    });

    // Build conversation history for Claude
    const messages = [];
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      context.conversationHistory.reverse().forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    }
    // Claude requires the conversation to start with a user message
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    // Build the trader's saved records so OGA remembers past transactions
    let recordsBlock = `\n\n[BUSINESS_RECORDS]\n`;
    recordsBlock += `These are this trader's saved records from the database. Use them to answer questions about past transactions and who owes whom. Never invent records that are not listed here.\n`;
    recordsBlock += `Today so far: Sales ${formatNaira(context.todaySales)}, Expenses ${formatNaira(context.todayExpenses)}\n`;

    if (context.outstandingBalances.length > 0) {
      recordsBlock += `\nOutstanding balances:\n`;
      context.outstandingBalances.forEach((b) => {
        recordsBlock += b.amount > 0
          ? `- ${b.name} owes the trader ${formatNaira(b.amount)}\n`
          : `- The trader owes ${b.name} ${formatNaira(Math.abs(b.amount))}\n`;
      });
    } else {
      recordsBlock += `\nOutstanding balances: none\n`;
    }

    if (context.recentTransactions.length > 0) {
      recordsBlock += `\nLast ${context.recentTransactions.length} transactions (newest first):\n`;
      context.recentTransactions.forEach((t) => {
        const date = (t.transaction_date || t.created_at || '').toString().split('T')[0];
        const parts = [date, t.type, t.party_name, t.item_description, formatNaira(t.total_amount || 0)];
        if (t.amount_paid) parts.push(`paid ${formatNaira(t.amount_paid)}`);
        if (t.balance_remaining) parts.push(`balance ${formatNaira(t.balance_remaining)}`);
        recordsBlock += `- ${parts.filter(Boolean).join(' | ')}\n`;
      });
    } else {
      recordsBlock += `\nNo transactions recorded yet.\n`;
    }
    recordsBlock += `[/BUSINESS_RECORDS]`;

    // Build user message with context
    let userMessageContent = `[Sent: ${messageDateFormatted}]\n${message}${recordsBlock}`;

    // If summary is requested, add summary data to Claude's context
    if (context.summaryData) {
      console.log(`📊 Summary query detected - attaching period data`);
      userMessageContent += `\n\n[TRANSACTION_SUMMARY]\n`;
      userMessageContent += `Period: ${context.summaryData.period}\n`;
      userMessageContent += `Total Transactions: ${context.summaryData.totalTransactions}\n`;
      userMessageContent += `Sales: ${context.summaryData.sales}\n`;
      userMessageContent += `Purchases: ${context.summaryData.purchases}\n`;
      userMessageContent += `Expenses: ${context.summaryData.expenses}\n`;
      userMessageContent += `Profit: ${context.summaryData.profit}\n`;

      // Add category breakdown
      if (Object.keys(context.summaryData.byCategory).length > 0) {
        userMessageContent += `\nBy Category:\n`;
        for (const [cat, amount] of Object.entries(context.summaryData.byCategory)) {
          userMessageContent += `- ${cat}: ${formatNaira(amount)}\n`;
        }
      }
      userMessageContent += `[/TRANSACTION_SUMMARY]`;
    }

    // Add current message
    messages.push({
      role: 'user',
      content: userMessageContent,
    });

    // Call Claude API with system prompt
    // Caching is NOT automatic: cache_control marks the fixed system prompt
    // for caching, so repeat messages pay much less for it.
    console.log(`🤖 Calling Claude (${CLAUDE_MODEL}) for ${trader.name}...`);
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: messages,
    });

    const fullText = response.content[0].text;
    console.log(`✅ Claude responded (${fullText.length} chars)`);

    // Remove all [TRANSACTION] blocks from what the trader sees
    const responseText = fullText
      .replace(/\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g, '')
      .trim();

    // From here on, records may be saved. If anything fails after this point,
    // the message must NOT be retried, or the sale would be saved twice.
    recordsTouched = true;

    // Read EVERY transaction block (multi-item messages have several)
    const blocks = [...fullText.matchAll(/\[TRANSACTION\]\s*(\{[\s\S]*?\})\s*\[\/TRANSACTION\]/g)];
    let savedCount = 0;

    for (const block of blocks) {
      let tx;
      try {
        tx = JSON.parse(block[1].trim());
      } catch (e) {
        console.error('⚠️ Transaction parse error:', e.message);
        continue;
      }

      if (!tx || tx.type === 'none') continue;

      if (tx.type === 'correction') {
        await applyCorrection(trader.id, tx);
        continue;
      }

      const clean = sanitizeTransaction(tx, messageTimestamp);
      if (!clean) {
        console.error('⚠️ Skipped invalid transaction:', JSON.stringify(tx));
        continue;
      }
      if (!clean.business_type) clean.business_type = detectBusinessType(message);

      const saved = await saveTransaction(trader.id, clean);
      if (saved) {
        savedCount++;
        console.log(`💾 Saved ${clean.type} ₦${clean.amount} (paid ${clean.paid}, balance ${clean.balance})`);
      }
    }
    if (blocks.length > 0) console.log(`📒 ${savedCount} of ${blocks.length} blocks saved`);

    // Save conversation history
    await saveConversationHistory(trader.id, 'user', message);
    await saveConversationHistory(trader.id, 'assistant', responseText);

    // Update trader's last_active timestamp
    await supabase
      .from('traders')
      .update({ last_active: new Date() })
      .eq('id', trader.id);

    // Send response to user
    console.log(`💬 Sending to ${from}: ${responseText.substring(0, 100)}...`);
    await sendMessage(from, responseText);

  } catch (error) {
    console.error('❌ Error handling message:', error);

    // Records were already saved, so retrying would duplicate them. Stop here.
    if (recordsTouched) return;

    // A retry from the queue failed again: log it and stop, so it can't loop forever.
    if (options.fromQueue) {
      console.error(`❌ Queued message from ${from} failed again, not retrying`);
      return;
    }

    // Send error message to user
    await sendMessage(
      from,
      'OGA is resting briefly 😴\nYour message is safe and waiting.\nBack in under 5 minutes. Sorry for the wait 🙏'
    );

    // Queue the message for retry (crons.js picks it up every 5 minutes)
    await supabase.from('message_queue').insert({
      whatsapp_number: normalizeNumber(from),
      message_content: message,
      received_at: messageTimestamp,
      processed: false,
    });
  }
}

/**
 * Re-run a message that failed earlier (called by the queue job in crons.js)
 */
async function processQueuedMessage(whatsappNumber, content, receivedAt) {
  const trader = await getTrader(whatsappNumber);
  if (!trader) {
    console.error(`⚠️ Queued message: no trader for ${whatsappNumber}`);
    return;
  }
  await handleMessage(
    normalizeNumber(whatsappNumber),
    trader,
    content,
    receivedAt ? new Date(receivedAt) : new Date(),
    { fromQueue: true }
  );
}

// ============================================
// WEBHOOK ENDPOINT
// ============================================

app.post('/webhook', async (req, res) => {
  try {
    // 1. Only accept requests that really come from Twilio.
    // Set SKIP_TWILIO_VALIDATION=true in Railway only for emergency debugging.
    if (process.env.SKIP_TWILIO_VALIDATION !== 'true') {
      const signature = req.get('X-Twilio-Signature') || '';
      const url = process.env.WEBHOOK_URL || `https://${req.get('host')}${req.originalUrl}`;
      const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
      if (!valid) {
        console.error(`🚫 Rejected request with invalid Twilio signature (checked against ${url})`);
        return res.status(403).send('Forbidden');
      }
    }

    // 2. Skip messages Twilio has already sent once
    if (isDuplicateMessage(req.body.MessageSid)) {
      console.log(`🔁 Duplicate message ${req.body.MessageSid} skipped`);
      return res.status(200).send('OK');
    }

    const from = normalizeNumber(req.body.From);
    const message = req.body.Body?.trim();
    const messageTimestamp = req.body.Timestamp ? new Date(parseInt(req.body.Timestamp) * 1000) : new Date();

    if (!from) {
      return res.status(400).send('Missing From');
    }

    // 3. Voice notes, photos and other media with no text
    if (!message) {
      if (parseInt(req.body.NumMedia || '0', 10) > 0) {
        await sendMessage(
          from,
          `I see your voice note or picture 🙏 I no fit read those yet — abeg type am for me.`
        );
      }
      return res.status(200).send('OK');
    }

    // Log without the message text (traders' money details stay out of the logs)
    console.log(`📨 Message from ${from} [${messageTimestamp.toISOString()}] (${message.length} chars)`);

    // Get or create trader
    let trader = await getTrader(from);
    if (!trader) {
      trader = await createTrader(from);
      if (!trader) return res.status(500).send('Error');
      console.log(`✨ New trader created: ${from}`);

      await sendMessage(
        from,
        `👋 Welcome to OGA!\nI manage your business money right here on WhatsApp.\nNo app needed.\nWhat is your name?`
      );
      return res.status(200).send('OK');
    }

    // Check if onboarding incomplete
    if (!trader.name || !trader.pin) {
      await handleOnboarding(from, trader, message);
      return res.status(200).send('OK');
    }

    // 4. Daily message cap (protects costs; set DAILY_MESSAGE_CAP in Railway)
    const count = countMessage(from);
    if (count > DAILY_MESSAGE_CAP) {
      if (count === DAILY_MESSAGE_CAP + 1) {
        await sendMessage(
          from,
          `You don reach today's message limit 🙏 OGA go dey ready for you again tomorrow morning.`
        );
      }
      return res.status(200).send('OK');
    }

    // Respond immediately to Twilio FIRST (prevents timeout)
    res.status(200).send('OK');

    // Detect multi-line/multi-item messages (expenses, transactions listed vertically)
    const lineCount = message.split('\n').filter(line => line.trim()).length;
    const isMultiItem = lineCount > 3; // More than 3 lines = likely multi-item

    // Send acknowledgment in background (don't wait)
    if (isMultiItem) {
      console.log(`📝 Multi-item message detected (${lineCount} lines) - sending immediate ack`);
      sendMessage(from, `📝 Recording ${lineCount} items...`).catch(err => console.error('Ack send error:', err));
    }

    // Process message in background (don't wait for Twilio)
    handleMessage(from, trader, message, messageTimestamp).catch(error => {
      console.error(`❌ Background processing error for ${from}:`, error);
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Error');
  }
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('🤖 OGA Bot running on port ' + PORT);
  console.log('💬 Webhook: http://localhost:' + PORT + '/webhook');
  console.log('❤️  Health: http://localhost:' + PORT + '/health');
  console.log('='.repeat(50) + '\n');

  // Initialize cron jobs (the queue job needs a way to re-run failed messages)
  initializeCrons(supabase, twilioClient, anthropic, { processQueuedMessage });
});