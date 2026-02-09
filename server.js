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

  // Build HTML dashboard
  const now = Date.now();
  const formatDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';
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

  const statusBadge = (status) => {
    const colors = {
      active: '#22c55e',
      cancelled: '#ef4444',
      payment_failed: '#f59e0b',
      trial: '#3b82f6'
    };
    return \`<span style="background:\${colors[status] || '#6b7280'};color:white;padding:2px 8px;border-radius:4px;font-size:12px">\${status}</span>\`;
  };

  // Combine licenses with usage data
  const rows = licenses.map(l => {
    const usageData = usage[l.key] || {};
    return \`
      <tr>
        <td>\${l.email}</td>
        <td><code>\${l.key}</code></td>
        <td>\${l.plan}</td>
        <td>\${statusBadge(l.status)}</td>
        <td>\${formatDate(l.createdAt)}</td>
        <td>\${l.renewsAt ? formatDate(l.renewsAt) : '-'}</td>
        <td>\${timeAgo(usageData.lastSeen)}</td>
        <td>\${usageData.sessionCount || 0}</td>
      </tr>
    \`;
  }).join('');

  // Trial users (users who pinged but aren't in licenses)
  const trialUsage = usage['trial'] || {};
  const trialRow = trialUsage.lastSeen ? \`
    <tr style="background:#1e293b">
      <td colspan="2"><em>Trial Users (aggregate)</em></td>
      <td>trial</td>
      <td>\${statusBadge('trial')}</td>
      <td>-</td>
      <td>-</td>
      <td>\${timeAgo(trialUsage.lastSeen)}</td>
      <td>\${trialUsage.sessionCount || 0}</td>
    </tr>
  \` : '';

  const html = \`
<!DOCTYPE html>
<html>
<head>
  <title>Vibey Admin Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
    h1 { color: #fff; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; margin-bottom: 30px; }
    .stat { background: #1e293b; padding: 20px; border-radius: 8px; min-width: 150px; }
    .stat-value { font-size: 32px; font-weight: bold; color: #fff; }
    .stat-label { color: #94a3b8; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #334155; }
    th { background: #334155; color: #fff; font-weight: 600; }
    tr:hover { background: #334155; }
    code { background: #334155; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .refresh { color: #94a3b8; font-size: 14px; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h1>🎵 Vibey Admin Dashboard</h1>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">\${licenses.length}</div>
      <div class="stat-label">Total Licenses</div>
    </div>
    <div class="stat">
      <div class="stat-value">\${licenses.filter(l => l.status === 'active').length}</div>
      <div class="stat-label">Active</div>
    </div>
    <div class="stat">
      <div class="stat-value">\${licenses.filter(l => l.status === 'payment_failed').length}</div>
      <div class="stat-label">Payment Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value">\${trialUsage.sessionCount || 0}</div>
      <div class="stat-label">Trial Sessions</div>
    </div>
  </div>

  <p class="refresh">Last refreshed: \${new Date().toLocaleString()}</p>

  <table>
    <thead>
      <tr>
        <th>Email</th>
        <th>License Key</th>
        <th>Plan</th>
        <th>Status</th>
        <th>Created</th>
        <th>Renews</th>
        <th>Last Active</th>
        <th>Sessions</th>
      </tr>
    </thead>
    <tbody>
      \${rows}
      \${trialRow}
    </tbody>
  </table>
</body>
</html>
  \`;

  res.type('html').send(html);
});

// Analytics ping endpoint - app calls this on launch
app.post('/ping', async (req, res) => {
  try {
    const { licenseKey, appVersion } = req.body;

    // Record usage (works for both licensed and trial users)
    await recordUsage(licenseKey || 'trial', appVersion);

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
