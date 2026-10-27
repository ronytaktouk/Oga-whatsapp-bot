// OGA Dashboard
// A private web page each trader opens from a link OGA sends on WhatsApp.
// Works on phones and laptops, in any browser. Nothing to install.
//
// How access works:
// 1. Trader types "dashboard" on WhatsApp. OGA replies with a link that works for 30 minutes.
// 2. The link asks for the trader's 4-digit OGA PIN (a forwarded link is useless on its own).
// 3. After the PIN, that browser stays signed in for 24 hours.
//
// What traders can do:
// - See who owes them and who they owe, this month's totals, daily sales and where money went
// - Filter and search every record, open any record to edit or delete it
// - Add a record by hand
// - Open a statement for one customer or supplier
// - Optional projects: see money received and spent for each project or job
// - Download the month as a spreadsheet (CSV, opens in Excel or Google Sheets)
//
// Every change writes straight to Supabase, so OGA on WhatsApp sees the new numbers at once.
// Pages are built on the server with no outside fonts or scripts, so they load fast on cheap data.

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const moment = require('moment-timezone');

const TZ = 'Africa/Lagos';
const TRANSACTION_TYPES = ['sale', 'purchase', 'expense', 'payment_in', 'payment_out'];
const LINK_MINUTES = 30;
const SESSION_HOURS = 24;
const MAX_PIN_TRIES = 5;
const COOKIE = 'oga_s';

// Secret used to sign links and sessions. Set DASHBOARD_SECRET in Railway (any long random text).
// Without it, one is derived from the Twilio and Supabase secrets so the dashboard still works.
const SECRET =
  process.env.DASHBOARD_SECRET ||
  crypto
    .createHash('sha256')
    .update(`oga-dashboard|${process.env.TWILIO_AUTH_TOKEN || ''}|${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''}`)
    .digest('hex');

// ============================================
// SIGNED TOKENS (links and sessions)
// ============================================

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, kind) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.k !== kind || !payload.t || Date.now() > payload.e) return null;
    return payload;
  } catch {
    return null;
  }
}

function nonce() {
  return crypto.randomBytes(6).toString('base64url');
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

/** Form check: proves a change came from our own page */
function formKey(session) {
  return crypto.createHmac('sha256', SECRET).update(`form|${session.t}|${session.n}`).digest('base64url').slice(0, 24);
}

// PIN tries per link, kept in memory (a link only lives 30 minutes anyway)
const pinTries = new Map();
function triesUsed(linkId) {
  return pinTries.get(linkId) || 0;
}
function addTry(linkId) {
  pinTries.set(linkId, triesUsed(linkId) + 1);
  if (pinTries.size > 5000) pinTries.delete(pinTries.keys().next().value);
}

// ============================================
// LINK FOR WHATSAPP
// ============================================

function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.WEBHOOK_URL) return new URL(process.env.WEBHOOK_URL).origin;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** The link OGA sends on WhatsApp */
function createDashboardLink(traderId) {
  const token = sign({ k: 'link', t: traderId, n: nonce(), e: Date.now() + LINK_MINUTES * 60 * 1000 });
  return `${publicBaseUrl()}/d/${token}`;
}

