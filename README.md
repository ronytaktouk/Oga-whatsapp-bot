# OGA WhatsApp Business Assistant

A WhatsApp AI business assistant for traders and small business owners in Nigeria. Users chat naturally in Pidgin English or casual English. OGA records transactions, tracks cash, manages debts, sets reminders, and gives summaries and reports.

## What is OGA?

OGA is your personal WhatsApp business accountant. It:

- **Records transactions** — sales, purchases, expenses, payments, stock updates
- **Tracks debtors & creditors** — who owes you, who you owe
- **Calculates profit** — real profit after all costs
- **Sets reminders** — for payments due, restocking, recurring expenses
- **Generates reports** — daily, weekly, monthly summaries
- **Works in Pidgin** — natural conversation in your language

Everything lives on the server. Nothing on the user's phone. No app download needed. Just WhatsApp.

## Technology Stack

| Component | Technology |
|-----------|------------|
| Chat | Twilio WhatsApp Sandbox |
| Backend | Node.js + Express |
| AI | Anthropic Claude API |
| Database | Supabase (PostgreSQL) |
| Hosting | Railway.app |
| Scheduling | node-cron |

## Files Included

```
oga-whatsapp-bot/
├── index.js              ← Main bot logic
├── helpers.js            ← Utility functions
├── crons.js              ← Scheduled jobs
├── system-prompt.js      ← OGA's personality
├── package.json          ← Dependencies
├── .env                  ← Your credentials (SECRET!)
├── .gitignore            ← What to ignore
└── README.md             ← This file
```

## Setup Instructions

### Step 1: Get Your Credentials

You need 4 credentials:

1. **Twilio WhatsApp Sandbox** (free)
   - Go to https://www.twilio.com/console
   - Click **Messaging** → **Try it out** → **WhatsApp**
   - Copy your Account SID and Auth Token
   - Your WhatsApp number will be provided

2. **Anthropic Claude API** (pay-as-you-go)
   - Go to https://console.anthropic.com
   - Go to **API Keys**
   - Create a new key
   - Copy it

3. **Supabase** (free tier)
   - Go to https://supabase.com
   - Create a project
   - Copy your Project URL and Anon Key
   - The database schema is already created

### Step 2: Create .env File

The `.env` file is already created with your credentials. Keep it SECRET!

```
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
ANTHROPIC_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_key
PORT=3000
NODE_ENV=production
```

