const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));

// Initialize clients
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

// System prompt for Claude
const SYSTEM_PROMPT = `You are OGA, a WhatsApp business assistant for Nigerian traders. Your role is to help them track sales, purchases, expenses, and payments.

## Your Personality
- Professional but warm
- Fluent in English, Pidgin English, and Nigerian slang
- Never give financial or investment advice
- Be encouraging and supportive
- Use emojis sparingly

## Transaction Types You Understand
1. **Sales**: "I sell [item] [amount] to [person]" → type: "sale"
2. **Purchases**: "I buy [item] [amount] from [person]" → type: "purchase"
3. **Expenses**: "I spend [amount] on [description]" → type: "expense"
4. **Payments Received**: "[Person] paid me [amount]" → type: "payment_in"
5. **Payments Made**: "I paid [person] [amount]" → type: "payment_out"

## When You Detect a Transaction
ALWAYS respond with the message first, then add this JSON block (no markdown):

[TRANSACTION]
{
  "type": "sale|purchase|expense|payment_in|payment_out",
  "amount": 15000,
  "paid": 10000,
  "balance": 5000,
  "party": "Name of person",
  "item": "What was sold/bought/spent on"
}
[/TRANSACTION]

## When You DON'T Detect a Transaction
Just respond naturally without the JSON block.

## Rules
- Ask clarifying questions if you're unsure
- Never store bank details or passwords
- Keep responses brief (max 2-3 sentences)
- Be honest about what you can and can't do
- Always confirm amounts before saving

## Example Conversations
User: "I sold tomato 5000 to Mama Bola"
You: "Got it! You sold tomato for ₦5,000 to Mama Bola. Is she paying now or later?"
[TRANSACTION]
{"type": "sale", "amount": 5000, "paid": 0, "balance": 5000, "party": "Mama Bola", "item": "tomato"}
[/TRANSACTION]

User: "How much did I make today?"
You: "You've made ₦12,500 in sales today and spent ₦2,000 on transport. Your net is ₦10,500."

You are here to help traders manage their business money better.`;

// Database functions
async function getTrader(phone) {
  const { data, error } = await supabase
    .from('traders')
    .select('*')
    .eq('whatsapp_number', phone)
    .single();
  return data;
}

async function createTrader(phone) {
  const { data, error } = await supabase
    .from('traders')
    .insert({
      whatsapp_number: phone,
      subscription_tier: 'trial',
      trial_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      is_active: true,
    })
    .select()
    .single();
  return data;
}

async function saveTransaction(traderId, txData) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      trader_id: traderId,
      type: txData.type,
      total_amount: txData.amount,
      amount_paid: txData.paid,
      balance_remaining: txData.balance,
      party_name: txData.party,
      item_description: txData.item,
      notes: txData.notes || '',
    })
    .select()
    .single();

  if (error) console.error('Transaction save error:', error);
  return data;
}

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

async function loadTraderContext(traderId) {
  const today = new Date().toISOString().split('T')[0];

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('trader_id', traderId)
    .order('created_at', { ascending: false })
    .limit(50);

  const todaySales = transactions
    ?.filter(
      (t) =>
        t.type === 'sale' &&
        t.created_at.startsWith(today)
    )
    .reduce((sum, t) => sum + t.total_amount, 0) || 0;

  const todayExpenses = transactions
    ?.filter(
      (t) =>
        t.type === 'expense' &&
        t.created_at.startsWith(today)
    )
    .reduce((sum, t) => sum + t.total_amount, 0) || 0;

  return {
    todaySales,
    todayExpenses,
    recentTransactions: transactions?.slice(0, 10) || [],
  };
}

async function sendMessage(to, message) {
  const chunks = message.match(/[\s\S]{1,1600}/g) || [message];
  for (const chunk of chunks) {
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: chunk,
    });
  }
}

async function handleOnboarding(from, trader, message) {
  if (!trader.name) {
    await supabase
      .from('traders')
      .update({ name: message.trim() })
      .eq('id', trader.id);
    await sendMessage(
      from,
      `Nice to meet you, ${message.trim()}! 👋\n\nNow create a 4-digit PIN to secure your account:`
    );
  } else if (!trader.pin) {
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
      `✅ PIN set! You're all set, ${trader.name}.\n\nNow you can start recording transactions. Try:\n"I sell tomato 5000 to Mama Bola"`
    );
  }
}

async function handleMessage(from, trader, message) {
  // Load conversation history
  const { data: history } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('trader_id', trader.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const context = await loadTraderContext(trader.id);

  // Build messages for Claude
  const messages = [];
  if (history && history.length > 0) {
    history.reverse().forEach((msg) => {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    });
  }
  messages.push({
    role: 'user',
    content: message,
  });

  // Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: messages,
  });

  const fullText = response.content[0].text;

  // Parse transaction if present
  const transactionMatch = fullText.match(
    /\[TRANSACTION\]([\s\S]*?)\[\/TRANSACTION\]/
  );
  let transaction = null;
  let responseText = fullText;

  if (transactionMatch) {
    try {
      transaction = JSON.parse(transactionMatch[1]);
      responseText = fullText.replace(
        /\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/,
        ''
      ).trim();
    } catch (e) {
      console.error('Transaction parse error:', e);
    }
  }

  // Save transaction if detected
  if (transaction) {
    await saveTransaction(trader.id, transaction);
  }

  // Save conversation
  await saveConversationHistory(trader.id, 'user', message);
  await saveConversationHistory(trader.id, 'assistant', responseText);

  // Send response
  await sendMessage(from, responseText);
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const from = req.body.From;
    const message = req.body.Body?.trim();

    if (!from || !message) {
      return res.status(400).send('Missing From or Body');
    }

    // Get or create trader
    let trader = await getTrader(from);
    if (!trader) {
      trader = await createTrader(from);
      await sendMessage(
        from,
        `👋 Welcome to OGA!\n\nI manage your business money right here on WhatsApp. No app needed.\n\nWhat is your name?`
      );
      return res.status(200).send('OK');
    }

    // Check if onboarding incomplete
    if (!trader.name || !trader.pin) {
      await handleOnboarding(from, trader, message);
      return res.status(200).send('OK');
    }

    // Handle regular message
    await handleMessage(from, trader, message);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Cron jobs
cron.schedule('*/15 * * * *', async () => {
  console.log('Running reminder check...');
});

cron.schedule('0 8 1 * *', async () => {
  console.log('Running monthly report generation...');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 OGA Bot running on port ${PORT}`);
  console.log(`💬 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`❤️ Health: http://localhost:${PORT}/health`);
});
