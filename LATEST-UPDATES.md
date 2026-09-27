# OGA WhatsApp Bot - Latest Updates

## 🎯 Latest Features

### 1. WhatsApp Entry Dates (Auto-Capture)
OGA now auto-captures the **WhatsApp message timestamp** for transaction dating.

**How It Works:**
- Every message has a date/time from WhatsApp
- OGA uses that as the transaction date automatically
- No more "when did this happen?" questions
- If user says "yesterday I sold" → OGA calculates back from message date
- If user says "two weeks ago" → OGA calculates from message date

**Example:**
```
User sends on Friday May 30 at 3:45pm: "I sell 5 yards ankara"
OGA knows: This happened on Friday, May 30, 2026
Transaction automatically dated to May 30, 2026 (from WhatsApp timestamp)

User sends on Friday May 30 at 5pm: "Yesterday I sold 3 yards"
OGA calculates: Yesterday from May 30 = May 29, 2026
Transaction automatically dated to May 29, 2026
```

**Files Updated:**
- `index.js` - Extracts Twilio timestamp from webhook
- `index.js` - Passes message date to Claude in context: `[Sent: Friday, May 30, 2026]`
- `index.js` - Uses message date as transaction_date if Claude doesn't specify
- `system-prompt.js` - Updated DATE AND TIME INTELLIGENCE to use message timestamp as reference

---

### 2. Price Memory (Phase 1)
OGA now **remembers prices** from past transactions — never asks for the same price twice.

**How It Works:**
- **First time:** "I sell 5 yards ankara" → OGA asks "How much per yard?" → Stores ₦500/yard
- **Next time:** "I sell 3 yards ankara" → OGA confirms "3 yards @ ₦500/yard = ₦1,500?" (just confirm, no asking)
- **Price changed:** "Last time ankara was ₦500/yard. Still the same or different now?"

**Benefits:**
- ✅ Faster data entry (confirm instead of ask)
- ✅ Reduces friction for traders
- ✅ Automatically builds price catalog over time
- ✅ Preparation for Phase 2 (smart pricing)

---

### 2. Personal Expense Tracking
OGA now accepts **personal expense tracking** in addition to business transactions. Users can record their personal spending (gym, pharmacy, cinema, shopping, etc.) alongside business transactions.

### Files Updated

#### 1. **system-prompt.js** ✅ UPDATED
**Key Changes:**
- Changed from "business assistant" to "financial assistant for anyone"
- Added **PERSONAL** as a valid transaction category
- Includes personal expense examples:
  - Saltfish (₦200) → Food & Dining
  - Gym (₦115) → Health/Personal Care
  - Cinema (₦30) → Entertainment
  - Pharmacy (₦90) → Health/Pharmacy
  - Shopping (₦500) → Shopping

**New Section Added:**
```
PERSONAL VS BUSINESS EXPENSES:
OGA tracks BOTH personal and business expenses. When user wants to record 
personal transactions, ACCEPT THEM FULLY. Mark them as "personal" type in 
the system so they can be separated in reports if needed, but NEVER reject 
personal expense tracking.
```

**Personal Expense Categories:**
- Food & Dining
- Groceries
- Entertainment
- Health/Pharmacy
- Personal Care
- Shopping
- Transport
- Subscriptions
- Utilities
- Hobbies
- Other

---

### How It Works

**Before:** User says "I want to record personal expenses" → OGA rejects them
```
"Personal expenses fall outside business tracking — OGA focuses on your business money"
```

**After:** User says "I want to record personal expenses" → OGA accepts them
```
✅ Recorded as personal transaction with appropriate category
✅ Stored in database with "personal" flag
✅ Can be tracked separately from business transactions
```

---

### Price Memory Details

**Example Conversation:**

```
User: I sell 5 yards of ankara
OGA: How much per yard? 🙏
User: 500
OGA: ✅ Got it — 5 yards @ ₦500/yard = ₦2,500. That correct?

[Few days later]

User: Sold 3 yards ankara
OGA: ✅ 3 yards @ ₦500/yard = ₦1,500. Correct? (No asking, just confirming!)
User: Yes
OGA: ✅ Recorded. Total sales this week: ₦15,500

[Price changed]

User: Sold 8 yards ankara but it's 600 now
OGA: Price changed — was ₦500/yard, now ₦600/yard? 
OGA: ✅ 8 yards @ ₦600 = ₦4,800. Noted — new price saved.
```

**Database Storage:**
```
price_memory {
  item: "ankara",
  price_per_unit: 600,
  unit: "yard",
  last_updated: "2026-05-30",
  trader_id: "xxx"
}
```

---

### Files Included

1. **index.js** - ✅ **UPDATED** - Extracts WhatsApp timestamps + passes to Claude
2. **system-prompt.js** - ✅ **UPDATED** - Price Memory + Personal Expenses + Auto-Dates + Critical Rules
3. **helpers.js** - Utility functions for parsing & categorization
4. **crons.js** - Scheduled jobs & reminders
5. **package.json** - Dependencies & project config
6. **test-extraction.js** - Testing utility
7. **.gitignore** - Git configuration
8. **LATEST-UPDATES.md** - This file

---

### Deployment

To deploy these updates to production:

```bash
# Navigate to your OGA GitHub repo
cd /path/to/oga-repo

# Copy the updated system-prompt.js
cp ~/Desktop/OGA-Bot-Latest/system-prompt.js .

# Commit and push
git add system-prompt.js
git commit -m "Feature: Accept personal expense tracking"
git push origin main
```

Your hosting platform (Heroku, Railway, etc.) will automatically deploy the changes.

---

### Testing

Ask Mayssa to try:
```
"I want to record my personal expenses for May"

Then send:
200 saltfish
100 petrol
115 gym
30 cinema
...

Expected: ✅ OGA accepts and records all transactions as "personal" type
```

---

### Notes

- **Database:** Personal transactions are stored with `business_type: "personal"`
- **Reports:** Can generate separate reports for personal vs business expenses
- **Expense Limits:** No change - all categories work the same way
- **Balance Tracking:** Works for personal spending too

---

**Last Updated:** May 30, 2026
**Status:** Ready for Production ✅
