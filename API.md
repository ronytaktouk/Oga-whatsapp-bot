# OGA API Reference

**Technical documentation for developers extending OGA.**

---

## Webhook Endpoint

### `POST /webhook`

Receives incoming messages from Twilio WhatsApp.

**Request Body** (from Twilio):
```
From: whatsapp:+2348021234567
Body: I sell tomato 5000 to Mama
MediaUrl0: https://... (optional, for future use)
```

**Processing Flow**:
1. Extract phone number and message text
2. Check if trader exists in database
3. If new: create trader, send welcome
4. If onboarding incomplete: handle name → PIN flow
5. If complete: send message to Claude with context
6. Parse response for transaction JSON
7. Save transaction if detected
8. Send response back via Twilio

**Response**: `200 OK` on success, `500` on error

---

### `GET /health`

Health check endpoint.

**Response**:
```json
{"status":"ok"}
```

---

## Database Models

### traders

```sql
CREATE TABLE traders (
  id UUID PRIMARY KEY,
  whatsapp_number VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  pin VARCHAR(255), -- bcrypt hashed
  language_pref VARCHAR(20),
  subscription_tier VARCHAR(20), -- trial, basic, pro
  trial_end TIMESTAMP,
  is_active BOOLEAN,
  created_at TIMESTAMP,
  last_active TIMESTAMP
);
```

**Example:**
```json
{
  "id": "uuid-1234",
  "whatsapp_number": "whatsapp:+2348021234567",
  "name": "Ade Oluwaseun",
  "pin": "$2b$10$hashed...",
  "language_pref": "english",
  "subscription_tier": "trial",
  "trial_end": "2025-02-18T12:00:00Z",
  "is_active": true,
  "created_at": "2025-01-18T12:00:00Z",
  "last_active": "2025-01-18T14:30:00Z"
}
```

### transactions

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  trader_id UUID,
  type VARCHAR(20), -- sale, purchase, expense, payment_in, payment_out
  total_amount DECIMAL(15,2),
  amount_paid DECIMAL(15,2),
  balance_remaining DECIMAL(15,2),
  party_name VARCHAR(100),
  item_description TEXT,
  notes TEXT,
  created_at TIMESTAMP
);
```

**Example:**
```json
{
  "id": "uuid-5678",
  "trader_id": "uuid-1234",
  "type": "sale",
  "total_amount": 15000,
  "amount_paid": 10000,
  "balance_remaining": 5000,
  "party_name": "Mama Bola",
  "item_description": "fabric",
  "notes": "good customer",
  "created_at": "2025-01-18T14:30:00Z"
}
```

### parties

```sql
CREATE TABLE parties (
  id UUID PRIMARY KEY,
  trader_id UUID,
  name VARCHAR(100),
  type VARCHAR(20), -- customer, supplier
  running_balance DECIMAL(15,2),
  phone VARCHAR(20),
  last_transaction TIMESTAMP,
  created_at TIMESTAMP
);
```

### reminders

```sql
CREATE TABLE reminders (
  id UUID PRIMARY KEY,
  trader_id UUID,
  reminder_type VARCHAR(50), -- self, other, recurring, cash_check
  message TEXT,
  amount DECIMAL(15,2),
  party_name VARCHAR(100),
  party_whatsapp VARCHAR(20),
  scheduled_time TIMESTAMP,
  recurring VARCHAR(20), -- weekly, daily
  recurring_day VARCHAR(20), -- monday, tuesday...
  status VARCHAR(20), -- pending, sent, completed
  escalation_level INTEGER,
  created_at TIMESTAMP
);
```

### conversation_history

```sql
CREATE TABLE conversation_history (
  id UUID PRIMARY KEY,
  trader_id UUID,
  role VARCHAR(20), -- user, assistant
  content TEXT,
  created_at TIMESTAMP
);
```

---

## Core Functions

### Trader Functions

#### `getTrader(phone)`

Get trader by WhatsApp number.

```javascript
const trader = await getTrader('whatsapp:+2348021234567');
// Returns trader object or null
```

#### `createTrader(phone)`

Create new trader.

```javascript
const trader = await createTrader('whatsapp:+2348021234567');
// Returns { id, whatsapp_number, created_at, ... }
```

### Transaction Functions

#### `saveTransaction(traderId, txData)`

Save a transaction.

```javascript
await saveTransaction(traderId, {
  type: 'sale',
  amount: 15000,
  paid: 10000,
  balance: 5000,
  party: 'Mama Bola',
  item: 'fabric',
  notes: 'on credit'
});
```

### Conversation Functions

#### `saveConversationHistory(traderId, role, content)`

Save user or bot message.

```javascript
await saveConversationHistory(traderId, 'user', 'I sell tomato 5000');
await saveConversationHistory(traderId, 'assistant', 'Got it!');
```

Automatically keeps last 20 messages per trader.

#### `loadTraderContext(traderId)`

Get financial snapshot for Claude context.

```javascript
const context = await loadTraderContext(traderId);
// Returns {
//   todaySales: 40000,
//   todayExpenses: 5000,
//   recentTransactions: [...]
// }
```

### Messaging Functions

#### `sendMessage(to, message)`

Send WhatsApp message via Twilio.

```javascript
await sendMessage('whatsapp:+2348021234567', 'Hello!');
```

Auto-splits messages longer than 1600 characters.

---

## Claude AI Integration

### System Prompt

Located in `index.js` (lines ~20-100), defines:
- Bot personality
- Transaction types
- Response formats
- Privacy rules
- Language handling

### Response Format

Claude returns message + optional transaction JSON:

```
Your message here...

