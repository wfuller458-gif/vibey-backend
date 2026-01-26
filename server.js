require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createLicense, getLicenseByKey, getLicenseBySubscriptionId, updateLicense } = require('./database');
const { sendLicenseEmail } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS for all routes
app.use(cors());

// Webhook route needs raw body - must be before express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const customer = await stripe.customers.retrieve(session.customer);

        // Determine plan from price ID
        const priceId = subscription.items.data[0].price.id;
        const plan = priceId === process.env.STRIPE_MONTHLY_PRICE_ID ? 'monthly' : 'yearly';

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

        // Send email with license key
        await sendLicenseEmail(customer.email, license.key, plan);

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
