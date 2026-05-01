# OGA Deployment Guide

**Deploy your bot to production on Railway in 10 minutes.**

---

## Prerequisites

- All tests passing (see `TESTING.md`)
- GitHub account
- Railway account (free at railway.app)
- Code committed to GitHub

---

## Step 1: Push Code to GitHub

### 1a. Create GitHub Repository

1. Go to https://github.com/new
2. Name: `oga-whatsapp-bot`
3. Description: "WhatsApp AI bot for Nigerian traders"
4. Public (so Railway can access)
5. Click **Create repository**

### 1b. Push Your Code

In your terminal:

```bash
cd /Users/ronytaktouk/Documents/Claude/Projects/oga

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial OGA bot"

# Add remote
git remote add origin https://github.com/YOUR_USERNAME/oga-whatsapp-bot.git

# Push to GitHub
git push -u origin main
```

**Note:** You'll be asked for GitHub credentials. Use a personal access token instead of your password:
1. Go to https://github.com/settings/tokens
2. Generate new token
3. Copy it
4. Paste when prompted

### Verify on GitHub

Go to https://github.com/YOUR_USERNAME/oga-whatsapp-bot

You should see all your files uploaded.

---

## Step 2: Deploy on Railway

### 2a. Connect to Railway

1. Go to https://railway.app
2. Sign up / Log in
3. Click **New Project**
4. Select **GitHub Repository**
5. Authorize Railway to access your GitHub
6. Select `oga-whatsapp-bot` repository
7. Click **Deploy**

Railway will auto-detect it's a Node.js project and start building.

### 2b. Wait for Build

You'll see a loading screen. This takes 2-5 minutes. Status should show:

```
Building...
Deploying...
✅ Deployment successful
```

---

## Step 3: Add Environment Variables

### 3a. Navigate to Variables

In Railway dashboard:
1. Click your project name (`oga-whatsapp-bot`)
2. Click **Variables** tab (next to Deployments)

### 3b. Add Each Variable

Click "**+ New Variable**" for each:

```
TWILIO_ACCOUNT_SID = your_sid
TWILIO_AUTH_TOKEN = your_token
TWILIO_WHATSAPP_NUMBER = whatsapp:+14155238886
ANTHROPIC_API_KEY = your_key
SUPABASE_URL = your_url
SUPABASE_ANON_KEY = your_key
PORT = 3000
NODE_ENV = production
```

After adding all, Railway will auto-redeploy with the new variables.

---

## Step 4: Get Your Railway URL

In Railway dashboard:
1. Click **Deployments** tab
2. Look for **Domain** section
3. You should see a URL like: `https://oga-whatsapp-bot-production.up.railway.app`

**Copy this URL** — you'll need it for Twilio.

---

## Step 5: Configure Twilio Webhook

### 5a. Get Railway URL

From Step 4, your webhook URL is:
```
https://oga-whatsapp-bot-production.up.railway.app/webhook
```

### 5b. Update Twilio

1. Go to https://www.twilio.com/console
2. **Messaging** → **Try it out** → **WhatsApp**
3. Find **When a message comes in**
4. Replace the current URL with your Railway URL:
   ```
   https://oga-whatsapp-bot-production.up.railway.app/webhook
   ```
5. Click **Save**

---

## Step 6: Test Live Bot

Now your bot is live on Railway!

### Option A: Test with WhatsApp Sandbox

1. Send to **+1 415 523 8886**:
   ```
   join [sandbox-code]
   ```
   (Check Twilio console for the code)

2. Send a message:
   ```
   Hi OGA
   ```

3. You should get a response!

### Option B: Test with curl

```bash
curl -X POST https://oga-whatsapp-bot-production.up.railway.app/webhook \
  -d "From=whatsapp:+2348021234567" \
  -d "Body=I sell rice 10000"
```

---

## Step 7: Enable Continuous Deployment

Railway automatically deploys when you push to GitHub. To verify:

1. Make a small change to your code
2. Commit and push:
   ```bash
   git add .
   git commit -m "Small update"
   git push
   ```
3. Watch Railway dashboard — it should auto-deploy
4. Your change should be live in 2-3 minutes

---

## Monitoring

### View Logs

In Railway dashboard:
- Click **Deployments**
- Click **View Logs**
- See all bot activity in real-time

### Common Log Messages

```
🤖 OGA Bot running on port 3000    ← Bot started OK
[POST] /webhook ← Message received
Transaction saved ← Data stored
Error: ...   ← Something went wrong
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Build failed" | Check `package.json` syntax, run `npm install` locally |
| "Environment variable not found" | Make sure ALL 8 variables are added in Railway |
| "Webhook not working" | Double-check webhook URL in Twilio matches Railway URL |
| "Database errors" | Check Supabase URL and key are correct |
| "No response from bot" | Check Railway logs for errors |

### Check Health Endpoint

Your bot has a health check:

```bash
curl https://oga-whatsapp-bot-production.up.railway.app/health
```

Should return: `{"status":"ok"}`

If not, bot isn't running. Check Railway logs.

---

## Scaling Considerations

### When You Need More

- **More database**: Upgrade Supabase to paid tier
- **More computing**: Railway auto-scales, but check usage
- **Higher throughput**: Add message queue (future enhancement)

### Monitoring Usage

In Railway:
- **Metrics** tab shows CPU, memory, network
- Green = healthy, Red = struggling

---

## Next Steps

### Week 1
- [ ] Monitor logs daily
- [ ] Invite 5-10 beta users
- [ ] Collect feedback
- [ ] Fix bugs

### Month 1
- [ ] Upgrade Twilio from sandbox to production account
- [ ] Get WhatsApp Business Account approval (1-2 weeks)
- [ ] Set up payment gateway (Paystack/Flutterwave)

### Month 2-3
- [ ] First paying users
- [ ] Target 50+ daily active users
- [ ] Add PDF reports feature

---

## Production Checklist

Before inviting real users:

- [ ] Bot deployed on Railway
- [ ] Environment variables all set
- [ ] Health check working
- [ ] Logs showing healthy activity
- [ ] Twilio webhook updated
- [ ] Tested with real WhatsApp messages
- [ ] Supabase backups enabled
- [ ] Emergency contact info documented

---

## Support

**Something broken?**

1. Check Railway logs
2. Check Twilio console logs
3. Verify all environment variables
4. Check Supabase is accessible
5. Test with curl endpoint

**For more help:**
- Railway docs: https://docs.railway.app
- Twilio docs: https://www.twilio.com/docs/whatsapp
- Anthropic docs: https://docs.anthropic.com

---

## You're Live! 🎉

Your bot is now running in production on Railway.

**Next:** Invite users, gather feedback, iterate!

---

**Questions? Check README.md or TESTING.md for more context.**
