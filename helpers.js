// Helper Functions for OGA Bot
// Contains utility functions for parsing, categorizing, and processing data

const moment = require('moment-timezone');

// ============================================
// NUMBER FORMAT PARSER
// ============================================
// Converts various number formats to clean integers
// Examples: "9k" → 9000, "1.5m" → 1500000, "nine thousand" → 9000

function parseNumberFormat(input) {
  if (!input) return null;

  const str = String(input).trim().toLowerCase();

  // Already a clean number
  if (/^\d+$/.test(str)) {
    return parseInt(str);
  }

  // Handle decimal numbers like 1.5m, 2.5k
  if (/^[\d.]+\s*(k|m|b)$/i.test(str)) {
    const match = str.match(/^([\d.]+)\s*(k|m|b)$/i);
    const num = parseFloat(match[1]);
    const multiplier = {
      'k': 1000,
      'm': 1000000,
      'b': 1000000000
    }[match[2].toLowerCase()];
    return Math.round(num * multiplier);
  }

  // Handle k, m, b suffix (9k, 5m, 2b)
  if (/^\d+\s*[kmb]$/i.test(str)) {
    const match = str.match(/^(\d+)\s*([kmb])$/i);
    const num = parseInt(match[1]);
    const multiplier = {
      'k': 1000,
      'm': 1000000,
      'b': 1000000000
    }[match[2].toLowerCase()];
    return num * multiplier;
  }

  // Handle written out numbers: "nine thousand", "five million"
  const wordMap = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
    'eighty': 80, 'ninety': 90, 'hundred': 100, 'thousand': 1000,
    'million': 1000000, 'billion': 1000000000
  };

  // Handle "half a million", "quarter million", etc.
  if (str.includes('half') && str.includes('million')) return 500000;
  if (str.includes('half') && str.includes('thousand')) return 500;
  if (str.includes('quarter') && str.includes('million')) return 250000;
  if (str.includes('quarter') && str.includes('thousand')) return 250;

  // Handle "nine thousand", "five million", etc.
  const words = str.split(/\s+/);
  let result = 0;
  let current = 0;

  for (const word of words) {
    if (wordMap.hasOwnProperty(word)) {
      const val = wordMap[word];
      if (val >= 1000) {
        current = (current || 1) * val;
        result += current;
        current = 0;
      } else if (val >= 100) {
        current = (current || 1) * val;
      } else {
        current += val;
      }
    }
  }
  result += current;

  if (result > 0) return result;
  return null;
}

// ============================================
// DATE PARSER
// ============================================
// Converts relative dates to actual ISO dates
// Uses Lagos timezone (Africa/Lagos)

function parseDateFormat(input) {
  if (!input) return null;

  const str = String(input).trim().toLowerCase();
  const now = moment.tz('Africa/Lagos');

  // Handle "today"
  if (str === 'today' || str === 'this morning') {
    return now.format('YYYY-MM-DD');
  }

  // Handle "yesterday"
  if (str === 'yesterday') {
    return now.clone().subtract(1, 'day').format('YYYY-MM-DD');
  }

  // Handle "tomorrow"
  if (str === 'tomorrow') {
    return now.clone().add(1, 'day').format('YYYY-MM-DD');
  }

  // Handle "next [day]" or "last [day]"
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (let i = 0; i < dayNames.length; i++) {
    if (str.includes(dayNames[i])) {
      if (str.includes('next')) {
        let date = now.clone().day(i);
        if (date.isSameOrBefore(now)) {
          date = date.add(1, 'week');
        }
        return date.format('YYYY-MM-DD');
      } else if (str.includes('last')) {
        let date = now.clone().day(i);
        if (date.isSameOrAfter(now)) {
          date = date.subtract(1, 'week');
        }
        return date.format('YYYY-MM-DD');
      } else {
        // No "next" or "last" - assume next occurrence
        let date = now.clone().day(i);
        if (date.isSameOrBefore(now)) {
          date = date.add(1, 'week');
        }
        return date.format('YYYY-MM-DD');
      }
    }
  }

  // Handle "end of month"
  if (str.includes('end') && str.includes('month')) {
    return now.clone().endOf('month').format('YYYY-MM-DD');
  }

  // Handle "beginning of month" or "start of month"
  if ((str.includes('beginning') || str.includes('start')) && str.includes('month')) {
    return now.clone().startOf('month').format('YYYY-MM-DD');
  }

  // Handle "next week"
  if (str === 'next week' || str === 'next 7 days') {
    return now.clone().add(7, 'days').format('YYYY-MM-DD');
  }

  // Handle "last week"
  if (str === 'last week') {
    return now.clone().subtract(7, 'days').format('YYYY-MM-DD');
  }

  // Handle "X days ago" or "X weeks ago"
  const agoMatch = str.match(/(\d+)\s*(days?|weeks?|months?)\s*ago/);
  if (agoMatch) {
    const num = parseInt(agoMatch[1]);
    const unit = agoMatch[2].startsWith('week') ? 'weeks' : agoMatch[2].startsWith('month') ? 'months' : 'days';
    return now.clone().subtract(num, unit).format('YYYY-MM-DD');
  }

  return null;
}

