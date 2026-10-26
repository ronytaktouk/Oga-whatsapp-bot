// Cron Jobs for OGA Bot
// Scheduled tasks that run automatically.
// All daily jobs run on Lagos time (the server itself runs on UTC).

const schedule = require('node-schedule');
const moment = require('moment-timezone');

const TZ = 'Africa/Lagos';

/** Twilio needs the "whatsapp:" prefix; numbers are stored as "+234..." */
function toWhatsApp(phone) {
  return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
}

// ============================================
// INITIALIZE ALL CRON JOBS
// ============================================

function initializeCrons(supabase, twilioClient, anthropic, options = {}) {
  console.log('🕐 Initializing cron jobs...');

  // ============================================
  // 1. REMINDERS — Every 15 minutes
  // ============================================
  schedule.scheduleJob('*/15 * * * *', async () => {
    try {
      const now = new Date();
      const { data: dueReminders, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_time', now.toISOString());

      if (error) {
        console.error('❌ Error fetching reminders:', error);
        return;
      }

      for (const reminder of dueReminders || []) {
        const { data: trader } = await supabase
          .from('traders')
          .select('whatsapp_number, name')
          .eq('id', reminder.trader_id)
          .maybeSingle();

        if (!trader) continue;

        const message = reminder.message || `Reminder: ${reminder.description || 'Check your pending items'}`;

        try {
          await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: toWhatsApp(trader.whatsapp_number),
            body: message,
          });
          console.log(`✅ Sent reminder to ${trader.name}`);
        } catch (sendError) {
          console.error(`❌ Could not send reminder to ${trader.name}:`, sendError.message);
          continue; // leave it pending, try again next run
        }

        if (reminder.recurring) {
          await supabase
            .from('reminders')
            .update({ scheduled_time: calculateNextDue(reminder.scheduled_time, reminder.recurring) })
            .eq('id', reminder.id);
        } else {
          await supabase
            .from('reminders')
            .update({ status: 'sent' })
            .eq('id', reminder.id);
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Reminders:', error);
    }
  });

  // ============================================
  // 2. RECURRING TRANSACTIONS — Daily 8am Lagos time
  // ============================================
  schedule.scheduleJob({ rule: '0 8 * * *', tz: TZ }, async () => {
    try {
      const lagosNow = moment.tz(TZ);
      console.log('🔄 Checking for recurring transactions due today...');

      const today = lagosNow.format('YYYY-MM-DD');
      const { data: recurringTxs, error } = await supabase
        .from('recurring_transactions')
        .select('*')
        .eq('is_active', true)
        .lte('next_due', today);

      if (error) {
        console.error('❌ Error fetching recurring transactions:', error);
        return;
      }

      for (const tx of recurringTxs || []) {
        const { data: trader } = await supabase
          .from('traders')
          .select('whatsapp_number, name')
          .eq('id', tx.trader_id)
          .maybeSingle();

        if (!trader) continue;

        const amount = Number(tx.amount) || 0;
        const prompt = `It is ${lagosNow.format('dddd')} ${trader.name}.
Your ${tx.description} of ₦${amount.toLocaleString()} is due today.
Have you paid or received it? Tell me and I go record am.`;

        try {
          await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: toWhatsApp(trader.whatsapp_number),
            body: prompt,
          });
          console.log(`✅ Prompted ${trader.name} for recurring transaction`);
        } catch (sendError) {
          console.error(`❌ Could not prompt ${trader.name}:`, sendError.message);
          continue;
        }

        // Move next_due forward so the trader is not prompted again tomorrow
        await supabase
          .from('recurring_transactions')
          .update({
            last_prompted: new Date().toISOString(),
            next_due: moment.tz(calculateNextDue(tx.next_due, tx.frequency), TZ).format('YYYY-MM-DD'),
          })
          .eq('id', tx.id);
      }
    } catch (error) {
      console.error('❌ Cron error - Recurring transactions:', error);
    }
  });

  // ============================================
  // 3. INACTIVE USER CHECK — Daily 10am Lagos time, not on Sundays
  // Each trader gets ONE check-in per silence: only traders whose last
  // message was 5 days ago (5-7 days on Monday, to cover the skipped Sunday).
  // ============================================
  schedule.scheduleJob({ rule: '0 10 * * *', tz: TZ }, async () => {
    try {
      const lagosNow = moment.tz(TZ);
      if (lagosNow.day() === 0) return; // Sunday

      console.log('👤 Checking for inactive users...');

      const windowDays = lagosNow.day() === 1 ? 2 : 1; // Monday also covers Sunday
      const newerLimit = lagosNow.clone().subtract(5, 'days').toISOString();
      const olderLimit = lagosNow.clone().subtract(5 + windowDays, 'days').toISOString();

      const { data: inactiveUsers, error } = await supabase
        .from('traders')
        .select('id, whatsapp_number, name, last_active')
        .eq('is_active', true)
        .lt('last_active', newerLimit)
        .gte('last_active', olderLimit);

      if (error) {
        console.error('❌ Error fetching inactive users:', error);
        return;
      }

      for (const user of inactiveUsers || []) {
        if (!user.name) continue;
        const message = `${user.name}, hope everything dey fine with you and the business 🙏
Whenever you ready, just tell me wetin happen and I go record am.`;

        try {
          await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: toWhatsApp(user.whatsapp_number),
            body: message,
          });
          console.log(`✅ Sent check-in message to ${user.name}`);
        } catch (sendError) {
          console.error(`❌ Could not send check-in to ${user.name}:`, sendError.message);
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Inactive users:', error);
    }
  });

  // ============================================
  // 4. MESSAGE QUEUE PROCESSOR — Every 5 minutes
  // Re-runs messages that failed earlier (the trader was told
  // "Your message is safe and waiting"). The old version only marked
  // them as processed, so they were silently thrown away.
  // ============================================
  schedule.scheduleJob('*/5 * * * *', async () => {
    try {
      const { data: queuedMessages, error } = await supabase
        .from('message_queue')
        .select('*')
        .eq('processed', false)
        .order('received_at', { ascending: true })
        .limit(10);

      if (error) {
        console.error('❌ Error fetching queued messages:', error);
        return;
      }

      if (!queuedMessages || queuedMessages.length === 0) return;
      console.log(`📨 Found ${queuedMessages.length} queued messages`);

      for (const queuedMsg of queuedMessages) {
        // Mark as processed FIRST, so a message is never run twice
        const { error: markError } = await supabase
          .from('message_queue')
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq('id', queuedMsg.id);
        if (markError) {
          console.error('❌ Could not mark queued message:', markError);
          continue;
        }

        if (!options.processQueuedMessage) continue;

        try {
          await options.processQueuedMessage(
            queuedMsg.whatsapp_number,
            queuedMsg.message_content,
            queuedMsg.received_at
          );
          console.log(`✅ Re-processed queued message from ${queuedMsg.whatsapp_number}`);
        } catch (processingError) {
          console.error('❌ Error processing queued message:', processingError);
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Message queue:', error);
    }
  });

  // ============================================
  // 5. MONTHLY PDF REPORT — 1st of month at 8am Lagos time
  // NOT BUILT YET: this only logs. The monthly PDF still needs writing.
  // ============================================
  schedule.scheduleJob({ rule: '0 8 1 * *', tz: TZ }, async () => {
    try {
      console.log('📊 Monthly PDF reports (not built yet)...');

      const { data: activeTraders, error } = await supabase
        .from('traders')
        .select('id, whatsapp_number, name')
        .eq('is_active', true);

      if (error) {
        console.error('❌ Error fetching traders:', error);
        return;
      }

      for (const trader of activeTraders || []) {
        console.log(`📄 Would generate PDF for ${trader.name}`);
      }
    } catch (error) {
      console.error('❌ Cron error - Monthly reports:', error);
    }
  });

  console.log('✅ All cron jobs initialized');
}

// ============================================
// HELPER: next date for something that repeats
// ============================================

function calculateNextDue(fromDate, frequency) {
  let nextDue = moment.tz(fromDate, TZ);

  if (frequency === 'daily') nextDue = nextDue.add(1, 'day');
  else if (frequency === 'weekly') nextDue = nextDue.add(1, 'week');
  else nextDue = nextDue.add(1, 'month'); // monthly, or unknown: wait a month rather than repeat daily

  return nextDue.toISOString();
}

// ============================================
// EXPORTS
// ============================================

module.exports = { initializeCrons };
