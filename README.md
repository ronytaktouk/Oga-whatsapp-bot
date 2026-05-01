# OGA WhatsApp Bot — Complete Setup Guide

**A production-ready WhatsApp AI business bot for Nigerian traders**

Build, test, and deploy your own intelligent trading assistant in 30 minutes.

---

## 📚 Table of Contents

1. [What is OGA?](#what-is-oga)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Setup Instructions](#setup-instructions)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## What is OGA?

OGA is a WhatsApp bot that helps Nigerian traders:
- **Record transactions** (sales, purchases, expenses, payments)
- **Track money** (who owes you, you owe them)
- **Get daily summaries** (today's sales, expenses, net)
- **Set reminders** (collect from debtors, pay suppliers)
- **Understand context** (uses Claude AI for natural language)

**Example conversation:**

```
User: I sell tomato 5000 to Mama Bola
OGA: Got it! Tomato sale for ₦5,000 to Mama Bola. Is she paying now or later?

User: Later
OGA: OK, added to your records. Mama Bola owes you ₦5,000.

User: How today go?
OGA: Today you sold ₦12,500 worth and spent ₦2,000. Net: ₦10,500 ✅
```

---

## Quick Start

**TL;DR:** 30 minutes to a working bot.

1. **Get API keys** (5 min)
   - Twilio (WhatsApp)
   - Anthropic (Claude AI)
   - Supabase (Database)

2. **Set up locally** (15 min)
   - Clone repo
   - Create `.env` file
   - Run `npm install && npm run dev`

3. **Test & Deploy** (10 min)
   - Test with WhatsApp sandbox
   - Deploy to Railway
   - Update Twilio webhook

See `QUICKSTART.md` for step-by-step.

---

## Architecture

```
User's WhatsApp
       ↓
   Twilio API
       ↓
  Node.js App (This repo)
       ├─→ Claude API (understand message)
       ├─→ Supabase (save data)
       └─→ Twilio (send response)
       ↓
Railway (Cloud hosting)
```

### Tech Stack

| Component | Tech | Why |
|-----------|------|-----|
| Chat | Twilio WhatsApp | Free sandbox, easy setup |
| Backend | Node.js + Express | Fast, lightweight |
| AI | Anthropic Claude | Understands context, Pidgin-aware |
| Database | Supabase (PostgreSQL) | Free tier, built-in backups |
| Hosting | Railway | Free tier, auto-deploy from GitHub |

---

## Setup Instructions

### 1. Prerequisites

- Node.js v18+ installed (`node --version`)
- GitHub account
- 3 API accounts: Twilio, Anthropic, Supabase

### 2. Get API Keys

**Twilio (WhatsApp):**
1. Go to https://www.twilio.com/console
2. Navigate to **Messaging** → **Try it out** → **WhatsApp**
3. Follow sandbox activation
4. Copy: Account SID, Auth Token
5. Note sandbox number: `+1 415 523 8886`

**Anthropic (Claude AI):**
1. Go to https://console.anthropic.com
2. Click **API Keys** → **Create new**
3. Copy the key

**Supabase (Database):**
1. Go to https://app.supabase.com
2. Create new project
3. Go to **Settings** → **API**
4. Copy: Project URL, Anon Key
5. Go to **SQL Editor**
6. Paste `supabase-schema.sql` and run it

### 3. Local Setup

```bash
# Clone the repo
git clone <your-repo-url>
cd oga

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your API keys
# TWILIO_ACCOUNT_SID=...
# TWILIO_AUTH_TOKEN=...
# ANTHROPIC_API_KEY=...
# SUPABASE_URL=...
# SUPABASE_ANON_KEY=...

# Run locally
npm run dev

# You should see:
# 🤖 OGA Bot running on port 3000
# 💬 Webhook: http://localhost:3000/webhook
```

### 4. Test Locally

You can test the bot without Twilio by:
1. Making curl requests to the webhook
2. Checking database directly in Supabase

See `TESTING.md` for full test scenarios.

---

## Testing

Complete testing guide in `TESTING.md`.

### Quick Test

1. **Start bot:**
   ```bash
   npm run dev
   ```

2. **In another terminal, send a test message:**
   ```bash
   curl -X POST http://localhost:3000/webhook \
     -d "From=whatsapp:+2348021234567" \
     -d "Body=Hi OGA"
   ```

3. **Check Supabase:**
   - Open your project
   - Look in `conversation_history` table
   - You should see your message and bot's response

---

## Deployment

Ready to go live? See `DEPLOYMENT.md` for:
- Pushing code to GitHub
- Deploying to Railway
- Configuring Twilio webhook
- Monitoring logs

**Quick Deploy (with GitHub):**
1. Push code to GitHub
2. Connect Railway to GitHub repo
3. Add environment variables in Railway dashboard
4. Railway auto-deploys
5. Update Twilio webhook URL to Railway URL

---

## File Structure

```
oga/
├── index.js                 ← Main bot (700+ lines)
├── package.json             ← Dependencies
├── .env.example             ← Configuration template
├── .gitignore               ← Git ignore
├── supabase-schema.sql      ← Database setup
├── README.md                ← This file
├── QUICKSTART.md            ← 30-min setup
├── TESTING.md               ← Test scenarios
├── DEPLOYMENT.md            ← Deploy guide
├── API.md                   ← Technical reference
└── PROJECT_SUMMARY.md       ← Overview & next steps
```

---

## Bot Features

### Messages It Understands

✅ **"I sell fabric 9,000 to Mrs Bello"** → Records sale  
✅ **"I buy 30kg rice 15,000 from Mallam"** → Records purchase  
✅ **"I spend 5,000 transport"** → Records expense  
✅ **"Mama Bola paid me 5,000"** → Records payment  
✅ **"How today?"** → Daily summary  
✅ **"Who owe me?"** → Lists debtors  
✅ **"Remind me collect Friday"** → Sets reminder  

### Conversation Features

- **Onboarding**: Collects name and 4-digit PIN on first use
- **Context**: Remembers last 10 messages for smart responses
- **Persistence**: All data saved to Supabase
- **Natural Language**: Understands various ways to say the same thing
- **Multilingual**: Works in English, Pidgin, Yoruba

---

## Costs

**For Testing (Free):**
- Twilio Sandbox: Free
- Anthropic: Pay-as-you-go (~₦500/month)
- Supabase: Free tier
- Railway: Free 550 hrs/month

**For Production (Estimated):**
- Twilio WhatsApp: ~₦0.01 per message
- Anthropic Claude: ~₦0.50 per 1000 messages
- Supabase: ₦5,000-10,000/month
- Railway: $5-20/month
- **Total: ₦10,000-20,000/month for small scale**

**Pricing Model:**
- Charge traders ₦2,500-5,000/month
- 200 traders = ₦500k-1M MRR at breakeven

---

## Security

✅ **PINs hashed** with bcrypt  
✅ **Secrets in .env** (never in code)  
✅ **Per-trader data isolation** (users only see their own data)  
✅ **HTTPS webhook** (Railway provides)  
✅ **No stored bank details** (only amounts)  
✅ **Conversation auto-cleanup** (keeps last 20 messages)

---

## Troubleshooting

### Bot not responding

1. Check terminal logs (you should see message received)
2. Verify Twilio webhook URL is correct
3. Check `.env` values are set
4. Verify Supabase connection

### Database errors

1. Check Supabase URL and key in `.env`
2. Verify schema was loaded (`supabase-schema.sql`)
3. Check all tables exist in Supabase

### Claude API errors

1. Check API key in `.env`
2. Verify account has credits
3. Check message isn't too large

### Transaction not saving

1. Check transaction JSON format in bot response
2. Verify Supabase connection
3. Check trader_id exists in database

---

## Next Steps

1. **This Week:**
   - Test with 5-10 beta traders
   - Gather feedback
   - Fix any bugs

2. **Month 1:**
   - Upgrade Twilio from sandbox to production
   - Get WhatsApp Business Account
   - Set up payment gateway

3. **Month 2-3:**
   - Invite paying traders
   - Reach 50+ daily active users
   - Add PDF reports feature

4. **Month 6+:**
   - Scale to 500+ traders
   - Add mobile app
   - Explore partnerships

---

## API Reference

See `API.md` for:
- Webhook endpoint details
- Database schema
- Function signatures
- Extension points
- Error handling

---

## Support

**Need help?**

1. Check the docs first (README, QUICKSTART, TESTING, DEPLOYMENT)
2. Look at error messages carefully
3. Check logs in Railway dashboard
4. Review TROUBLESHOOTING section

**Resources:**
- Twilio: https://www.twilio.com/docs/whatsapp
- Anthropic: https://docs.anthropic.com
- Supabase: https://supabase.com/docs
- Railway: https://docs.railway.app

---

## License

MIT — Feel free to use, modify, and deploy.

---

**Built with ❤️ for Nigerian traders**

*OGA = "Boss" in Lagos slang — someone who knows their business*

🚀 **Go build something great!**
