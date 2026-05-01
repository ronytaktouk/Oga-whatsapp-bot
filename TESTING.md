# OGA Testing Guide

**Complete test scenarios to verify your bot works correctly.**

---

## Before You Start

1. Bot should be running: `npm run dev`
2. Open your Supabase dashboard in a browser tab
3. Have a terminal ready for curl commands

---

## Test 1: Health Check

**What:** Verify the bot is running

```bash
curl http://localhost:3000/health
```

**Expected:**
```json
{"status":"ok"}
```

**If fails:** Bot isn't running. Run `npm run dev`

---

## Test 2: Onboarding - Name

**What:** First-time user provides name

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=My name is Ade Oluwaseun"
```

**Expected:**
- Terminal shows message received
- Supabase **traders** table: new row with name "Ade Oluwaseun"
- Supabase **conversation_history**: user message saved

**Verify in Supabase:**
```sql
SELECT * FROM traders WHERE whatsapp_number = 'whatsapp:+2348021234567';
```

---

## Test 3: Onboarding - PIN

**What:** First-time user sets PIN

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=1234"
```

**Expected:**
- Supabase **traders** table: PIN is hashed (you'll see `$2b$10$...`)
- Conversation continues naturally

---

## Test 4: Record a Sale

**What:** User records a sale transaction

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I sell tomato 5000 to Mama Bola"
```

**Expected:**
- Supabase **transactions** table: New row with:
  - type: "sale"
  - total_amount: 5000
  - party_name: "Mama Bola"
  - item_description: "tomato"

**Verify:**
```sql
SELECT * FROM transactions WHERE trader_id = (SELECT id FROM traders WHERE whatsapp_number = 'whatsapp:+2348021234567');
```

---

## Test 5: Record a Purchase

**What:** User records a purchase

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I buy 30kg rice 15000 from Mallam Ali"
```

**Expected:**
- **transactions** table: New row with:
  - type: "purchase"
  - total_amount: 15000
  - party_name: "Mallam Ali"
  - item_description: "30kg rice"

---

## Test 6: Record an Expense

**What:** User records an expense

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I spend 2000 on transport"
```

**Expected:**
- **transactions** table: New row with:
  - type: "expense"
  - total_amount: 2000
  - item_description: "transport"

---

## Test 7: Payment Received

**What:** User records payment from customer

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=Mama Bola paid me 5000"
```

**Expected:**
- **transactions** table: New row with:
  - type: "payment_in"
  - total_amount: 5000
  - party_name: "Mama Bola"

---

## Test 8: Query - Conversation

**What:** User asks a non-transaction question

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=How much did I make today?"
```

**Expected:**
- Bot responds naturally (no transaction JSON)
- **conversation_history**: Both user message and bot response saved
- No new row in **transactions** table

---

## Test 9: Different User

**What:** Test with a different phone number

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2349876543210" \
  -d "Body=Hi OGA"
```

**Expected:**
- **traders** table: New trader created with different phone number
- Users are isolated (can't see each other's data)

**Verify:**
```sql
SELECT COUNT(*) FROM traders; -- Should show 2 traders
```

---

## Test 10: Conversation History

**What:** Verify conversation history is saved

1. Send several messages from the same user
2. Check **conversation_history** table

```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I sell cloth 8000 to Mrs Folake"

curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=How much she owes me?"
```

**Expected:**
- **conversation_history** has multiple messages in order
- Oldest messages beyond 20 total are deleted automatically

**Verify:**
```sql
SELECT * FROM conversation_history WHERE trader_id = (SELECT id FROM traders WHERE whatsapp_number = 'whatsapp:+2348021234567') ORDER BY created_at DESC;
```

---

## Debugging Tips

### Check Logs

Watch your terminal while running tests. You should see:
```
🤖 OGA Bot running on port 3000
💬 Webhook: http://localhost:3000/webhook
```

### Check Supabase in Real-Time

1. Open Supabase dashboard
2. Click on table (traders, transactions, etc.)
3. You should see rows appear as you send messages

### Common Issues

| Issue | Solution |
|-------|----------|
| "Cannot POST /webhook" | Bot isn't running. Run `npm run dev` |
| No data in Supabase | Check URL and Anon Key in `.env` |
| Transaction not saved | Check JSON format in bot response |
| Conversation history empty | Check trader exists first |

### View Transaction Details

```sql
SELECT 
  t.type,
  t.total_amount,
  t.party_name,
  t.item_description,
  t.created_at
FROM transactions t
JOIN traders td ON t.trader_id = td.id
WHERE td.whatsapp_number = 'whatsapp:+2348021234567'
ORDER BY t.created_at DESC;
```

---

## Test Checklist

Complete all tests before deploying:

- [ ] Test 1: Health check
- [ ] Test 2: Onboarding - name
- [ ] Test 3: Onboarding - PIN
- [ ] Test 4: Record sale
- [ ] Test 5: Record purchase
- [ ] Test 6: Record expense
- [ ] Test 7: Payment received
- [ ] Test 8: Query conversation
- [ ] Test 9: Different user
- [ ] Test 10: Conversation history

**All passing?** You're ready for `DEPLOYMENT.md`!

---

## Performance Testing

Once basic tests pass, you can test with:

- Multiple users simultaneously
- Rapid transactions
- Large conversation history
- Long message content

For now, basic tests are enough. Scale later!

---

## Next Steps

- [ ] Complete all 10 tests above
- [ ] Verify data in Supabase
- [ ] Read `DEPLOYMENT.md`
- [ ] Deploy to Railway

---

**Need help?** Check README.md or ask!
