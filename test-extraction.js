// Test the transaction extraction regex against real outputs from the chat

// Test case 1: Multiline JSON (from line 55-64 of chat)
const testCase1 = `Got it! So Fred paid **$192,000** upfront and owes **$48,000** in 10 days. Let me record that.

You sold 8,000 sqm of tiles to Fred for $240,000. He paid $192,000 and has a balance of $48,000 due in 10 days.



I'll make sure to remind you when Fred's balance is due. Is there anything else to record?

[TRANSACTION]
{
  "type": "sale",
  "amount": 7000,
  "paid": 5600,
  "balance": 1400,
  "party": "Paul",
  "item": "tiles (200 sqm at $35/sqm)"
}
[/TRANSACTION]`;

// Test case 2: Single-line JSON (from line 101-103 of chat)
const testCase2 = `Perfect! Let me calculate your profit on both sales:

---

**FRED (8,000 sqm)**
- Revenue: $240,000
- Tiles Cost: $184,000 ($23 x 8,000)
- Transport: $16,000 ($2 x 8,000)
- **Profit: $40,000**

---

**PAUL (200 sqm)**
- Revenue: $7,000
- Tiles Cost: $4,600 ($23 x 200)
- Transport: $400 ($2 x 200)
- **Profit: $2,000**

---

**TOTAL SUMMARY**
- Total Revenue: $247,000
- Total Costs: $205,000
- **Net Profit: $42,000** 💰

Your profit margin is about **17%**. Want me to record these expenses?



[TRANSACTION]
{"type": "expense", "amount": 16400, "paid": 16400, "balance": 0, "party": null, "item": "Transport - Fred & Paul (8,200 sqm x $2)"}
[/TRANSACTION]`;

console.log("=== Testing Extraction Regex ===\n");

// Current regex from index.js
const extractionRegex = /\[TRANSACTION\]\s*(\{[\s\S]*?\})\s*\[\/TRANSACTION\]/;
const removalRegex = /\n?\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g;

console.log("TEST CASE 1 (Multiline JSON):");
console.log("Original length:", testCase1.length);
const match1 = testCase1.match(extractionRegex);
console.log("Extraction match:", match1 ? "✅ MATCHED" : "❌ NO MATCH");
if (match1) {
  console.log("JSON extracted:", match1[1]);
}
const cleaned1 = testCase1.replace(removalRegex, '').trim();
console.log("Cleaned text length:", cleaned1.length);
console.log("JSON still in cleaned text?", cleaned1.includes("[TRANSACTION]") ? "❌ YES" : "✅ NO");
console.log("Cleaned text preview:", cleaned1.slice(-100));

console.log("\n" + "=".repeat(50) + "\n");

console.log("TEST CASE 2 (Single-line JSON):");
console.log("Original length:", testCase2.length);
const match2 = testCase2.match(extractionRegex);
console.log("Extraction match:", match2 ? "✅ MATCHED" : "❌ NO MATCH");
if (match2) {
  console.log("JSON extracted:", match2[1]);
}
const cleaned2 = testCase2.replace(removalRegex, '').trim();
console.log("Cleaned text length:", cleaned2.length);
console.log("JSON still in cleaned text?", cleaned2.includes("[TRANSACTION]") ? "❌ YES" : "✅ NO");
console.log("Cleaned text preview:", cleaned2.slice(-100));

console.log("\n" + "=".repeat(50) + "\n");

// Let's also test without the optional newline
const removalRegexAlt = /\[TRANSACTION\][\s\S]*?\[\/TRANSACTION\]/g;

console.log("ALTERNATIVE: Testing without optional newline before [TRANSACTION]:");
const cleaned1Alt = testCase1.replace(removalRegexAlt, '').trim();
const cleaned2Alt = testCase2.replace(removalRegexAlt, '').trim();

console.log("Test case 1 still has JSON?", cleaned1Alt.includes("[TRANSACTION]") ? "❌ YES" : "✅ NO");
console.log("Test case 2 still has JSON?", cleaned2Alt.includes("[TRANSACTION]") ? "❌ YES" : "✅ NO");

console.log("\n=== Summary ===");
console.log("Current regex working?", !cleaned1.includes("[TRANSACTION]") && !cleaned2.includes("[TRANSACTION]") ? "✅ YES" : "❌ NO");