[TRANSACTION]
{
  "type": "sale",
  "amount": 15000,
  "paid": 10000,
  "balance": 5000,
  "party": "Mama Bola",
  "item": "fabric"
}
[/TRANSACTION]
```

Backend parses this, removes JSON from user response, and saves transaction.

### Transaction JSON Schema

```json
{
  "type": "sale|purchase|expense|payment_in|payment_out",
  "amount": number,
  "paid": number (optional),
  "balance": number (optional),
  "party": "string",
  "item": "string",
  "notes": "string (optional)"
}
```

---

## Extending OGA

### Add New Transaction Type

1. Update system prompt in `index.js`:
   ```javascript
   // Add to SYSTEM_PROMPT
   "CUSTOM_TYPE: 'trigger phrase'"
   ```

2. Update transaction parsing:
   ```javascript
   if (transaction.type === 'custom_type') {
     // Handle custom logic
   }
   ```

3. Add database column if needed:
   ```sql
   ALTER TABLE transactions ADD COLUMN custom_field VARCHAR(100);
   ```

### Add New Command

1. Add to system prompt
2. Detect in message handler:
   ```javascript
   if (message.includes('trigger')) {
     // Custom logic
   }
   ```

### Add Language Support

Claude naturally handles most languages. To optimize:

1. Update `trader.language_pref`
2. Modify system prompt with language hints
3. Test with sample messages

---

## Error Handling

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Cannot read property 'From'" | Twilio format wrong | Check webhook request |
| "Connection refused" Supabase | URL wrong or offline | Check `.env` |
| "Invalid API key" | Bad Anthropic key | Check console.anthropic.com |
| Transaction parse error | Malformed JSON | Check Claude response |
| "Unauthorized" Supabase | Bad Anon Key | Regenerate in Supabase |

### Logging

Errors logged to console:
```javascript
console.error('Webhook error:', error);
console.error('Transaction save error:', error);
console.error('Message handler error:', error);
```

Watch terminal while running `npm run dev`.

---

## Performance Optimization

### Current Limits

- **Conversation history**: Load 10, store 20 per trader
- **Transaction queries**: Load last 50
- **Claude tokens**: 500 max output
- **Cron jobs**: Every 15 min (reminders), monthly (reports)
- **Database**: Indexed on trader_id, created_at, status

### Optimization Ideas

- Cache trader context (5 min TTL)
- Batch message sends
- Async transaction saves
- Rate limit per user (prevent abuse)
- Archive old conversation history

---

## Rate Limiting (Future)

No built-in rate limits currently. To add:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10
});

app.post('/webhook', limiter, async (req, res) => {
  // Handle request
});
```

---

## Security Headers (Future)

```javascript
const helmet = require('helmet');

app.use(helmet());
app.use(express.json({ limit: '10kb' }));
```

---

## Testing Functions

### Test a Trader

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=Hi OGA"
```

### Test Transaction

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I sell rice 5000 to Mama"
```

---

## Environment Variables

Required:
```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER
ANTHROPIC_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
PORT (default: 3000)
NODE_ENV (development or production)
```

---

## Future API Features

- [ ] REST API for external queries (read-only)
- [ ] Webhook for transaction updates
- [ ] Bulk import transactions (CSV)
- [ ] Export data (PDF/Excel)
- [ ] Analytics dashboard API
- [ ] Partner integration APIs

---

## Support

For questions:
1. Check code comments in `index.js`
2. Read `README.md` for architecture
3. See `TESTING.md` for examples
4. Review `DEPLOYMENT.md` for production setup

---

**Happy extending!**
