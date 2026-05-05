// OGA WhatsApp Business Assistant - Main Bot Logic
// Handles all message processing, transaction detection, and AI responses

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const bcrypt = require('bcrypt');
const ws = require('ws');
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
  process.env.SUPABASE_ANON_KEY,
  {
    realtime: {
      transport: ws
    }
  }
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
      is_active: true
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
 * Load trader context for Claude - Fresh data every message
 */
async function loadTraderContext(traderId) {
  const today = new Date().toISOString().split('T')[0];

  // CONVERSATION MEMORY: Last 30 messages for conversational context
  const { data: history } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(30);

  // FINANCIAL MEMORY: All transactions (for accurate balances and summaries)
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(100);

  // PRODUCTS: All products or top 20 by times_sold
  const { data: allProducts } = await supabase
    .from('products')
    .select('*')
    .eq('trader_id', traderId)
    .order('times_sold', { ascending: false })
    .limit(20);

  // PARTIES: All parties with outstanding balances + top by transaction count
  const { data: allParties } = await supabase
    .from('parties')
    .select('*')
    .eq('trader_id', traderId)
    .order('transaction_count', { ascending: false })
    .limit(15);

  // Get trader subscription status
  const { data: trader } = await supabase
    .from('traders')
    .select('subscription_tier, trial_end')
    .eq('id', traderId)
    .single();

  // Calculate party balances (who owes how much)
  const partyBalances = {};
  transactions?.forEach((t) => {
    if (t.party_name && (t.type === 'sale' || t.type === 'payment_in')) {
      if (!partyBalances[t.party_name]) {
        partyBalances[t.party_name] = { owed: 0, paid: 0 };
      }
      partyBalances[t.party_name].owed += t.total_amount || 0;
      partyBalances[t.party_name].paid += t.amount_paid || 0;
    }
  });

  // Calculate outstanding balances
  const outstandingBalances = Object.entries(partyBalances)
    .map(([party, data]) => ({
      party,
      outstanding: (data.owed - data.paid) || 0
    }))
    .filter(b => b.outstanding > 0);

  // Calculate today's summary
  const todaySales = transactions
    ?.filter(
      (t) =>
        t.type === 'sale' &&
        t.transaction_date && t.transaction_date.startsWith(today)
    )
    .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

  const todayExpenses = transactions
    ?.filter(
      (t) =>
        t.type === 'expense' &&
        t.transaction_date && t.transaction_date.startsWith(today)
    )
    .reduce((sum, t) => sum + (t.total_amount || 0), 0) || 0;

  const todayCollected = transactions
    ?.filter(
      (t) =>
        (t.type === 'payment_in' || t.type === 'sale') &&
        t.transaction_date && t.transaction_date.startsWith(today)
    )
    .reduce((sum, t) => sum + (t.amount_paid || 0), 0) || 0;

  const totalOutstanding = outstandingBalances.reduce((sum, b) => sum + b.outstanding, 0) || 0;

  return {
    conversationHistory: history || [],
    recentTransactions: transactions?.slice(0, 5) || [],
    partyBalances: outstandingBalances,
    products: allProducts || [],
    parties: allParties || [],
    todaySales,
    todayExpenses,
    todayCollected,
    totalOutstanding,
    subscriptionStatus: trader?.subscription_tier || 'trial',
    trialEndsAt: trader?.trial_end || null
  };
}

/**
 * Check daily message limit (40 messages per day, Lagos timezone UTC+1)
 */
async function checkDailyMessageLimit(traderId) {
  // Calculate today's start in Lagos timezone (UTC+1)
  const now = new Date();
  const lagosTime = new Date(now.getTime() + (1 * 60 * 60 * 1000)); // Add 1 hour for Lagos offset
  const todayStart = new Date(lagosTime.getFullYear(), lagosTime.getMonth(), lagosTime.getDate());
  const todayStartUTC = new Date(todayStart.getTime() - (1 * 60 * 60 * 1000)); // Convert back to UTC

  // Count user messages sent today (role = 'user' only)
  const { data: todayMessages } = await supabase
    .from('conversation_history')
    .select('id')
    .eq('trader_id', traderId)
    .eq('role', 'user')
    .gte('created_at', todayStartUTC.toISOString());

  const messageCount = todayMessages?.length || 0;

  return {
    count: messageCount,
    remaining: Math.max(0, 40 - messageCount),
    hasReachedLimit: messageCount >= 40,
    isWarning: messageCount >= 38 && messageCount < 40
  };
}

/**
 * Save or update product price
 */
async function saveProduct(traderId, productName, sellPrice, buyPrice = null) {
  const { data, error } = await supabase
    .from('products')
    .upsert({
      trader_id: traderId,
      product_name: productName,
      sell_price: sellPrice,
      buy_price: buyPrice || 0,
      updated_at: new Date()
    }, { onConflict: 'trader_id,product_name' })
    .select()
    .single();

  if (error) {
    console.error('❌ Error saving product:', error);
    return null;
  }

  return data;
}