/** Catches typos like "dasboard", "dashbord", "dashbaord" (at most 2 letters off) */
function looksLikeDashboard(word) {
  if (word.length < 7 || word.length > 11 || !word.startsWith('da')) return false;
  const target = 'dashboard';
  const d = Array.from({ length: word.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= target.length; j++) d[0][j] = j;
  for (let i = 1; i <= word.length; i++) {
    for (let j = 1; j <= target.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (word[i - 1] === target[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && word[i - 1] === target[j - 2] && word[i - 2] === target[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[word.length][target.length] <= 2;
}

/** Words that mean "send me my dashboard" */
function isDashboardRequest(message) {
  const m = (message || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!m) return false;
  const words = m.split(' ');
  // Short messages that mention the dashboard: "dashboard", "send me my dashboard link", "open dashboard abeg"
  if (words.length <= 12 && (/\bdash ?board\b/.test(m) || words.some(looksLikeDashboard))) return true;
  // Very short requests for the book or the link
  return ['records', 'my records', 'my book', 'book', 'open book', 'open my book', 'link', 'my link', 'send link', 'send my link'].includes(m);
}

// ============================================
// NUMBERS AND WORDS
// ============================================

function naira(n) {
  const v = Math.round(Number(n) || 0);
  return `₦${Math.abs(v).toLocaleString('en-NG')}`;
}

function signedNaira(n) {
  return `${Math.round(n) < 0 ? '−' : ''}${naira(n)}`;
}

function compact(n) {
  const v = Math.abs(n);
  if (v >= 1e6) return `₦${(n / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (v >= 1e3) return `₦${Math.round(n / 1e3)}k`;
  return `₦${Math.round(n)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function enc(s) {
  return encodeURIComponent(s ?? '');
}

const TYPE_WORDS = {
  sale: 'Sale',
  purchase: 'Stock bought',
  expense: 'Expense',
  payment_in: 'Payment received',
  payment_out: 'Payment made',
};

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'sale', label: 'Sales' },
  { key: 'purchase', label: 'Stock bought' },
  { key: 'expense', label: 'Expenses' },
  { key: 'payments', label: 'Payments' },
  { key: 'owed', label: 'Not fully paid' },
];

function cleanName(name) {
  const n = String(name ?? '').trim();
  return !n || n.toLowerCase() === 'null' ? null : n;
}

function niceCategory(c) {
  const v = cleanName(c);
  if (!v || ['auto-detect', 'other', 'general'].includes(v.toLowerCase())) return 'Other';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** Any saved time → Lagos time. Times saved without a timezone are UTC (that is how the database stores them). */
function lagos(value) {
  if (!value) return moment.tz(TZ);
  if (moment.isMoment(value) || value instanceof Date) return moment(value).tz(TZ);
  const str = String(value).trim().replace(' ', 'T');
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(str);
  return (hasZone ? moment.parseZone(str) : moment.utc(str)).tz(TZ);
}

function monthOf(key) {
  const thisMonth = moment.tz(TZ).format('YYYY-MM');
  let m = /^\d{4}-\d{2}$/.test(key || '') ? key : thisMonth;
  if (m > thisMonth) m = thisMonth;
  return moment.tz(m, 'YYYY-MM', TZ).startOf('month');
}

/** How a record moves the balance with its person. Positive = they owe the trader more. */
function balanceEffect(t) {
  const total = Number(t.total_amount) || 0;
  const remaining = Number(t.balance_remaining) || 0;
  if (t.type === 'sale') return remaining;
  if (t.type === 'payment_in') return -total;
  if (t.type === 'purchase') return -remaining;
  if (t.type === 'payment_out') return total;
  return 0;
}

// ============================================
// DATA
// ============================================

const BASE_FIELDS = 'id, type, total_amount, amount_paid, balance_remaining, party_name, item_description, category, transaction_date, created_at';

// Projects need a "project" column in Supabase. Until it is added, everything still works without projects.
let hasProjectColumn = true;
const txFields = () => (hasProjectColumn ? `${BASE_FIELDS}, project` : BASE_FIELDS);

/** Runs a query, and if the project column is missing, runs it again without projects */
async function runTx(build) {
  let result = await build(txFields());
  if (result.error && hasProjectColumn && /project/i.test(result.error.message || '')) {
    console.error('⚠️ Projects need one setup step in Supabase (add the "project" column). Showing the dashboard without projects.');
    hasProjectColumn = false;
    result = await build(txFields());
  }
  return result;
}

/** Totals per project. Received = money that came in, spent = money that went out. */
function projectTotals(rows) {
  const map = {};
  (rows || []).forEach((t) => {
    const name = cleanName(t.project);
    if (!name) return;
    const key = name.toLowerCase();
    if (!map[key]) map[key] = { name, received: 0, spent: 0, count: 0 };
    const total = Number(t.total_amount) || 0;
    const paid = t.amount_paid === null || t.amount_paid === undefined ? total : Number(t.amount_paid) || 0;
    if (t.type === 'sale') map[key].received += paid;
    else if (t.type === 'payment_in') map[key].received += total;
    else if (t.type === 'purchase') map[key].spent += paid;
    else if (t.type === 'expense' || t.type === 'payment_out') map[key].spent += total;
    map[key].count += 1;
  });
  return Object.values(map)
    .map((p) => ({ ...p, difference: p.received - p.spent }))
    .sort((a, b) => b.received + b.spent - (a.received + a.spent));
}

async function monthRows(supabase, traderId, month) {
  const { data, error } = await runTx((fields) => supabase
    .from('transactions')
    .select(fields)
    .eq('trader_id', traderId)
    .in('type', TRANSACTION_TYPES)
    .gte('transaction_date', month.clone().startOf('month').toISOString())
    .lte('transaction_date', month.clone().endOf('month').toISOString())
    .order('transaction_date', { ascending: false })
    .limit(1000));
  if (error) console.error('❌ Dashboard: error loading month:', error);
  return (data || []).sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : a.transaction_date > b.transaction_date ? -1 : a.created_at < b.created_at ? 1 : -1));
}

function totalsOf(rows) {
  const sum = (type) => rows.filter((t) => t.type === type).reduce((s, t) => s + (Number(t.total_amount) || 0), 0);
  const totals = { sales: sum('sale'), purchases: sum('purchase'), expenses: sum('expense'), received: sum('payment_in'), paidOut: sum('payment_out') };
  totals.profit = totals.sales - totals.purchases - totals.expenses;
  return totals;
}

async function loadDashboard(supabase, traderId, month) {
  const [rows, prevRows, { data: partyTx, error: partyErr }] = await Promise.all([
    monthRows(supabase, traderId, month),
    monthRows(supabase, traderId, month.clone().subtract(1, 'month')),
    supabase.from('transactions').select('party_name, type, total_amount, balance_remaining').eq('trader_id', traderId).not('party_name', 'is', null),
  ]);
  if (partyErr) console.error('❌ Dashboard: error loading balances:', partyErr);
  const projects = await loadProjects(supabase, traderId);

  // Who owes whom — same rules OGA uses on WhatsApp
  const balances = {};
  (partyTx || []).forEach((t) => {
    const name = cleanName(t.party_name);
    if (!name) return;
    const key = name.toLowerCase();
    if (!balances[key]) balances[key] = { name, amount: 0 };
    balances[key].amount += balanceEffect(t);
  });
  const all = Object.values(balances).filter((b) => Math.round(b.amount) !== 0);
  const owedToYou = all.filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount);
  const youOwe = all.filter((b) => b.amount < 0).sort((a, b) => a.amount - b.amount);

  // Flag repeats: same type, person, item and amount on the same day as another record
  const seen = new Set();
  [...rows].reverse().forEach((t) => {
    const day = lagos(t.transaction_date).format('YYYY-MM-DD');
    const key = [t.type, (t.party_name || '').toLowerCase().trim(), (t.item_description || '').toLowerCase().trim(), Number(t.total_amount), day].join('|');
    if (seen.has(key)) t.repeat = true;
    else seen.add(key);
  });

  // Sales per day of the month
  const dailySales = Array.from({ length: month.daysInMonth() }, () => 0);
  rows.filter((t) => t.type === 'sale').forEach((t) => {
    dailySales[lagos(t.transaction_date).date() - 1] += Number(t.total_amount) || 0;
  });

  // Where the money went: stock + expense categories
  const spend = {};
  rows.forEach((t) => {
    if (t.type === 'purchase') spend['Stock bought'] = (spend['Stock bought'] || 0) + (Number(t.total_amount) || 0);
    if (t.type === 'expense') {
      const c = niceCategory(t.category);
      spend[c] = (spend[c] || 0) + (Number(t.total_amount) || 0);
    }
  });
  let spending = Object.entries(spend).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (spending.length > 6) {
    const keep = spending.slice(0, 5).filter((x) => x.label !== 'Other');
    const rest = spending.filter((x) => !keep.includes(x)).reduce((s, x) => s + x.value, 0);
    spending = [...keep, { label: 'Everything else', value: rest }];
  }

  return { month, rows, totals: totalsOf(rows), prevTotals: totalsOf(prevRows), owedToYou, youOwe, dailySales, spending, projects };
}

/** All of a trader's projects with their totals (empty if they never used projects) */
async function loadProjects(supabase, traderId) {
  if (!hasProjectColumn) return [];
  const { data, error } = await supabase
    .from('transactions')
    .select('project, type, total_amount, amount_paid')
    .eq('trader_id', traderId)
    .in('type', TRANSACTION_TYPES)
    .not('project', 'is', null);
  if (error) {
    if (/project/i.test(error.message || '')) hasProjectColumn = false;
    else console.error('❌ Dashboard: error loading projects:', error);
    return [];
  }
  return projectTotals(data);
}

function applyFilter(rows, type, q) {
  let out = rows;
  if (type === 'payments') out = out.filter((t) => t.type === 'payment_in' || t.type === 'payment_out');
  else if (type === 'owed') out = out.filter((t) => (Number(t.balance_remaining) || 0) > 0);
  else if (TRANSACTION_TYPES.includes(type)) out = out.filter((t) => t.type === type);
  const needle = (q || '').trim().toLowerCase();
  if (needle) {
    out = out.filter((t) => [t.party_name, t.item_description, t.category, t.project].some((v) => String(v || '').toLowerCase().includes(needle)));
  }
  return out;
}

// ============================================
// FORM: CHECK WHAT THE TRADER TYPED
// ============================================

function readNumber(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).toLowerCase().replace(/[₦,\s]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
}

/** Turns the edit/add form into database fields, or returns the problems to show */
function parseRecordForm(body, existing) {
  const errors = {};
  const type = String(body.type || '');
  if (!TRANSACTION_TYPES.includes(type)) errors.type = 'Choose what kind of record this is.';

  const amount = readNumber(body.amount);
  if (amount === null) errors.amount = 'Enter the amount.';
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter the amount as a number, like 5000 or 5k.';
  else if (amount > 1e12) errors.amount = 'That amount is too big. Check the number.';

  const credit = type === 'sale' || type === 'purchase';
  let paid = credit ? readNumber(body.paid) : amount;
  if (credit) {
    if (paid === null) paid = amount; // left blank = fully paid
    else if (!Number.isFinite(paid) || paid < 0) errors.paid = 'Enter the amount paid as a number, or leave it blank if fully paid.';
    else if (Number.isFinite(amount) && paid > amount) errors.paid = `Amount paid can't be more than the full amount (${naira(amount)}).`;
  }

  const party = cleanName(body.party)?.slice(0, 80) || null;
  if ((type === 'payment_in' || type === 'payment_out') && !party) errors.party = 'Say who the payment was with, so their balance stays right.';
  const item = cleanName(body.item)?.slice(0, 200) || null;
  const category = cleanName(body.category)?.slice(0, 40) || null;
  const project = cleanName(body.project)?.slice(0, 60) || null;

  const date = String(body.date || '');
  const day = moment.tz(date, 'YYYY-MM-DD', true, TZ);
  let when = null;
  if (!day.isValid()) errors.date = 'Choose a date.';
  else if (day.isAfter(moment.tz(TZ), 'day')) errors.date = "The date can't be in the future.";
  else {
    const old = existing ? lagos(existing.transaction_date) : null;
    if (old && old.format('YYYY-MM-DD') === date) when = old; // same day: keep the original time
    else if (day.isSame(moment.tz(TZ), 'day')) when = moment.tz(TZ);
    else when = day.clone().hour(12);
  }

  const values = { type, amount: body.amount, paid: body.paid, party: body.party, item: body.item, category: body.category, project: body.project, date };
  if (Object.keys(errors).length) return { errors, values };

  return {
    values,
    fields: {
      type,
      total_amount: amount,
      amount_paid: credit ? paid : amount,
      balance_remaining: credit ? amount - paid : 0,
      party_name: party,
      item_description: item,
      category: category || (existing ? existing.category : null) || (type === 'purchase' ? 'stock' : 'other'),
      transaction_date: when.toISOString(),
      ...(hasProjectColumn ? { project } : {}),
    },
  };
}

function valuesFromRecord(t) {
  const credit = t.type === 'sale' || t.type === 'purchase';
  const cat = cleanName(t.category);
  return {
    type: t.type,
    amount: String(Math.round(Number(t.total_amount) || 0)),
    paid: credit ? String(Math.round(Number(t.amount_paid) || 0)) : '',
    party: cleanName(t.party_name) || '',
    item: cleanName(t.item_description) || '',
    category: cat && cat.toLowerCase() !== 'auto-detect' ? cat : '',
    project: cleanName(t.project) || '',
    date: lagos(t.transaction_date).format('YYYY-MM-DD'),
  };
}

// ============================================
// STYLE
// ============================================

const CSS = `
:root{
  --paper:#EEF2EF; --sheet:#FFFFFF; --ink:#14211A; --soft:#4F5E55; --faint:#7C8A81; --rule:#D3DCD6; --hair:#E4EAE6;
  --in:#11734A; --bar:#11734A; --out:#7A5200; --spend:#9A6500; --stop:#B42318; --focus:#2457C5; --chip:#E3EAE5;
}
@media (prefers-color-scheme: dark){
  :root{ --paper:#0E1511; --sheet:#16211A; --ink:#E6EEE8; --soft:#A5B6AB; --faint:#7F9086; --rule:#2B3A31; --hair:#223029;
    --in:#4CC38A; --bar:#2F9C69; --out:#E0B04E; --spend:#B07C1F; --stop:#FF8A80; --focus:#8AB4FF; --chip:#22302A; }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
h1,h2,h3{margin:0;line-height:1.2}

/* Top bar */
.top{background:var(--ink);color:var(--paper)}
.top-in{max-width:1180px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap}
.brand{font-weight:900;font-size:20px;letter-spacing:.02em;text-decoration:none}
.who-am-i{opacity:.75;font-size:15px;margin-right:auto}
.top nav{display:flex;gap:2px;flex-wrap:wrap}
.top nav a{font-size:15px;text-decoration:none;padding:8px 10px;border-radius:8px}
.top nav a:hover{background:rgba(127,127,127,.2)}
.top nav a.primary{background:var(--paper);color:var(--ink);font-weight:600}

.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 64px}
.notice{background:var(--sheet);border-left:4px solid var(--in);padding:12px 14px;border-radius:6px;margin:0 0 20px}
.notice.bad{border-left-color:var(--stop)}

/* Month bar */
.monthbar{display:flex;align-items:center;gap:8px;margin:0 0 20px;flex-wrap:wrap}
.monthbar h1{font-size:24px;margin-right:auto}
.pill{display:inline-block;padding:7px 14px;border:1px solid var(--rule);border-radius:999px;text-decoration:none;background:var(--sheet);font-size:15px}

.grid{display:grid;gap:20px}
@media (min-width:960px){ .grid{grid-template-columns:380px minmax(0,1fr);align-items:start} }
.side{display:grid;gap:20px;min-width:0}
.panel{background:var(--sheet);border:1px solid var(--rule);border-radius:12px;padding:18px;min-width:0}
.panel h2{font-size:17px;margin-bottom:12px}
.panel p.sub{margin:0 0 12px;color:var(--soft);font-size:14px}

/* The credit book: the one loud thing on the page */
.book h2.big{font-size:28px;font-weight:800;letter-spacing:-.01em;margin-bottom:4px}
.book h2.big .num{color:var(--in)}
.book h3{font-size:16px;margin:18px 0 2px}
.book h3 .num{color:var(--out)}
.ledger{list-style:none;margin:0;padding:0}
.ledger li a{display:flex;align-items:baseline;gap:8px;padding:8px 0;font-size:16px;text-decoration:none}
.ledger li a:hover .who{text-decoration:underline}
.ledger .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ledger .dots{flex:1 1 24px;border-bottom:2px dotted var(--rule);transform:translateY(-4px);min-width:24px}
.ledger .num{font-weight:700}
.empty{color:var(--soft);font-size:15px;margin:0}

/* Month totals */
.totals{display:grid;grid-template-columns:1fr auto;row-gap:7px;margin:0}
.totals dt{color:var(--soft)}
.totals dd{margin:0;text-align:right}
.totals .profit{border-top:1px solid var(--rule);padding-top:9px;margin-top:3px;font-weight:700;color:var(--ink)}
.change{font-size:14px;color:var(--soft);margin:10px 0 0}

/* Charts */
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart .axis{fill:var(--faint);font-size:11px}
.chart .base{stroke:var(--rule);stroke-width:1}
.chart .grid-l{stroke:var(--hair);stroke-width:1}
.chart .b{fill:var(--bar)}
.chart .b:hover{opacity:.8}
.hbars{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.hbars .row{display:flex;justify-content:space-between;gap:12px;font-size:15px;margin-bottom:4px}
.hbars .fill{height:10px;border-radius:0 4px 4px 0;background:var(--spend);min-width:2px}

/* Records */
.records .head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.records .head h2{margin:0 auto 0 0}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.filters a{font-size:14px;padding:6px 12px;border-radius:999px;text-decoration:none;background:var(--chip)}
.filters a[aria-current="page"]{background:var(--ink);color:var(--paper);font-weight:600}
.search{display:flex;gap:8px;margin:0 0 8px}
.search input{flex:1;min-width:0}
.count{color:var(--soft);font-size:14px;margin:0 0 4px}
.day{font-size:13px;color:var(--soft);font-weight:700;margin:18px 0 0;padding-bottom:6px;border-bottom:1px solid var(--rule)}
.rows{list-style:none;margin:0;padding:0}
.rows li{border-bottom:1px solid var(--hair)}
.rec{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 14px;padding:11px 4px;text-decoration:none}
.rec:hover{background:var(--paper)}
.rec .what{font-weight:600;overflow-wrap:anywhere}
.rec .amt{font-weight:700;text-align:right}
.rec .meta{font-size:14px;color:var(--soft)}
.rec .bal{font-size:14px;text-align:right;color:var(--out)}
.rec .time,.rec .kind,.rec .edit{display:none}
@media (min-width:960px){
  .rec{grid-template-columns:64px minmax(0,1fr) 140px 130px 40px;align-items:center}
  .rec .time{display:block;grid-column:1;grid-row:1/3;color:var(--soft);font-size:14px}
  .rec .what{grid-column:2;grid-row:1}
  .rec .meta{grid-column:2;grid-row:2}
  .rec .kind{display:block;grid-column:3;grid-row:1/3;font-size:14px;color:var(--soft)}
  .rec .amt{grid-column:4;grid-row:1}
  .rec .bal{grid-column:4;grid-row:2}
  .rec .edit{display:block;grid-column:5;grid-row:1/3;text-align:right;font-size:14px;color:var(--soft);text-decoration:underline}
  .rec .meta .kind-m{display:none}
}
.proj{display:inline-block;font-size:12px;font-weight:600;color:var(--soft);background:var(--chip);border-radius:6px;padding:1px 8px;margin-left:6px;vertical-align:1px}
.projects{list-style:none;margin:0;padding:0}
.projects li+li{border-top:1px solid var(--hair)}
.projects a{display:block;padding:10px 0;text-decoration:none}
.projects a:hover .pname{text-decoration:underline}
.projects .pname{font-weight:700;display:flex;justify-content:space-between;gap:12px}
.projects .pfig{font-size:14px;color:var(--soft)}
.flag{display:inline-block;font-size:12px;font-weight:700;color:var(--out);border:1px solid currentColor;border-radius:999px;padding:0 8px;margin-left:6px;vertical-align:1px}

/* Forms */
.form{max-width:640px}
.form h1{font-size:24px;margin-bottom:6px}
.form p.sub{color:var(--soft);margin:0 0 20px}
.field{margin:0 0 16px}
.field label{display:block;font-weight:600;margin-bottom:6px}
.field .hint{display:block;color:var(--soft);font-size:14px;font-weight:400}
.field .err{display:block;color:var(--stop);font-size:14px;font-weight:600;margin-top:6px}
.two{display:grid;gap:0 16px}
@media (min-width:600px){ .two{grid-template-columns:1fr 1fr;align-items:end} }
input,select{font:inherit;font-size:16px;width:100%;padding:11px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--sheet);color:var(--ink);min-height:46px}
input[aria-invalid="true"],select[aria-invalid="true"]{border-color:var(--stop);border-width:2px}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px}
button,.btn{font:inherit;font-size:15px;font-weight:600;border-radius:8px;padding:11px 18px;border:1px solid var(--rule);background:var(--sheet);color:var(--ink);cursor:pointer;min-height:46px;text-decoration:none;display:inline-flex;align-items:center}
button.go{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button.danger{background:var(--stop);border-color:var(--stop);color:#fff}
.danger-zone{margin-top:32px;padding-top:20px;border-top:1px solid var(--rule)}
.danger-zone h2{font-size:17px;margin-bottom:6px}
.danger-zone p{color:var(--soft);margin:0}
.check{display:flex;gap:10px;align-items:flex-start;margin:14px 0}
.check input{width:22px;height:22px;min-height:0;margin:1px 0 0;flex:none}

/* Statement */
.stmt{width:100%;border-collapse:collapse;font-size:15px}
.stmt th{text-align:left;font-size:13px;color:var(--soft);font-weight:700;padding:8px 6px;border-bottom:1px solid var(--rule)}
.stmt td{padding:10px 6px;border-bottom:1px solid var(--hair);vertical-align:top}
.stmt .r{text-align:right}
.stmt .note{color:var(--soft);font-size:14px}
.stmt tfoot td{font-weight:700;border-bottom:0;border-top:1px solid var(--rule)}
@media (max-width:600px){ .stmt .hide-s{display:none} }
.in{color:var(--in)} .out{color:var(--out)}

/* PIN page */
.gate{max-width:360px;margin:12vh auto 0;padding:0 16px}
.gate .brand{display:block;margin-bottom:24px}
.gate h1{font-size:26px;margin:0 0 8px}
.gate p{color:var(--soft);margin:0 0 20px}
.gate input{font-size:28px;letter-spacing:.5em;text-align:center;padding:12px;border-width:2px;margin-bottom:12px}
.gate button{width:100%;justify-content:center;font-size:17px}
.gate .err{color:var(--stop);font-weight:600}
@media print{ .top,.filters,.search,.rec .edit,.actions{display:none} body{background:#fff} .panel{border:0} }
`;

// ============================================
// PAGE PIECES
// ============================================

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function displayName(trader) {
  return trader?.name ? trader.name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim() : '';
}

function shell(trader, title, inner, { notice, monthKey } = {}) {
  const name = displayName(trader);
  const m = monthKey ? `?m=${monthKey}` : '';
  return page(
    title,
    `<header class="top"><div class="top-in">
  <a class="brand" href="/dashboard${m}">OGA</a>
  <span class="who-am-i">${name ? `${esc(name)}'s book` : 'Your book'}</span>
  <nav aria-label="Main">
    <a href="/dashboard${m}">Overview</a>
    <a href="/dashboard/export.csv${m}">Download</a>
    <a href="/dashboard/signout">Sign out</a>
    <a class="primary" href="/dashboard/new${m}">Add record</a>
  </nav>
</div></header>
<main class="wrap">
${notice ? `<p class="notice${notice.bad ? ' bad' : ''}" role="status">${esc(notice.text)}</p>` : ''}
${inner}
</main>`
  );
}

function messagePage(title, text) {
  return page(title, `<div class="gate"><span class="brand">OGA</span><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`);
}

function pinPage(token, error) {
  return page(
    'Open your OGA book',
    `<div class="gate">
  <span class="brand">OGA</span>
  <h1>Open your OGA book</h1>
  <p>Enter the 4-digit PIN you chose when you joined OGA.</p>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/d/${esc(token)}">
    <label for="pin" class="sr">PIN</label>
    <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required autofocus>
    <button type="submit" class="go">Open my book</button>
  </form>
</div>`
  );
}

function ledgerList(list) {
  return `<ul class="ledger">${list
    .map((b) => `<li><a href="/dashboard/person?name=${enc(b.name)}"><span class="who">${esc(b.name)}</span><span class="dots" aria-hidden="true"></span><span class="num">${naira(b.amount)}</span></a></li>`)
    .join('')}</ul>`;
}

function salesChart(daily, month) {
  const max = Math.max(...daily);
  if (max <= 0) return `<p class="empty">No sales recorded in ${month.format('MMMM')} yet.</p>`;
  const W = 340, H = 140, top = 10, bottom = 20, left = 36;
  const plotW = W - left, plotH = H - top - bottom;
  const n = daily.length, slot = plotW / n, bw = Math.min(24, slot - 2);
  const p = 10 ** Math.floor(Math.log10(max)), f = max / p;
  const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const y = (v) => top + plotH - (v / nice) * plotH;
  const baseY = top + plotH;
  const bars = daily
    .map((v, i) => {
      if (v <= 0) return '';
      const x = left + i * slot + (slot - bw) / 2, yy = y(v), r = Math.min(4, bw / 2, baseY - yy);
      const d = `M${x.toFixed(1)},${baseY}V${(yy + r).toFixed(1)}Q${x.toFixed(1)},${yy.toFixed(1)} ${(x + r).toFixed(1)},${yy.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${yy.toFixed(1)} ${(x + bw).toFixed(1)},${(yy + r).toFixed(1)}V${baseY}Z`;
      return `<path class="b" d="${d}"><title>${month.clone().date(i + 1).format('ddd D MMM')}: ${naira(v)}</title></path>`;
    })
    .join('');
  const ticks = [nice / 2, nice]
    .map((v) => `<line class="grid-l" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`)
    .join('');
  const labels = [1, 15, n].map((d) => `<text class="axis" x="${(left + (d - 1) * slot + slot / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${d}</text>`).join('');
  const best = daily.indexOf(max);
  const bestDay = month.clone().date(best + 1);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales each day in ${month.format('MMMM')}. Best day ${bestDay.format('D MMMM')}, ${naira(max)}.">
${ticks}<text class="axis" x="${left - 6}" y="${baseY + 4}" text-anchor="end">0</text><line class="base" x1="${left}" x2="${W}" y1="${baseY}" y2="${baseY}"/>${bars}${labels}</svg>
<p class="change">Best day: ${bestDay.format('dddd D MMMM')}, <span class="num">${naira(max)}</span>.</p>`;
}

function spendingBars(spending, month) {
  if (!spending.length) return `<p class="empty">No stock or expenses recorded in ${month.format('MMMM')} yet.</p>`;
  const max = spending[0].value || 1;
  return `<ul class="hbars">${spending
    .map((s) => `<li><div class="row"><span>${esc(s.label)}</span><span class="num">${naira(s.value)}</span></div><div class="fill" style="width:${Math.max(1, (s.value / max) * 100).toFixed(1)}%"></div></li>`)
    .join('')}</ul>`;
}

function changeLine(now, before, prevMonth) {
  if (!before) return '';
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return `<p class="change">Sales are level with ${prevMonth.format('MMMM')}.</p>`;
  return `<p class="change">Sales are ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on ${prevMonth.format('MMMM')} (<span class="num">${naira(before)}</span>).</p>`;
}

function recordRow(t, monthKey = lagos(t.transaction_date).format('YYYY-MM')) {
  const party = cleanName(t.party_name);
  const item = cleanName(t.item_description);
  const word = TYPE_WORDS[t.type] || t.type;
  const what = item || party || word;
  const d = lagos(t.transaction_date);
  const meta = [`<span class="kind-m">${esc(word)}</span>`, item && party ? esc(party) : null].filter(Boolean).join('<span class="kind-m">, </span>');
  const balance = Number(t.balance_remaining) || 0;
  const balText = balance > 0 && t.type === 'sale' ? `${naira(balance)} still owed` : balance > 0 && t.type === 'purchase' ? `You owe ${naira(balance)}` : '';
  return `<li><a class="rec" href="/dashboard/record/${enc(t.id)}?m=${monthKey}">
  <span class="time num">${d.format('h:mm a')}</span>
  <span class="what">${esc(what)}${cleanName(t.project) ? `<span class="proj">${esc(cleanName(t.project))}</span>` : ''}${t.repeat ? '<span class="flag">Looks like a repeat</span>' : ''}</span>
  <span class="amt num">${naira(t.total_amount)}</span>
  <span class="meta">${meta}</span>
  <span class="bal num">${esc(balText)}</span>
  <span class="kind">${esc(word)}</span>
  <span class="edit">Edit</span>
</a></li>`;
}

// ============================================
// PAGES
// ============================================

function dashboardPage(trader, data, { type, q, notice }) {
  const { month, rows, totals, prevTotals, owedToYou, youOwe, dailySales, spending, projects } = data;
  const monthKey = month.format('YYYY-MM');
  const isThisMonth = monthKey === moment.tz(TZ).format('YYYY-MM');
  const prev = month.clone().subtract(1, 'month');
  const next = month.clone().add(1, 'month');
  const owedTotal = owedToYou.reduce((s, b) => s + b.amount, 0);
  const oweTotal = youOwe.reduce((s, b) => s + b.amount, 0);
  const shown = applyFilter(rows, type, q);
  const repeats = rows.filter((t) => t.repeat).length;
  const link = (o) => {
    const p = new URLSearchParams({ m: monthKey });
    if (o.type) p.set('type', o.type);
    if (o.q) p.set('q', o.q);
    return `/dashboard?${p.toString()}`;
  };

  const today = moment.tz(TZ);
  const days = [];
  shown.forEach((t) => {
    const d = lagos(t.transaction_date);
    const label = d.isSame(today, 'day') ? 'Today' : d.isSame(today.clone().subtract(1, 'day'), 'day') ? 'Yesterday' : d.format('dddd D MMMM');
    if (!days.length || days[days.length - 1].label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(t);
  });

  const book = `<section class="panel book" aria-labelledby="owed">
  <h2 class="big" id="owed">${owedToYou.length ? `People owe you <span class="num">${naira(owedTotal)}</span>` : 'Nobody owes you money'}</h2>
  <p class="sub">${owedToYou.length ? 'All months, after payments. Tap a name to see their statement.' : 'When you sell on credit, the names show up here.'}</p>
  ${owedToYou.length ? ledgerList(owedToYou) : ''}
  ${youOwe.length ? `<h3>You owe <span class="num">${naira(oweTotal)}</span></h3>${ledgerList(youOwe)}` : ''}
</section>`;

  const summary = `<section class="panel" aria-labelledby="sum">
  <h2 id="sum">${month.format('MMMM')} ${isThisMonth ? 'so far' : 'total'}</h2>
  <dl class="totals">
    <dt>Sales</dt><dd class="num">${naira(totals.sales)}</dd>
    <dt>Stock bought</dt><dd class="num">${naira(totals.purchases)}</dd>
    <dt>Expenses</dt><dd class="num">${naira(totals.expenses)}</dd>
    <dt class="profit">${totals.profit < 0 ? 'Loss' : 'Profit'}</dt><dd class="profit num">${signedNaira(totals.profit)}</dd>
  </dl>
  ${totals.received || totals.paidOut ? `<p class="change">Debts collected: <span class="num">${naira(totals.received)}</span>. Debts you paid off: <span class="num">${naira(totals.paidOut)}</span>.</p>` : ''}
  ${changeLine(totals.sales, prevTotals.sales, prev)}
</section>`;

  const projectPanel = projects.length
    ? `<section class="panel" aria-labelledby="proj">
  <h2 id="proj">Projects</h2>
  <p class="sub">All months. Tap a project to see its records.</p>
  <ul class="projects">${projects
    .map((p) => `<li><a href="/dashboard/project?name=${enc(p.name)}"><span class="pname"><span>${esc(p.name)}</span><span class="num">${signedNaira(p.difference)}</span></span><span class="pfig">Received <span class="num">${naira(p.received)}</span>, spent <span class="num">${naira(p.spent)}</span></span></a></li>`)
    .join('')}</ul>
</section>`
    : '';

  const charts = `<section class="panel chart" aria-labelledby="daily">
  <h2 id="daily">Sales each day</h2>
  ${salesChart(dailySales, month)}
</section>
<section class="panel" aria-labelledby="went">
  <h2 id="went">Where your money went</h2>
  ${spendingBars(spending, month)}
</section>`;

  const filterLinks = FILTERS.map((f) => `<a href="${link({ type: f.key, q })}"${(type || '') === f.key ? ' aria-current="page"' : ''}>${esc(f.label)}</a>`).join('');
  const countText = rows.length
    ? `${shown.length === rows.length ? `${rows.length} record${rows.length === 1 ? '' : 's'}` : `Showing ${shown.length} of ${rows.length}`}. Tap a record to edit or delete it.${repeats && !q && !type ? ` ${repeats} look${repeats === 1 ? 's' : ''} like a repeat.` : ''}`
    : '';

  const records = `<section class="panel records" aria-labelledby="rec">
  <div class="head"><h2 id="rec">Records</h2><a class="pill" href="/dashboard/new?m=${monthKey}">Add record</a></div>
  <nav class="filters" aria-label="Filter records">${filterLinks}</nav>
  <form class="search" method="get" action="/dashboard" role="search">
    <input type="hidden" name="m" value="${monthKey}">${type ? `<input type="hidden" name="type" value="${esc(type)}">` : ''}
    <label for="q" class="sr">Search by name or item</label>
    <input id="q" name="q" type="search" value="${esc(q || '')}" placeholder="Search a name or item">
    <button type="submit">Search</button>
  </form>
  ${countText ? `<p class="count">${countText}</p>` : ''}
  ${!rows.length ? `<p class="empty">Nothing recorded in ${month.format('MMMM')}. Tell OGA on WhatsApp what you sold or spent, or add a record here.</p>` : ''}
  ${rows.length && !shown.length ? `<p class="empty">No records match. <a href="${link({})}">Show all records</a></p>` : ''}
  ${days.map((d) => `<h3 class="day">${esc(d.label)}</h3><ul class="rows">${d.items.map((t) => recordRow(t, monthKey)).join('')}</ul>`).join('')}
</section>`;

  const inner = `<div class="monthbar">
  <h1>${month.format('MMMM YYYY')}</h1>
  <a class="pill" href="/dashboard?m=${prev.format('YYYY-MM')}">${prev.format('MMM')}</a>
  ${!isThisMonth ? `<a class="pill" href="/dashboard?m=${next.format('YYYY-MM')}">${next.format('MMM')}</a><a class="pill" href="/dashboard">This month</a>` : ''}
</div>
<div class="grid">
  <div class="side">${book}${summary}${projectPanel}${charts}</div>
  ${records}
</div>`;

  return shell(trader, `${displayName(trader) || 'Your'} book — OGA`, inner, { notice, monthKey });
}

function recordFormPage(trader, { mode, values, errors = {}, record, monthKey, key, projectNames = [] }) {
  const v = values || {};
  const err = (f) => (errors[f] ? `<span class="err" id="${f}-err">${esc(errors[f])}</span>` : '');
  const inv = (f) => (errors[f] ? ` aria-invalid="true" aria-describedby="${f}-err"` : '');
  const action = mode === 'edit' ? `/dashboard/record/${enc(record.id)}` : '/dashboard/new';
  const typeOptions = TRANSACTION_TYPES.map((t) => `<option value="${t}"${v.type === t ? ' selected' : ''}>${TYPE_WORDS[t]}</option>`).join('');
  const today = moment.tz(TZ).format('YYYY-MM-DD');
  const errCount = Object.keys(errors).length;

  const ask = record ? `${(TYPE_WORDS[record.type] || record.type).toLowerCase()}${cleanName(record.party_name) ? ` with ${cleanName(record.party_name)}` : ''} for ${naira(record.total_amount)}` : '';
  const dangerZone =
    mode === 'edit'
      ? `<section class="danger-zone" aria-labelledby="del">
  <h2 id="del">Delete this record</h2>
  <p>It will be removed from your book and your totals. This cannot be undone.</p>
  <form method="post" action="/dashboard/record/${enc(record.id)}/delete">
    <input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="m" value="${esc(monthKey)}">
    <label class="check"><input type="checkbox" name="sure" value="yes" required> <span>Yes, delete this ${esc(ask)}</span></label>
    <button type="submit" class="danger">Delete record</button>
  </form>
</section>`
      : '';

  const inner = `<div class="form">
  <h1>${mode === 'edit' ? 'Edit record' : 'Add a record'}</h1>
  <p class="sub">${mode === 'edit' ? 'Changes save straight to your book. OGA on WhatsApp uses the new numbers right away.' : 'For anything you did not tell OGA on WhatsApp.'}</p>
  ${errCount ? `<p class="notice bad" role="alert">Fix the ${errCount === 1 ? 'field' : `${errCount} fields`} marked in red, then save again.</p>` : ''}
  <form method="post" action="${action}" novalidate>
    <input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="m" value="${esc(monthKey)}">
    <div class="two">
      <div class="field"><label for="type">Kind of record</label><select id="type" name="type"${inv('type')}>${!v.type ? '<option value="">Choose one</option>' : ''}${typeOptions}</select>${err('type')}</div>
      <div class="field"><label for="date">Date</label><input id="date" name="date" type="date" max="${today}" value="${esc(v.date || today)}"${inv('date')}>${err('date')}</div>
    </div>
    <div class="two">
      <div class="field"><label for="amount">Full amount (₦)</label><input id="amount" name="amount" inputmode="decimal" autocomplete="off" value="${esc(v.amount)}" placeholder="e.g. 25000 or 25k"${inv('amount')}>${err('amount')}</div>
      <div class="field"><label for="paid">Amount paid so far (₦)<span class="hint">Sales and stock only. Blank means fully paid.</span></label><input id="paid" name="paid" inputmode="decimal" autocomplete="off" value="${esc(v.paid)}"${inv('paid')}>${err('paid')}</div>
    </div>
    <div class="field"><label for="party">Customer or supplier<span class="hint">Use the same spelling each time so their balance adds up.</span></label><input id="party" name="party" autocomplete="off" value="${esc(v.party)}" maxlength="80"${inv('party')}>${err('party')}</div>
    <div class="two">
      <div class="field"><label for="item">What was it</label><input id="item" name="item" autocomplete="off" value="${esc(v.item)}" maxlength="200" placeholder="e.g. rice 2 bags"></div>
      <div class="field"><label for="category">Category</label><input id="category" name="category" autocomplete="off" value="${esc(v.category)}" maxlength="40" placeholder="e.g. Transport, Rent"></div>
    </div>
    ${hasProjectColumn ? `<div class="field"><label for="project">Project<span class="hint">Optional. Only if this belongs to a job, site or event, like "Lekki job".</span></label><input id="project" name="project" list="project-list" autocomplete="off" value="${esc(v.project)}" maxlength="60"><datalist id="project-list">${projectNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>` : ''}
    <div class="actions">
      <button type="submit" class="go">${mode === 'edit' ? 'Save changes' : 'Add record'}</button>
      <a class="btn" href="/dashboard?m=${esc(monthKey)}">Cancel</a>
    </div>
  </form>
  ${dangerZone}
</div>`;
  return shell(trader, mode === 'edit' ? 'Edit record — OGA' : 'Add a record — OGA', inner, { monthKey });
}

function personPage(trader, name, rows) {
  let running = 0;
  const lines = rows.map((t) => {
    const effect = balanceEffect(t);
    running += effect;
    const d = lagos(t.transaction_date);
    return `<tr>
  <td class="num">${d.format('D MMM YYYY')}</td>
  <td><a href="/dashboard/record/${enc(t.id)}?m=${d.format('YYYY-MM')}">${esc(TYPE_WORDS[t.type] || t.type)}</a>${cleanName(t.item_description) ? `<br><span class="note">${esc(t.item_description)}</span>` : ''}</td>
  <td class="r num hide-s">${naira(t.total_amount)}</td>
  <td class="r num">${Math.round(effect) === 0 ? '—' : `${effect > 0 ? '+' : '−'}${naira(effect)}`}</td>
  <td class="r num">${signedNaira(running)}</td>
</tr>`;
  });
  const final = Math.round(running);
  const headline =
    final > 0 ? `${esc(name)} owes you <span class="num in">${naira(final)}</span>` : final < 0 ? `You owe ${esc(name)} <span class="num out">${naira(final)}</span>` : `You and ${esc(name)} are settled`;

  const inner = `<div class="monthbar"><h1>${headline}</h1></div>
<section class="panel">
  <p class="sub">Every record with ${esc(name)}, oldest first. A plus means they owe you more; a minus means the balance went down. Tap a record to edit it.</p>
  ${rows.length ? `<div style="overflow-x:auto"><table class="stmt">
  <thead><tr><th>Date</th><th>Record</th><th class="r hide-s">Amount</th><th class="r">Change</th><th class="r">Balance</th></tr></thead>
  <tbody>${lines.join('')}</tbody>
  <tfoot><tr><td colspan="2">Balance now</td><td class="hide-s"></td><td></td><td class="r num">${signedNaira(final)}</td></tr></tfoot>
</table></div>` : `<p class="empty">No records with ${esc(name)}.</p>`}
  <div class="actions" style="margin-top:16px"><a class="btn" href="/dashboard">Back to overview</a><a class="btn" href="/dashboard/new?party=${enc(name)}">Add a record for ${esc(name)}</a></div>
</section>`;
  return shell(trader, `${name} statement — OGA`, inner, {});
}

function projectPage(trader, name, rows) {
  const [p] = projectTotals(rows.map((t) => ({ ...t, project: name })));
  const totals = p || { received: 0, spent: 0, difference: 0 };
  const inner = `<div class="monthbar"><h1>${esc(name)}</h1></div>
<div class="grid">
  <div class="side"><section class="panel" aria-labelledby="pt">
    <h2 id="pt">Project totals</h2>
    <dl class="totals">
      <dt>Money received</dt><dd class="num">${naira(totals.received)}</dd>
      <dt>Money spent</dt><dd class="num">${naira(totals.spent)}</dd>
      <dt class="profit">${totals.difference < 0 ? 'Spent more than received' : 'Left after spending'}</dt><dd class="profit num">${signedNaira(totals.difference)}</dd>
    </dl>
    <p class="change">All records tagged "${esc(name)}", every month.</p>
    <div class="actions" style="margin-top:14px"><a class="btn" href="/dashboard/new?project=${enc(name)}">Add a record to this project</a></div>
  </section></div>
  <section class="panel records" aria-labelledby="pr">
    <div class="head"><h2 id="pr">Records</h2></div>
    ${rows.length ? `<p class="count">${rows.length} record${rows.length === 1 ? '' : 's'}, newest first. Tap a record to edit it.</p><ul class="rows">${rows.map((t) => recordRow(t)).join('')}</ul>` : `<p class="empty">No records in this project yet.</p>`}
  </section>
</div>`;
  return shell(trader, `${name} — OGA project`, inner, {});
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets running it as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ============================================
// ROUTES
// ============================================

function setupDashboard(app, supabase) {
  const secure = (res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  };

  const expiredLink = () => messagePage('This link has expired', 'Type "dashboard" to OGA on WhatsApp and you will get a new one.');
  const signedOut = () => messagePage('Open your book from WhatsApp', 'Type "dashboard" to OGA on WhatsApp and tap the link it sends you.');

  /** Signed-in trader for this request, or sends the "open from WhatsApp" page */
  async function requireTrader(req, res) {
    secure(res);
    const session = verify(readCookie(req, COOKIE), 'session');
    if (!session) {
      res.status(401).send(signedOut());
      return null;
    }
    const { data: trader, error } = await supabase.from('traders').select('id, name').eq('id', session.t).maybeSingle();
    if (error) console.error('❌ Dashboard: error loading trader:', error);
    if (!trader) {
      res.status(404).send(messagePage('Account not found', 'Message OGA on WhatsApp to set up your account.'));
      return null;
    }
    return { session, trader, key: formKey(session) };
  }

  /** Change requests must carry the form key from our own page */
  function checkKey(ctx, req, res) {
    if (req.body.key !== ctx.key) {
      res.status(403).send(messagePage('Nothing was changed', 'Go back, refresh the page and try again.'));
      return false;
    }
    return true;
  }

  /** Saves, and if the project column is missing, saves again without the project */
  async function withoutProjectIfMissing(row, run) {
    let result = await run(row);
    if (result.error && 'project' in row && /project/i.test(result.error.message || '')) {
      hasProjectColumn = false;
      const { project, ...rest } = row;
      result = await run(rest);
    }
    return result;
  }

  const projectNamesFor = async (traderId) => (await loadProjects(supabase, traderId)).map((p) => p.name);

  async function loadRecord(traderId, id) {
    const { data, error } = await runTx((fields) => supabase.from('transactions').select(fields).eq('id', id).eq('trader_id', traderId).maybeSingle());
    if (error) console.error('❌ Dashboard: error loading record:', error);
    return data && TRANSACTION_TYPES.includes(data.type) ? data : null;
  }

  const notFound = (res, m) => res.redirect(303, `/dashboard?m=${m}&done=missing`);

  // ---- Sign in ----

  app.get('/d/:token', (req, res) => {
    secure(res);
    const link = verify(req.params.token, 'link');
    if (!link) return res.status(410).send(expiredLink());
    if (verify(readCookie(req, COOKIE), 'session')?.t === link.t) return res.redirect(303, '/dashboard');
    res.send(pinPage(req.params.token));
  });

  app.post('/d/:token', async (req, res) => {
    secure(res);
    const token = req.params.token;
    const link = verify(token, 'link');
    if (!link) return res.status(410).send(expiredLink());
    const locked = () => res.status(429).send(messagePage('Too many wrong PINs', 'This link is now locked. Type "dashboard" to OGA on WhatsApp for a new one.'));
    if (triesUsed(link.n) >= MAX_PIN_TRIES) return locked();

    const pin = String(req.body.pin || '').trim();
    const { data: trader, error } = await supabase.from('traders').select('id, pin').eq('id', link.t).maybeSingle();
    if (error) console.error('❌ Dashboard: error loading trader:', error);

    const ok = /^\d{4}$/.test(pin) && trader?.pin && (await bcrypt.compare(pin, trader.pin));
    if (!ok) {
      addTry(link.n);
      const left = MAX_PIN_TRIES - triesUsed(link.n);
      if (left <= 0) return locked();
      return res.status(401).send(pinPage(token, `That PIN is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left.`));
    }

    const session = sign({ k: 'session', t: trader.id, n: nonce(), e: Date.now() + SESSION_HOURS * 3600 * 1000 });
    const https = req.secure || req.get('x-forwarded-proto') === 'https';
    res.set('Set-Cookie', `${COOKIE}=${encodeURIComponent(session)}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`);
    console.log(`🔓 Dashboard opened by trader ${trader.id}`);
    res.redirect(303, '/dashboard');
  });

  app.get('/dashboard/signout', (req, res) => {
    secure(res);
    res.set('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.send(messagePage('Signed out', 'To open your book again, type "dashboard" to OGA on WhatsApp.'));
  });

  // ---- Overview ----

  app.get('/dashboard', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    try {
      const data = await loadDashboard(supabase, ctx.trader.id, monthOf(req.query.m));
      const notices = {
        saved: { text: 'Saved. Your totals are updated.' },
        added: { text: 'Record added. Your totals are updated.' },
        deleted: { text: 'Deleted. Your totals are updated.' },
        missing: { text: 'That record is no longer in your book.', bad: true },
      };
      const type = FILTERS.some((f) => f.key === req.query.type) ? req.query.type : '';
      const q = String(req.query.q || '').slice(0, 60);
      res.send(dashboardPage(ctx.trader, data, { type, q, notice: notices[req.query.done] }));
    } catch (error) {
      console.error('❌ Dashboard error:', error);
      res.status(500).send(messagePage('Your book did not load', 'Check your internet and refresh the page. If it keeps happening, tell OGA on WhatsApp.'));
    }
  });

  // ---- Add a record ----

  app.get('/dashboard/new', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    const monthKey = monthOf(req.query.m).format('YYYY-MM');
    const values = { type: '', party: String(req.query.party || '').slice(0, 80), project: String(req.query.project || '').slice(0, 60), date: moment.tz(TZ).format('YYYY-MM-DD') };
    res.send(recordFormPage(ctx.trader, { mode: 'new', values, monthKey, key: ctx.key, projectNames: await projectNamesFor(ctx.trader.id) }));
  });

  app.post('/dashboard/new', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx || !checkKey(ctx, req, res)) return;
    const monthKey = monthOf(req.body.m).format('YYYY-MM');
    const parsed = parseRecordForm(req.body, null);
    if (parsed.errors) {
      return res.status(400).send(recordFormPage(ctx.trader, { mode: 'new', values: parsed.values, errors: parsed.errors, monthKey, key: ctx.key, projectNames: await projectNamesFor(ctx.trader.id) }));
    }
    const row = { trader_id: ctx.trader.id, ...parsed.fields, business_type: 'general', notes: 'Added on dashboard' };
    const { error } = await withoutProjectIfMissing(row, (r) => supabase.from('transactions').insert(r));
    if (error) {
      console.error('❌ Dashboard add error:', error);
      return res.status(500).send(recordFormPage(ctx.trader, { mode: 'new', values: parsed.values, errors: { amount: 'The record did not save. Check your internet and try again.' }, monthKey, key: ctx.key }));
    }
    console.log(`➕ Dashboard: trader ${ctx.trader.id} added a ${parsed.fields.type}`);
    res.redirect(303, `/dashboard?m=${lagos(parsed.fields.transaction_date).format('YYYY-MM')}&done=added`);
  });

  // ---- Edit a record ----

  app.get('/dashboard/record/:id', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    const monthKey = monthOf(req.query.m).format('YYYY-MM');
    const record = await loadRecord(ctx.trader.id, req.params.id);
    if (!record) return notFound(res, monthKey);
    res.send(recordFormPage(ctx.trader, { mode: 'edit', values: valuesFromRecord(record), record, monthKey, key: ctx.key, projectNames: await projectNamesFor(ctx.trader.id) }));
  });

  app.post('/dashboard/record/:id', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx || !checkKey(ctx, req, res)) return;
    const monthKey = monthOf(req.body.m).format('YYYY-MM');
    const record = await loadRecord(ctx.trader.id, req.params.id);
    if (!record) return notFound(res, monthKey);

    const parsed = parseRecordForm(req.body, record);
    if (parsed.errors) {
      return res.status(400).send(recordFormPage(ctx.trader, { mode: 'edit', values: parsed.values, errors: parsed.errors, record, monthKey, key: ctx.key, projectNames: await projectNamesFor(ctx.trader.id) }));
    }
    const { error } = await withoutProjectIfMissing(parsed.fields, (r) => supabase.from('transactions').update(r).eq('id', record.id).eq('trader_id', ctx.trader.id));
    if (error) {
      console.error('❌ Dashboard edit error:', error);
      return res.status(500).send(recordFormPage(ctx.trader, { mode: 'edit', values: parsed.values, errors: { amount: 'Your change did not save. Check your internet and try again.' }, record, monthKey, key: ctx.key }));
    }
    console.log(`✏️ Dashboard: trader ${ctx.trader.id} edited record ${record.id}`);
    res.redirect(303, `/dashboard?m=${lagos(parsed.fields.transaction_date).format('YYYY-MM')}&done=saved`);
  });

  // ---- Delete a record ----

  app.post('/dashboard/record/:id/delete', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx || !checkKey(ctx, req, res)) return;
    const monthKey = monthOf(req.body.m).format('YYYY-MM');
    if (req.body.sure !== 'yes') return res.redirect(303, `/dashboard/record/${enc(req.params.id)}?m=${monthKey}`);

    // Only ever delete a record that belongs to the signed-in trader
    const { data: deleted, error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', req.params.id)
      .eq('trader_id', ctx.trader.id)
      .in('type', TRANSACTION_TYPES)
      .select('id');
    if (error) {
      console.error('❌ Dashboard delete error:', error);
      return res.status(500).send(messagePage('Nothing was deleted', 'Something went wrong saving the change. Go back and try again.'));
    }
    console.log(`🗑️ Dashboard: trader ${ctx.trader.id} deleted ${deleted?.length || 0} record(s)`);
    res.redirect(303, `/dashboard?m=${monthKey}&done=${deleted?.length ? 'deleted' : 'missing'}`);
  });

  // ---- Statement for one person ----

  app.get('/dashboard/person', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    const name = cleanName(String(req.query.name || '').slice(0, 80));
    if (!name) return res.redirect(303, '/dashboard');
    const pattern = name.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await runTx((fields) => supabase
      .from('transactions')
      .select(fields)
      .eq('trader_id', ctx.trader.id)
      .in('type', TRANSACTION_TYPES)
      .ilike('party_name', pattern)
      .order('transaction_date', { ascending: true })
      .limit(1000));
    if (error) console.error('❌ Dashboard: error loading statement:', error);
    res.send(personPage(ctx.trader, name, data || []));
  });

  // ---- One project ----

  app.get('/dashboard/project', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    const name = cleanName(String(req.query.name || '').slice(0, 60));
    if (!name || !hasProjectColumn) return res.redirect(303, '/dashboard');
    const pattern = name.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await runTx((fields) => supabase
      .from('transactions')
      .select(fields)
      .eq('trader_id', ctx.trader.id)
      .in('type', TRANSACTION_TYPES)
      .ilike('project', pattern)
      .order('transaction_date', { ascending: false })
      .limit(1000));
    if (error) console.error('❌ Dashboard: error loading project:', error);
    const rows = (data || []).sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1));
    res.send(projectPage(ctx.trader, cleanName(rows[0]?.project) || name, rows));
  });

  // ---- Download the month as a spreadsheet ----

  app.get('/dashboard/export.csv', async (req, res) => {
    const ctx = await requireTrader(req, res);
    if (!ctx) return;
    const month = monthOf(req.query.m);
    const rows = (await monthRows(supabase, ctx.trader.id, month)).reverse();
    const header = ['Date', 'Time', 'Kind', 'Customer or supplier', 'Item', 'Category', 'Project', 'Amount', 'Paid', 'Still owed'];
    const lines = rows.map((t) => {
      const d = lagos(t.transaction_date);
      return [d.format('YYYY-MM-DD'), d.format('HH:mm'), TYPE_WORDS[t.type] || t.type, cleanName(t.party_name) || '', cleanName(t.item_description) || '', niceCategory(t.category), cleanName(t.project) || '', Number(t.total_amount) || 0, Number(t.amount_paid) || 0, Number(t.balance_remaining) || 0]
        .map(csvCell)
        .join(',');
    });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="OGA-${month.format('YYYY-MM')}.csv"`);
    res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
  });

  console.log('📒 Dashboard ready at /dashboard');
}

module.exports = { setupDashboard, createDashboardLink, isDashboardRequest, projectTotals };
