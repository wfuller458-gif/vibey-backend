require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createLicense, getLicenseByKey, getLicenseBySubscriptionId, updateLicense, recordUsage, getAllUsage } = require('./database');
// Email disabled - showing license on success page instead
// const { sendLicenseEmail } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors({
  origin: ['https://vibey.codes', 'https://www.vibey.codes', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
}));

// Webhook route needs raw body - must be FIRST before any body parsing
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  console.log('Webhook received');
  console.log('Signature present:', !!sig);
  console.log('Secret configured:', !!webhookSecret);
  console.log('Body type:', typeof req.body);
  console.log('Body is Buffer:', Buffer.isBuffer(req.body));

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set!');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('Webhook verified successfully:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    console.error('Body preview:', req.body?.toString?.().substring(0, 100));
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log('Processing event:', event.type);
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const customer = await stripe.customers.retrieve(session.customer);

        // Determine plan from price ID
        const priceId = subscription.items.data[0].price.id;
        console.log('Price ID from Stripe:', priceId);
        console.log('Monthly price ID env:', process.env.STRIPE_MONTHLY_PRICE_ID);
        const plan = priceId === process.env.STRIPE_MONTHLY_PRICE_ID ? 'monthly' : 'yearly';
        console.log('Determined plan:', plan);

        // Create license
        const license = await createLicense(
          customer.email,
          plan,
          customer.id,
          subscription.id
        );

        // Set renewal date
        await updateLicense(license.key, {
          renewsAt: subscription.current_period_end * 1000
        });

        // Email disabled - showing license on success page instead
        // await sendLicenseEmail(customer.email, license.key, plan);

        console.log(`License created for ${customer.email}: ${license.key}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const license = await getLicenseBySubscriptionId(subscription.id);

        if (license) {
          await updateLicense(license.key, {
            status: subscription.status === 'active' ? 'active' : 'cancelled',
            renewsAt: subscription.current_period_end * 1000
          });
          console.log(`License ${license.key} updated: ${subscription.status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const license = await getLicenseBySubscriptionId(subscription.id);

        if (license) {
          await updateLicense(license.key, {
            status: 'cancelled',
            expiresAt: subscription.current_period_end * 1000
          });
          console.log(`License ${license.key} cancelled`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const license = await getLicenseBySubscriptionId(invoice.subscription);

          if (license) {
            await updateLicense(license.key, {
              status: 'payment_failed'
            });
            console.log(`Payment failed for license ${license.key}`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// JSON parsing for all other routes
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get license by Stripe session ID (for success page)
app.get('/license/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('Looking up license for session:', sessionId);

    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('Stripe session found, customer:', session.customer);

    if (!session || !session.customer) {
      console.log('No session or no customer');
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get customer email (same way webhook does it)
    const customer = await stripe.customers.retrieve(session.customer);
    const email = customer.email;
    console.log('Customer email:', email);

    if (!email) {
      return res.status(404).json({ error: 'Customer email not found' });
    }

    // Find license by email
    const { getLicenseByEmail } = require('./database');
    const license = await getLicenseByEmail(email);
    console.log('License lookup result:', license ? license.key : 'NOT FOUND');

    if (!license) {
      // License might not be created yet (webhook race condition)
      return res.status(404).json({ error: 'License not found - please wait a moment and refresh' });
    }

    res.json({
      key: license.key,
      plan: license.plan,
      email: email
    });
  } catch (error) {
    console.error('Get license error:', error.message);
    res.status(500).json({ error: 'Failed to get license' });
  }
});

// Admin: DELETE a single user from usage tracking
app.delete('/vibey-admin-8f3k2j/user/:deviceId', async (req, res) => {
  const fs = require('fs').promises;
  const path = require('path');
  try {
    const data = await fs.readFile(path.join(__dirname, 'usage.json'), 'utf8');
    const usage = JSON.parse(data);
    const { deviceId } = req.params;
    if (!usage[deviceId]) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    delete usage[deviceId];
    await fs.writeFile(path.join(__dirname, 'usage.json'), JSON.stringify(usage, null, 2));
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: RESET all data (secret URL) - clears licenses and usage
app.post('/vibey-admin-8f3k2j/reset', async (req, res) => {
  const fs = require('fs').promises;
  const path = require('path');
  try {
    await fs.writeFile(path.join(__dirname, 'licenses.json'), JSON.stringify({ licenses: [] }, null, 2));
    await fs.writeFile(path.join(__dirname, 'usage.json'), JSON.stringify({}, null, 2));
    res.json({ success: true, message: 'All licenses and usage data cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: list all licenses (secret URL)
app.get('/vibey-admin-8f3k2j/all', async (req, res) => {
  const fs = require('fs').promises;
  const path = require('path');
  try {
    const data = await fs.readFile(path.join(__dirname, 'licenses.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.json({ licenses: [] });
  }
});

// Admin: lookup license by email (secret URL)
app.get('/vibey-admin-8f3k2j/lookup/:email', async (req, res) => {
  const { getLicenseByEmail } = require('./database');
  const license = await getLicenseByEmail(req.params.email);

  if (!license) {
    return res.status(404).json({ error: 'No license found for this email' });
  }

  res.json(license);
});

// Admin Dashboard (secret URL)
app.get('/vibey-admin-8f3k2j/dashboard', async (req, res) => {
  const fs = require('fs').promises;
  const path = require('path');

  let licenses = [];
  let usage = {};

  try {
    const licenseData = await fs.readFile(path.join(__dirname, 'licenses.json'), 'utf8');
    licenses = JSON.parse(licenseData).licenses || [];
  } catch {}

  try {
    usage = await getAllUsage();
  } catch {}

  const now = Date.now();

  // Helper functions
  const timeAgo = (ts) => {
    if (!ts) return 'Never';
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return days + 'd ago';
    if (hours > 0) return hours + 'h ago';
    if (mins > 0) return mins + 'm ago';
    return 'Just now';
  };

  const timeUntil = (ts) => {
    if (!ts) return '-';
    const diff = ts - now;
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + 'd ' + hours + 'h left';
    return hours + 'h left';
  };

  const badge = (text, color) => {
    return '<span style="background:' + color + ';color:white;padding:2px 8px;border-radius:4px;font-size:12px">' + text + '</span>';
  };

  // Build user list from usage data
  const users = Object.entries(usage).map(([deviceId, data]) => {
    const hasLicense = data.licenseKey && licenses.find(l => l.key === data.licenseKey);
    const trialExpired = data.trialEndDate && data.trialEndDate < now;

    let status, statusColor;
    if (hasLicense) {
      status = 'Converted';
      statusColor = '#22c55e';
    } else if (trialExpired) {
      status = 'Trial Expired';
      statusColor = '#ef4444';
    } else if (data.trialEndDate) {
      status = 'Trial Active';
      statusColor = '#3b82f6';
    } else {
      status = 'Unknown';
      statusColor = '#6b7280';
    }

    return {
      deviceId,
      status,
      statusColor,
      trialEndDate: data.trialEndDate,
      licenseKey: data.licenseKey,
      lastSeen: data.lastSeen,
      sessionCount: data.sessionCount || 0,
      firstSeen: data.firstSeen,
      appVersion: data.appVersion
    };
  }).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

  // Stats
  const totalUsers = users.length;
  const activeTrials = users.filter(u => u.status === 'Trial Active').length;
  const expiredTrials = users.filter(u => u.status === 'Trial Expired').length;
  const converted = users.filter(u => u.status === 'Converted').length;

  // Build rows
  const rows = users.map(u => {
    return '<tr id="row-' + u.deviceId + '">' +
      '<td><code style="font-size:10px">' + u.deviceId.substring(0, 8) + '...</code></td>' +
      '<td>' + badge(u.status, u.statusColor) + '</td>' +
      '<td>' + timeUntil(u.trialEndDate) + '</td>' +
      '<td>' + (u.licenseKey ? '<code style="font-size:10px">' + u.licenseKey.substring(0, 12) + '...</code>' : '-') + '</td>' +
      '<td>' + timeAgo(u.lastSeen) + '</td>' +
      '<td>' + u.sessionCount + '</td>' +
      '<td>' + (u.appVersion || '-') + '</td>' +
      '<td><button onclick="deleteUser(\'' + u.deviceId + '\')" style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px">Delete</button></td>' +
      '</tr>';
  }).join('');

  const html = '<!DOCTYPE html>' +
'<html>' +
'<head>' +
'  <title>Vibey Admin Dashboard</title>' +
'  <meta http-equiv="refresh" content="30">' +
'  <style>' +
'    * { box-sizing: border-box; }' +
'    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }' +
'    h1 { color: #fff; margin-bottom: 10px; }' +
'    h2 { color: #94a3b8; font-size: 16px; margin: 30px 0 15px 0; }' +
'    .stats { display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; }' +
'    .stat { background: #1e293b; padding: 20px; border-radius: 8px; min-width: 140px; }' +
'    .stat-value { font-size: 28px; font-weight: bold; color: #fff; }' +
'    .stat-label { color: #94a3b8; font-size: 13px; margin-top: 4px; }' +
'    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }' +
'    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #334155; }' +
'    th { background: #334155; color: #fff; font-weight: 600; font-size: 13px; }' +
'    td { font-size: 13px; }' +
'    tr:hover { background: #334155; }' +
'    code { background: #334155; padding: 2px 6px; border-radius: 4px; }' +
'    .refresh { color: #64748b; font-size: 12px; margin-bottom: 20px; }' +
'  </style>' +
'</head>' +
'<body>' +
'  <h1>Vibey Admin Dashboard</h1>' +
'  <p class="refresh">Auto-refreshes every 30s | Last: ' + new Date().toLocaleString() + '</p>' +
'  <div class="stats">' +
'    <div class="stat">' +
'      <div class="stat-value">' + totalUsers + '</div>' +
'      <div class="stat-label">Total Users</div>' +
'    </div>' +
'    <div class="stat">' +
'      <div class="stat-value" style="color:#3b82f6">' + activeTrials + '</div>' +
'      <div class="stat-label">Active Trials</div>' +
'    </div>' +
'    <div class="stat">' +
'      <div class="stat-value" style="color:#ef4444">' + expiredTrials + '</div>' +
'      <div class="stat-label">Expired Trials</div>' +
'    </div>' +
'    <div class="stat">' +
'      <div class="stat-value" style="color:#22c55e">' + converted + '</div>' +
'      <div class="stat-label">Converted</div>' +
'    </div>' +
'  </div>' +
'  <h2>All Users</h2>' +
'  <table>' +
'    <thead>' +
'      <tr>' +
'        <th>Device</th>' +
'        <th>Status</th>' +
'        <th>Trial Expires</th>' +
'        <th>License</th>' +
'        <th>Last Active</th>' +
'        <th>Sessions</th>' +
'        <th>Version</th>' +
'        <th>Actions</th>' +
'      </tr>' +
'    </thead>' +
'    <tbody>' + (rows || '<tr><td colspan="8" style="text-align:center;color:#64748b">No users yet</td></tr>') + '</tbody>' +
'  </table>' +
'  <script>' +
'    async function deleteUser(deviceId) {' +
'      if (!confirm("Delete user " + deviceId.substring(0, 8) + "...?")) return;' +
'      const res = await fetch("/vibey-admin-8f3k2j/user/" + encodeURIComponent(deviceId), { method: "DELETE" });' +
'      if (res.ok) { document.getElementById("row-" + deviceId).remove(); }' +
'      else { alert("Failed to delete user"); }' +
'    }' +
'  </script>' +
'</body>' +
'</html>';

  res.type('html').send(html);
});

// Analytics ping endpoint - app calls this on launch
app.post('/ping', async (req, res) => {
  try {
    const { deviceId, licenseKey, appVersion, trialEndDate } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId required' });
    }

    // Record usage with all the info
    await recordUsage(deviceId, licenseKey || null, appVersion, trialEndDate || null);

    res.json({ success: true });
  } catch (error) {
    console.error('Ping error:', error);
    res.status(500).json({ success: false });
  }
});

// License validation endpoint
app.post('/validate', async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({
        valid: false,
        reason: 'License key is required'
      });
    }

    // Get license from database
    const license = await getLicenseByKey(key);

    if (!license) {
      return res.json({
        valid: false,
        reason: 'License key not found'
      });
    }

    // Check if license is active
    const now = Date.now();
    const isValid = license.status === 'active' && (!license.expiresAt || license.expiresAt > now);

    if (!isValid) {
      return res.json({
        valid: false,
        reason: license.status === 'cancelled' ? 'Subscription cancelled' : 'License expired'
      });
    }

    // Valid license
    res.json({
      valid: true,
      plan: license.plan,
      renewsOn: license.renewsAt ? Math.floor(license.renewsAt / 1000) : null
    });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      valid: false,
      reason: 'Internal server error'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Vibey backend running on port ${PORT}`);
  console.log(`  - Health: http://localhost:${PORT}/health`);
  console.log(`  - Validate: POST http://localhost:${PORT}/validate`);
  console.log(`  - Webhook: POST http://localhost:${PORT}/webhook`);
});

module.exports = app;
