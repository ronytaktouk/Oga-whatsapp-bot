// Cron Jobs for OGA Bot
// Scheduled tasks that run automatically
// ⚠️ TEMPORARILY DISABLED: node-cron incompatible with Node.js 18+

const cron = require('node-cron');
const moment = require('moment-timezone');

// ============================================
// INITIALIZE ALL CRON JOBS
// ============================================

function initializeCrons(supabase, twilioClient, anthropic) {
  console.log('🕐 Cron jobs disabled temporarily (Node.js 18+ compatibility issue)...');

  // TODO: Fix node-cron with named functions or upgrade to v4+
  // All cron jobs disabled to prevent:
  // TypeError: Cannot assign to read only property 'name'

  // Disabled jobs:
  // 1. REMINDERS — Every 15 minutes
  // 2. RECURRING TRANSACTIONS — Daily 8am Lagos time
  // 3. INACTIVE USER CHECK — Daily 10am Lagos time
  // 4. MESSAGE QUEUE PROCESSOR — Every 5 minutes
  // 5. MONTHLY PDF REPORT — 1st of month at 8am Lagos time

  console.log('✅ Cron job initialization skipped (disabled for Node.js compatibility)');
}

// ============================================
// HELPER FUNCTION: Calculate next due date for recurring transactions
// ============================================

function calculateNextDue(reminder) {
  let nextDue = moment.tz(reminder.scheduled_time, 'Africa/Lagos');

  if (reminder.recurring === 'daily') {
    nextDue = nextDue.add(1, 'day');
  } else if (reminder.recurring === 'weekly') {
    nextDue = nextDue.add(1, 'week');
  } else if (reminder.recurring === 'monthly') {
    nextDue = nextDue.add(1, 'month');
  }

  return nextDue.toISOString();
}

// ============================================
// EXPORTS
// ============================================

module.exports = { initializeCrons };