// ============================================
// BUSINESS TYPE DETECTOR
// ============================================
// Detects business type from message content

function detectBusinessType(message) {
  const msg = message.toLowerCase();

  // Business type keywords
  const businessTypes = {
    'fabric': ['ankara', 'lace', 'fabric', 'yard', 'material', 'goods', 'wares', 'wholesale', 'retail', 'bale', 'roll', 'piece', 'sell goods'],
    'food': ['jollof', 'catering', 'food', 'cook', 'event', 'party food', 'rice', 'stew', 'pepper', 'soup', 'snacks', 'drinks', 'chops', 'buka'],
    'property': ['rent', 'tenant', 'flat', 'room', 'landlord', 'apartment', 'collect rent', 'yearly rent'],
    'salon': ['cut', 'weave', 'braid', 'nails', 'lashes', 'hair', 'makeup', 'touch up', 'blow dry', 'perm', 'relaxer', 'colour', 'fix hair'],
    'transport': ['bus', 'vehicle', 'remit', 'driver', 'route', 'trip', 'passengers', 'fare', 'logistics', 'delivery', 'dispatch', 'van'],
    'contracting': ['job', 'site', 'tiling', 'plumbing', 'painting', 'electrical', 'building', 'construction', 'contract', 'labour'],
    'school': ['fees', 'school', 'student', 'lesson', 'term', 'tutorial', 'class', 'subject', 'pupil']
  };

  // Check each business type
  for (const [type, keywords] of Object.entries(businessTypes)) {
    for (const keyword of keywords) {
      if (msg.includes(keyword)) {
        return type;
      }
    }
  }

  return 'general';
}

// ============================================
// EXPENSE CATEGORIZER
// ============================================
// Auto-categorizes expenses

function categorizeExpense(message) {
  const msg = message.toLowerCase();

  const categories = {
    'stock': ['stock', 'goods', 'buy', 'purchase', 'material', 'raw material', 'inventory'],
    'wages': ['pay worker', 'salary', 'wages', 'staff', 'employee', 'paid them'],
    'transport': ['transport', 'fuel', 'delivery', 'shipping', 'travel', 'logistics'],
    'generator': ['generator', 'fuel', 'nepa', 'light', 'power'],
    'rent': ['rent', 'shop rent', 'store', 'office rent', 'house'],
    'levy': ['levy', 'association fee', 'market fee', 'guild'],
    'packaging': ['nylon', 'bag', 'packaging', 'box', 'wrapper'],
    'phone': ['data', 'airtime', 'recharge', 'phone', 'call'],
    'bank_charges': ['bank charge', 'transfer fee', 'withdrawal'],
    'other': []
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (category === 'other') continue;
    for (const keyword of keywords) {
      if (msg.includes(keyword)) {
        return category;
      }
    }
  }

  return 'other';
}

// ============================================
// FORMAT NAIRA AMOUNT
// ============================================
// Formats a number as Nigerian Naira

function formatNaira(amount) {
  if (!amount) return '₦0';
  return '₦' + amount.toLocaleString('en-NG');
}

// ============================================
// EXTRACT NUMBERS FROM TEXT
// ============================================
// Extracts all amounts mentioned in a message

function extractAmounts(message) {
  const amounts = [];

  // Find all k, m patterns
  const patterns = [
    /(\d+\.?\d*)\s*[kmb]/gi,
    /₦\s*[\d,]+/g,
    /\d+,\d+/g,
    /\d{4,}/g
  ];

  for (const pattern of patterns) {
    const matches = message.match(pattern);
    if (matches) {
      amounts.push(...matches);
    }
  }

  return amounts;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  parseNumberFormat,
  parseDateFormat,
  detectBusinessType,
  categorizeExpense,
  formatNaira,
  extractAmounts
};