/**
 * Update product after sale
 */
async function updateProductAfterSale(traderId, productName, soldPrice) {
  const { data: existing } = await supabase
    .from('products')
    .select('times_sold')
    .eq('trader_id', traderId)
    .eq('product_name', productName)
    .single();

  const { data, error } = await supabase
    .from('products')
    .update({
      times_sold: (existing?.times_sold || 0) + 1,
      last_sold_price: soldPrice,
      last_sold_at: new Date(),
      sell_price: soldPrice,
      updated_at: new Date()
    })
    .eq('trader_id', traderId)
    .eq('product_name', productName)
    .select()
    .single();

  if (error) {
    console.error('❌ Error updating product:', error);
    return null;
  }

  return data;
}

/**
 * Get product price
 */
async function getProduct(traderId, productName) {
  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('trader_id', traderId)
    .eq('product_name', productName)
    .single();

  return data || null;
}

/**
 * Save or update party (client/supplier)
 */
async function saveParty(traderId, partyName, balanceChange = 0, lastTransaction = null) {
  // Get existing balance if party exists
  const { data: existing } = await supabase
    .from('parties')
    .select('balance, transaction_count')
    .eq('trader_id', traderId)
    .eq('party_name', partyName)
    .single();

  const newBalance = (existing?.balance || 0) + balanceChange;
  const newCount = (existing?.transaction_count || 0) + 1;

  const { data, error } = await supabase
    .from('parties')
    .upsert({
      trader_id: traderId,
      party_name: partyName,
      balance: newBalance,
      transaction_count: newCount,
      last_seen: new Date(),
      last_transaction: lastTransaction || null,
      updated_at: new Date()
    }, { onConflict: 'trader_id,party_name' })
    .select()
    .single();

  if (error) {
    console.error('❌ Error saving party:', error);
    return null;
  }

  return data;
}

/**
 * Get party info
 */
