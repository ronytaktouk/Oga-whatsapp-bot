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
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('whatsapp_number', phone)
    .single();
  return data;
}

/**
 * Create new trader
 */
async function createTrader(phone) {
  const { data, error } = await supabase
    .from('traders')
    .insert({
      whatsapp_number: phone,
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
  const today = new Date().toISOString().split('T')[0];

  // Get recent transactions
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Get conversation history (reduced from 10 to 5 for better token efficiency)
  const { data: history } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(5);

  // Calculate today's summary
  const todaySales = transactions
    ?.filter(
      (t) =>
        t.type === 'sale' &&
        t.transaction_date &&
        t.transaction_date.startsWith(today)
    )
    .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

  const todayExpenses = transactions
    ?.filter(
      (t) =>
        t.type === 'expense' &&
        t.transaction_date &&
        t.transaction_date.startsWith(today)
    )
    .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

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
        to: to,
        body: chunk,
      });
    }
    console.log(`📤 Message sent to ${to}`);
  } catch (error) {
    console.error('❌ Error sending message:', error);
    // Queue the message for retry
    await supabase.from('message_queue').insert({
      whatsapp_number: to,
      message_content: message,
      received_at: new Date()
    });
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

async function handleMessage(from, trader, message, messageTimestamp = new Date()) {
  try {
    // Load trader context (pass message for summary detection)
    const context = await loadTraderContext(trader.id, message);

    // Format message date for Claude context
    const messageDateStr = messageTimestamp.toISOString().split('T')[0];
    const messageDateFormatted = messageTimestamp.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
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

    // Build user message with context
    let userMessageContent = `[Sent: ${messageDateFormatted}]\n${message}`;

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
    // Note: Prompt caching is automatically enabled by Claude SDK when system prompt is provided
    console.log(`🤖 Calling Claude for ${trader.name}...`);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    const fullText = response.content[0].text;
    console.log(`✅ Claude responded (${fullText.length} chars)`);

    // Parse transaction if present
    const transactionMatch = fullText.match(
      /\[TRANSACTION\]\s*(\{[\s\S]*?\})\s*\[\/TRANSACTION\]/
    );
    let transaction = null;
    let responseText = fullText;

    if (transactionMatch) {
      try {
        transaction = JSON.parse(transactionMatch[1].trim());
        console.log(`✅ Transaction detected: ${transaction.type}`);

        // Auto-detect business type if not provided
        if (!transaction.business_type) {
          transaction.business_type = detectBusinessType(message);
        }

        // Remove the [TRANSACTION] block from user response
        responseText = fullText
          .replace(/\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g, '')
          .trim();
      } catch (e) {
        console.error('⚠️ Transaction parse error:', e.message);
        // Still remove the block even if parsing failed
        responseText = fullText
          .replace(/\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g, '')
          .trim();
      }
    }

    // Save transaction if detected
    if (transaction) {
      // Use message timestamp as default transaction date if not provided by Claude
      if (!transaction.transaction_date) {
        transaction.transaction_date = messageTimestamp.toISOString();
      }
      await saveTransaction(trader.id, transaction);
      console.log(`💾 Saved transaction: ${transaction.type} on ${transaction.transaction_date}`);
    }

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

    // Send error message to user
    await sendMessage(
      from,
      'OGA is resting briefly 😴\nYour message is safe and waiting.\nBack in under 5 minutes. Sorry for the wait 🙏'
    );

    // Queue the message for retry
    await supabase.from('message_queue').insert({
      whatsapp_number: from,
      message_content: message,
      received_at: new Date()
    });
  }
}

// ============================================
// WEBHOOK ENDPOINT
// ============================================

app.post('/webhook', async (req, res) => {
  try {
    const from = req.body.From;
    const message = req.body.Body?.trim();
    const messageTimestamp = req.body.Timestamp ? new Date(parseInt(req.body.Timestamp) * 1000) : new Date();

    if (!from || !message) {
      return res.status(400).send('Missing From or Body');
    }

    console.log(`📨 Message from ${from} [${messageTimestamp.toISOString()}]: ${message.substring(0, 50)}...`);

    // Get or create trader
    let trader = await getTrader(from);
    if (!trader) {
      trader = await createTrader(from);
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

    // Detect multi-line/multi-item messages (expenses, transactions listed vertically)
    const lineCount = message.split('\n').filter(line => line.trim()).length;
    const isMultiItem = lineCount > 3; // More than 3 lines = likely multi-item

    if (isMultiItem) {
      // Send immediate acknowledgment for multi-item messages
      console.log(`📝 Multi-item message detected (${lineCount} lines) - sending immediate ack`);
      await sendMessage(from, `📝 Recording ${lineCount} items...`);
    }

    // Respond immediately to Twilio (prevents timeout)
    res.status(200).send('OK');

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

  // Initialize cron jobs
  initializeCrons(supabase, twilioClient, anthropic);
});
