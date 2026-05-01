# OGA Quick Start — 30 Minutes to Running Bot

**Get OGA running locally in under 30 minutes.**

---

## 📋 Checklist

Print this out, check off as you go:

### Pre-Setup (5 min)
- [ ] Node.js installed (`node --version` shows v18+)
- [ ] GitHub account
- [ ] Twilio account (free)
- [ ] Anthropic account with API key
- [ ] Supabase account

### Setup (25 min)

#### 1. Get API Keys (5 min)

**Twilio:**
- Go to https://www.twilio.com/console
- **Messaging** → **Try it out** → **WhatsApp**
- Copy Account SID and Auth Token
- Note sandbox number: `+1 415 523 8886`

**Anthropic:**
- Go to https://console.anthropic.com
- Create API key
- Copy it

**Supabase:**
- Go to https://app.supabase.com
- Create new project
- Copy Project URL and Anon Key from **Settings → API**

#### 2. Create `.env` File (2 min)

In your project folder, create a file named `.env`:

```
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
ANTHROPIC_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_key
PORT=3000
NODE_ENV=development
```

#### 3. Load Database Schema (3 min)

1. In Supabase, go to **SQL Editor**
2. Create new query
3. Paste the contents of `supabase-schema.sql`
4. Click **Run**

#### 4. Install & Run (3 min)

```bash
npm install
npm run dev
```

You should see:
```
🤖 OGA Bot running on port 3000
💬 Webhook: http://localhost:3000/webhook
```

#### 5. Test the Bot (5 min)

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Should return: `{"status":"ok"}`

Test a message:
```bash
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=Hi OGA"
```

Check your Supabase **conversation_history** table — you should see the message!

---

## ✨ What to Try Next

### Manual Testing

Try sending messages to the webhook and watching Supabase update:

```bash
# Onboarding
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=My name is Ade"

curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=1234"

# Record a transaction
curl -X POST http://localhost:3000/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I sell tomato 5000 to Mama"
```

Then check Supabase **transactions** table.

### Full Test Scenarios

See `TESTING.md` for 10 complete test scenarios.

---

## 🚀 When Ready to Deploy

Follow `DEPLOYMENT.md` for:
1. Push to GitHub
2. Deploy to Railway
3. Update Twilio webhook
4. Go live!

---

## 📚 Full Documentation

- **Setup Details**: `README.md`
- **Test Scenarios**: `TESTING.md`
- **Deployment**: `DEPLOYMENT.md`
- **API Reference**: `API.md`
- **Project Overview**: `PROJECT_SUMMARY.md`

---

## 🆘 Quick Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot find module" | Run `npm install` |
| "EADDRINUSE" (port 3000 in use) | Change PORT in `.env` to 3001 |
| "Cannot connect Supabase" | Check URL and key in `.env` |
| "Claude API error" | Check API key and account has credits |
| No Supabase tables | Run `supabase-schema.sql` in SQL Editor |

---

## 💡 Common Questions

**Q: Can I test without Twilio?**
A: Yes! Just curl the webhook endpoint directly (see examples above).

**Q: How do I see what the bot is doing?**
A: Check your terminal logs and watch Supabase tables update in real-time.

**Q: Can I change the bot's behavior?**
A: Yes! Edit the system prompt in `index.js` (around line 20).

**Q: How do I save to GitHub?**
A: See `DEPLOYMENT.md` — we'll push after testing.

---

## Next Steps

- [ ] Complete checklist above
- [ ] Test with curl examples
- [ ] Try 3-5 test scenarios from `TESTING.md`
- [ ] When happy, follow `DEPLOYMENT.md`

---

**You've got this! 🚀**

Any blockers? Check the full docs or see troubleshooting above.
