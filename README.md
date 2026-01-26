# Vibey Backend

License validation and Stripe webhook handler for Vibey macOS app.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### 3. Set Up Stripe

#### Create Products & Prices

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Products → Create Product:
   - **Product 1**: Vibey Monthly
     - Price: $9/month, recurring
     - Copy Price ID → add to `.env` as `STRIPE_MONTHLY_PRICE_ID`

   - **Product 2**: Vibey Yearly
     - Price: $79/year, recurring
     - Copy Price ID → add to `.env` as `STRIPE_YEARLY_PRICE_ID`

#### Create Checkout Page

Use Stripe Checkout for the subscription page:

```javascript
// Example checkout session creation
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [
    {
      price: 'price_xxxxx', // Monthly or Yearly price ID
      quantity: 1,
    },
  ],
  success_url: 'https://vibey.app/success',
  cancel_url: 'https://vibey.app',
});
```

Or use [Stripe Payment Links](https://dashboard.stripe.com/payment-links) (easier):
1. Create payment link for Monthly plan
2. Create payment link for Yearly plan
3. Use these URLs in your app

#### Set Up Webhook

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://your-domain.com/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy webhook signing secret → add to `.env` as `STRIPE_WEBHOOK_SECRET`

#### Customer Portal (for managing subscriptions)

1. Stripe Dashboard → Settings → Billing → Customer Portal
2. Enable "Allow customers to update their payment methods"
3. Enable "Allow customers to cancel subscriptions"
4. Copy portal URL → use in app's `openSubscriptionPortal()`

### 4. Configure Email (SMTP)

**Option A: Gmail**
1. Enable 2FA on your Google account
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Add to `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-16-char-app-password
   ```

**Option B: SendGrid/Mailgun/etc**
Use their SMTP credentials in `.env`

### 5. Run Locally

```bash
# Start both servers
npm run dev
```

This starts:
- API server on `http://localhost:3000`
- Webhook server on `http://localhost:3001`

### 6. Deploy to Production

#### Option A: Railway (Recommended - Easiest)

1. Create account at [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your repo
4. Add environment variables from `.env`
5. Railway gives you a URL like `https://vibey-backend.up.railway.app`

#### Option B: Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in project directory
3. Add environment variables in Vercel dashboard
4. Note: Need to combine both servers into one for Vercel

#### Option C: Your Own VPS

```bash
# On server
git clone your-repo
cd vibey-backend
npm install
npm install -g pm2

# Start with PM2
pm2 start server.js
pm2 start webhook.js
pm2 save
pm2 startup
```

Use Nginx as reverse proxy.

### 7. Update Vibey App

Update URLs in `AppState.swift`:

```swift
// Line 296
let apiURL = "https://your-domain.com/validate"

// Line 380
if let url = URL(string: "https://billing.stripe.com/p/login/YOUR_PORTAL_ID") {

// Line 387
if let url = URL(string: "https://buy.stripe.com/YOUR_PAYMENT_LINK") {
```

## Testing

### Test License Validation

```bash
curl -X POST http://localhost:3000/validate \
  -H "Content-Type: application/json" \
  -d '{"key": "VIBEY-XXXX-XXXX-XXXX"}'
```

### Test Webhook (with Stripe CLI)

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward events to local webhook
stripe listen --forward-to localhost:3001/webhook

# Trigger test event
stripe trigger checkout.session.completed
```

## Database

Currently uses `licenses.json` file. For production, migrate to PostgreSQL:

```sql
CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  renews_at TIMESTAMP,
  expires_at TIMESTAMP
);
```

## Security Notes

- Never commit `.env` file
- Use HTTPS in production
- Validate Stripe webhook signatures
- Rate limit the `/validate` endpoint
- Use environment variables for all secrets

## Support

Email: support@vibey.app