async function getParty(traderId, partyName) {
  const { data } = await supabase
    .from('parties')
    .select('*')
    .eq('trader_id', traderId)
    .eq('party_name', partyName)
    .single();

  return data || null;
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
  if (!trader.language_pref) {
    // STEP 1: Collect language preference
    const choice = message.trim().toLowerCase();
    let languagePref = null;

    if (choice === '1' || choice === 'english') {
      languagePref = 'english';
    } else if (choice === '2' || choice === 'pidgin') {
      languagePref = 'pidgin';
    } else {
      await sendMessage(
        from,
        'Please reply: 1 for English or 2 for Pidgin'
      );
      return;
    }

    await supabase
      .from('traders')
      .update({ language_pref: languagePref })
      .eq('id', trader.id);

    await sendMessage(
      from,
      'Thank you! 🙏\nWhat is your name?'
    );
  } else if (!trader.name) {
    // STEP 2: Collect name
    await supabase
      .from('traders')
      .update({ name: message.trim() })
      .eq('id', trader.id);

    await sendMessage(
      from,
      `Good to meet you ${message.trim()}! 🙏\nChoose a 4-digit PIN to protect your account — you will need it if you ever change your number.`
    );
  } else if (!trader.pin) {
    // STEP 3: Collect PIN
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

async function handleMessage(from, trader, message) {
  try {
    // CHECK DAILY MESSAGE LIMIT (40 messages per day, Lagos time)
    const limitStatus = await checkDailyMessageLimit(trader.id);

    if (limitStatus.hasReachedLimit) {
      // User has hit the 40 message daily limit
      await sendMessage(
        from,
        `You have reached today's limit of 40 messages ${trader.name}.\nI reset at midnight tonight Lagos time.\nYour records are all safe — nothing is lost.\nSee you tomorrow! 🌙`
      );
      return;
    }

    // Load trader context
    const context = await loadTraderContext(trader.id);

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

    // Add current message
    messages.push({
      role: 'user',
      content: message,
    });

    // BUILD EXTENDED SYSTEM PROMPT WITH TRADER CONTEXT
    let extendedSystemPrompt = SYSTEM_PROMPT;

    // Add products context
    if (context.products && context.products.length > 0) {
      const productsList = context.products
        .map(p => `${p.product_name} (₦${p.sell_price}, sold ${p.times_sold}x)`)
        .join(' | ');
      extendedSystemPrompt += `\n\nYOUR PRODUCTS: ${productsList}`;
    }

    // Add parties context
    if (context.parties && context.parties.length > 0) {
      const partiesList = context.parties
        .filter(p => p.balance !== 0)
        .map(p => `${p.party_name} ${p.balance > 0 ? '(owes ₦' + p.balance + ')' : '(you owe ₦' + Math.abs(p.balance) + ')'}`)
        .join(' | ');
      if (partiesList) {
        extendedSystemPrompt += `\n\nYOUR CLIENTS: ${partiesList}`;
      }
    }

    // Call Claude API with extended system prompt
    console.log(`🤖 Calling Claude for ${trader.name}...`);
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: extendedSystemPrompt,
      messages: messages,
    });

    const fullText = response.content[0].text;
    console.log(`✅ Claude responded (${fullText.length} chars)`);

    // Parse language switch if present
    const languageSwitchMatch = fullText.match(
      /\[LANGUAGE_SWITCH\](english|pidgin)\[\/LANGUAGE_SWITCH\]/i
    );
    let responseText = fullText;

    if (languageSwitchMatch) {
      const newLanguage = languageSwitchMatch[1].toLowerCase();
      await supabase
        .from('traders')
        .update({ language_pref: newLanguage })
        .eq('id', trader.id);
      console.log(`🌐 Language switched to: ${newLanguage}`);

      // Remove the [LANGUAGE_SWITCH] block from user response
      responseText = fullText
        .replace(/\[LANGUAGE_SWITCH\](english|pidgin)\[\/LANGUAGE_SWITCH\]/gi, '')
        .trim();
    }

    // Parse transaction if present
    const transactionMatch = responseText.match(
      /\[TRANSACTION\]\s*(\{[\s\S]*?\})\s*\[\/TRANSACTION\]/
    );
    let transaction = null;

    if (transactionMatch) {
      try {
        transaction = JSON.parse(transactionMatch[1].trim());
        console.log(`✅ Transaction detected: ${transaction.type}`);

        // Auto-detect business type if not provided
        if (!transaction.business_type) {
          transaction.business_type = detectBusinessType(message);
        }

        // PRICE LOGIC: Check if transaction involves a known product
        if (transaction && transaction.item) {
          const existingProduct = await getProduct(trader.id, transaction.item);

          if (existingProduct) {
            // Product known: use last price
            transaction.amount = transaction.amount || existingProduct.sell_price;
            console.log(`✅ Using known price for ${existingProduct.product_name}: ₦${existingProduct.sell_price}`);
          }
        }

        // Remove the [TRANSACTION] block from user response
        responseText = responseText
          .replace(/\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g, '')
          .trim();
      } catch (e) {
        console.error('⚠️ Transaction parse error:', e.message);
        // Still remove the block even if parsing failed
        responseText = responseText
          .replace(/\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g, '')
          .trim();
      }
    }

    // Save transaction if detected
    if (transaction) {
      await saveTransaction(trader.id, transaction);
      console.log(`💾 Saved transaction: ${transaction.type}`);

      // UPDATE PRODUCT HISTORY
      if (transaction.type === 'sale' && transaction.item) {
        await updateProductAfterSale(trader.id, transaction.item, transaction.amount);
        console.log(`📦 Updated product sales count: ${transaction.item}`);
      }

      if (transaction.type === 'purchase' && transaction.item) {
        await saveProduct(trader.id, transaction.item, null, transaction.amount);
        console.log(`📦 Saved purchase product: ${transaction.item}`);
      }

      // CLIENT LOGIC: Track party balance
      if (transaction.party) {
        let balanceChange = 0;

        if (transaction.type === 'sale' || transaction.type === 'purchase') {
          balanceChange = transaction.amount - (transaction.paid || 0);
        } else if (transaction.type === 'payment_in') {
          balanceChange = -(transaction.amount); // Reduces their debt
        } else if (transaction.type === 'payment_out') {
          balanceChange = transaction.amount; // Increases what trader owes
        }

        if (balanceChange !== 0) {
          await saveParty(
            trader.id,
            transaction.party,
            balanceChange,
            `${transaction.type}: ₦${transaction.amount}`
          );
          console.log(`👥 Updated party balance: ${transaction.party}`);
        }
      }
    }

    // Save conversation history
    await saveConversationHistory(trader.id, 'user', message);
    await saveConversationHistory(trader.id, 'assistant', responseText);

    // Update trader's last_active timestamp
    await supabase
      .from('traders')
      .update({ last_active: new Date() })
      .eq('id', trader.id);

    // ADD WARNING IF APPROACHING DAILY LIMIT (38-39 messages)
    if (limitStatus.isWarning) {
      responseText += `\n\n(${limitStatus.remaining} messages remaining today 🙏)`;
    }

    // Send response to user
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

    if (!from || !message) {
      return res.status(400).send('Missing From or Body');
    }

    console.log(`📨 Message from ${from}: ${message.substring(0, 50)}...`);

    // Get or create trader
    let trader = await getTrader(from);
    if (!trader) {
      trader = await createTrader(from);
      console.log(`✨ New trader created: ${from}`);

      await sendMessage(
        from,
        `👋 Welcome to OGA!\nWhich language do you prefer?\nReply: 1 for English or 2 for Pidgin`
      );
      return res.status(200).send('OK');
    }

    // Check if onboarding incomplete
    if (!trader.language_pref || !trader.name || !trader.pin) {
      await handleOnboarding(from, trader, message);
      return res.status(200).send('OK');
    }

    // Handle regular message
    await handleMessage(from, trader, message);

    res.status(200).send('OK');
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