**Never commit .env to GitHub!** (It's in .gitignore)

### Step 3: Push to GitHub

These files are ready to push to GitHub:

1. Create a new GitHub repository: https://github.com/new
2. Name it: `oga-whatsapp-bot`
3. Make it Public (so Railway can access it)
4. In Terminal:
   ```bash
   cd /path/to/oga-whatsapp-bot
   git init
   git add .
   git commit -m "Initial OGA bot"
   git remote add origin https://github.com/YOUR_USERNAME/oga-whatsapp-bot.git
   git push -u origin main
   ```

### Step 4: Deploy to Railway

1. Go to https://railway.app
2. Sign up or log in
3. Click **New Project**
4. Select **GitHub Repository**
5. Authorize Railway to access your GitHub
6. Select `oga-whatsapp-bot` repository
7. Click **Deploy**
8. Wait 2-5 minutes for deployment to complete

### Step 5: Add Environment Variables to Railway

1. In Railway dashboard, click your project
2. Click **Variables** tab
3. Click **+ New Variable** for each:
   - `TWILIO_ACCOUNT_SID` = your value
   - `TWILIO_AUTH_TOKEN` = your value
   - `TWILIO_WHATSAPP_NUMBER` = whatsapp:+14155238886
   - `ANTHROPIC_API_KEY` = your value
   - `SUPABASE_URL` = your value
   - `SUPABASE_ANON_KEY` = your value
   - `PORT` = 3000
   - `NODE_ENV` = production
4. Railway auto-redeploys when you add variables

### Step 6: Get Your Railway URL

1. In Railway dashboard, click **Deployments** tab
2. Look for **Domain** section
3. Copy the URL (looks like: `https://oga-whatsapp-bot-production.up.railway.app`)

### Step 7: Update Twilio Webhook

1. Go to https://www.twilio.com/console
2. **Messaging** → **Try it out** → **WhatsApp**
3. Find **When a message comes in**
4. Replace the URL with:
   ```
   https://YOUR_RAILWAY_URL/webhook
   ```
5. Click **Save**

### Step 8: Test Your Bot

Get your sandbox join code from Twilio console, then:

1. Send to **+1 415 523 8886**:
   ```
   join your-sandbox-code
   ```

2. Send a message:
   ```
   Hi OGA
   ```

3. You should get a response!

## How OGA Works

### New User

User sends first message → OGA asks for name → OGA asks for PIN → User ready to go

### Recording a Transaction

User: "I sell ankara 9000 to Mama Bola"
OGA: "Got it! Recorded sale of ankara for ₦9,000 to Mama Bola. Is she paying now or later?"

OGA automatically:
- Parses "9000" as ₦9,000
- Detects it's a SALE
- Tags it as FABRIC business
- Saves to database

### Asking for Summary

User: "How today go?"
OGA: "📊 Today's Summary:
💰 Sales: ₦45,000
🛍️ Purchases: ₦12,000
💸 Expenses: ₦3,000
📈 Profit: ₦30,000
Good day! 💪"

### Reminders

User: "Remind me collect from Mama Bola Friday"
OGA: "✅ Will remind you Friday to collect from Mama Bola"

OGA automatically sends reminder on Friday at 8am Lagos time.

## Cron Jobs (Automatic)

| Job | When | What |
|-----|------|------|
| Reminders | Every 15 min | Send due reminders |
| Recurring TX | Daily 8am | Prompt for recurring transactions |
| Inactive users | Daily 10am | Check-in with inactive users |
| Message queue | Every 5 min | Retry failed messages |
| Monthly report | 1st month 8am | Generate PDF reports |

All times use **Lagos timezone (Africa/Lagos)**.

## API Reference

### POST /webhook

Receives WhatsApp messages from Twilio.

**From Twilio:**
```
From: whatsapp:+2348021234567
Body: I sell tomato 5000
```

**Processing:**
1. Check if trader exists
2. If new → start onboarding
3. If incomplete onboarding → continue
4. If complete → send to Claude
5. Parse transaction JSON
6. Save transaction
7. Send response back

### GET /health

Health check endpoint.

**Response:**
```json
{"status":"ok","timestamp":"2026-05-02T..."}
```

## Testing Checklist

- [ ] Send "Hi OGA" → Get welcome message
- [ ] Send your name → Get PIN request
- [ ] Send 4-digit PIN → Get setup confirmation
- [ ] Send "I sell rice 5000 to Mama" → Transaction recorded
- [ ] Send "How today?" → Get summary
- [ ] Send "Remind me Friday" → Reminder set
- [ ] Send "Delete that" → Last transaction removed

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Bot not responding" | Check Railway deployment status and logs |
| "Credit balance too low" | Add credits to Anthropic account |
| "Connection refused" | Check Supabase URL and key in .env |
| "Invalid API key" | Check API keys in Railway Variables |
| "Webhook not working" | Check Twilio webhook URL matches Railway URL |
| "Sandbox limit exceeded" | You hit 50 messages/day limit. Wait until tomorrow or upgrade to production |

## Next Steps After Launch

### Week 1
- [ ] Test with 5-10 beta traders
- [ ] Gather feedback
- [ ] Fix bugs in real-world usage

### Month 1
- [ ] Upgrade Twilio from sandbox to production
- [ ] Get WhatsApp Business Account approval
- [ ] Set up payment gateway (Paystack/Flutterwave)

### Month 2-3
- [ ] First paying users
- [ ] Target 50+ daily active users
- [ ] Add PDF reports feature

## Support

For issues:

1. Check Railway logs: https://railway.app
2. Check Twilio console: https://www.twilio.com/console
3. Check Supabase dashboard: https://supabase.com
4. Read error messages carefully

## License

Built with ❤️ for Nigerian traders

---

**Questions?** Read the README again. Most answers are here. 🙏
