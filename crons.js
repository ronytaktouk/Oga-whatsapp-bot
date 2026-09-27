// Cron Jobs for OGA Bot
// Scheduled tasks that run automatically

const cron = require('node-cron');
const moment = require('moment-timezone');

// ============================================
// INITIALIZE ALL CRON JOBS
// ============================================

function initializeCrons(supabase, twilioClient, anthropic) {
  console.log('🕐 Initializing cron jobs...');

  // ============================================
  // 1. REMINDERS — Every 15 minutes
  // ============================================
  cron.schedule('*/15 * * * *', async () => {
    try {
      console.log('📬 Checking for due reminders...');

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

      if (dueReminders && dueReminders.length > 0) {
        for (const reminder of dueReminders) {
          const trader = await supabase
            .from('traders')
            .select('whatsapp_number, name')
            .eq('id', reminder.trader_id)
            .single();

          if (trader.data) {
            const message = reminder.message || `Reminder: ${reminder.description || 'Check your pending items'}`;

            // Send reminder via Twilio
            await twilioClient.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: trader.data.whatsapp_number,
              body: message
            });

            console.log(`✅ Sent reminder to ${trader.data.name}`);

            // Update reminder status
            await supabase
              .from('reminders')
              .update({ status: 'sent' })
              .eq('id', reminder.id);

            // If recurring, schedule next one
            if (reminder.recurring) {
              const nextDue = calculateNextDue(reminder);
              await supabase
                .from('reminders')
                .update({
                  scheduled_time: nextDue,
                  status: 'pending'
                })
                .eq('id', reminder.id);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Reminders:', error);
    }
  });

  // ============================================
  // 2. RECURRING TRANSACTIONS — Daily 8am Lagos time
  // ============================================
  cron.schedule('0 8 * * *', 'Africa/Lagos', async () => {
    try {
      console.log('🔄 Checking for recurring transactions due today...');

      const today = moment.tz('Africa/Lagos').format('YYYY-MM-DD');
      const { data: recurringTxs, error } = await supabase
        .from('recurring_transactions')
        .select('*')
        .eq('is_active', true)
        .lte('next_due', today);

      if (error) {
        console.error('❌ Error fetching recurring transactions:', error);
        return;
      }

      if (recurringTxs && recurringTxs.length > 0) {
        for (const tx of recurringTxs) {
          const trader = await supabase
            .from('traders')
            .select('whatsapp_number, name')
            .eq('id', tx.trader_id)
            .single();

          if (trader.data) {
            const prompt = `It is ${moment.tz('Africa/Lagos').format('dddd')} ${trader.data.name}.
Your ${tx.description} of ₦${tx.amount.toLocaleString()} is due today.
Have you paid/received it? Reply YES to record it.`;

            await twilioClient.messages.create({
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: trader.data.whatsapp_number,
              body: prompt
            });

            console.log(`✅ Prompted ${trader.data.name} for recurring transaction`);

            // Update last prompted time
            await supabase
              .from('recurring_transactions')
              .update({ last_prompted: new Date().toISOString() })
              .eq('id', tx.id);
          }
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Recurring transactions:', error);
    }
  });

  // ============================================
  // 3. INACTIVE USER CHECK — Daily 10am Lagos time
  // ============================================
  cron.schedule('0 10 * * *', 'Africa/Lagos', async () => {
    try {
      console.log('👤 Checking for inactive users...');

      const fiveDaysAgo = moment.tz('Africa/Lagos').subtract(5, 'days').toISOString();
      const { data: inactiveUsers, error } = await supabase
        .from('traders')
        .select('id, whatsapp_number, name, last_active')
        .eq('is_active', true)
        .lt('last_active', fiveDaysAgo);

      if (error) {
        console.error('❌ Error fetching inactive users:', error);
        return;
      }

      if (inactiveUsers && inactiveUsers.length > 0) {
        for (const user of inactiveUsers) {
          // Check if already messaged recently (prevent spam)
          const recentMessage = await supabase
            .from('reminders')
            .select('id')
            .eq('trader_id', user.id)
            .gte('created_at', moment.tz('Africa/Lagos').subtract(1, 'day').toISOString())
            .single();

          if (!recentMessage.data) {
            // Only message on weekdays, not on Sunday
            const today = moment.tz('Africa/Lagos');
            if (today.day() !== 0) {
              // Not Sunday
              const message = `${user.name} — hope everything is fine with you and the business.
Quick update while you were away:
Just message me when you are ready to continue 🙏`;

              await twilioClient.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: user.whatsapp_number,
                body: message
              });

              console.log(`✅ Sent check-in message to ${user.name}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Inactive users:', error);
    }
  });

  // ============================================
  // 4. MESSAGE QUEUE PROCESSOR — Every 5 minutes
  // ============================================
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('📤 Processing message queue...');

      const { data: queuedMessages, error } = await supabase
        .from('message_queue')
        .select('*')
        .eq('processed', false)
        .limit(10)
        .order('received_at', { ascending: true });

      if (error) {
        console.error('❌ Error fetching queued messages:', error);
        return;
      }

      if (queuedMessages && queuedMessages.length > 0) {
        console.log(`📨 Found ${queuedMessages.length} queued messages`);

        for (const queuedMsg of queuedMessages) {
          try {
            // Mark as processed
            await supabase
              .from('message_queue')
              .update({
                processed: true,
                processed_at: new Date().toISOString()
              })
              .eq('id', queuedMsg.id);

            console.log(`✅ Processed queued message from ${queuedMsg.whatsapp_number}`);
          } catch (processingError) {
            console.error('❌ Error processing queued message:', processingError);
          }
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Message queue:', error);
    }
  });

  // ============================================
  // 5. MONTHLY PDF REPORT — 1st of month at 8am Lagos time
  // ============================================
  cron.schedule('0 8 1 * *', 'Africa/Lagos', async () => {
    try {
      console.log('📊 Generating monthly PDF reports...');

      const { data: activeTraders, error } = await supabase
        .from('traders')
        .select('id, whatsapp_number, name')
        .eq('is_active', true);

      if (error) {
        console.error('❌ Error fetching traders:', error);
        return;
      }

      if (activeTraders && activeTraders.length > 0) {
        for (const trader of activeTraders) {
          // TODO: Generate PDF report for this trader
          // For now, just log
          console.log(`📄 Would generate PDF for ${trader.name}`);
        }
      }
    } catch (error) {
      console.error('❌ Cron error - Monthly reports:', error);
    }
  });

  console.log('✅ All cron jobs initialized');
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
