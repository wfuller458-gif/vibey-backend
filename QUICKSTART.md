# Vibey Backend - Quick Start

## 5-Minute Setup

### 1. Install & Configure (2 min)

```bash
cd vibey-backend
npm install
cp .env.example .env
```

Edit `.env` - just need Stripe keys to start:
- Get from: https://dashboard.stripe.com/test/apikeys

### 2. Run Locally (1 min)

```bash
npm start
```

Servers now running:
- ✅ API: http://localhost:3000/validate
- ✅ Webhook: http://localhost:3001/webhook

### 3. Deploy to Railway (2 min)

1. Go to https://railway.app
2. "New Project" → "Deploy from GitHub"
3. Select this repo
4. Add your `.env` variables
5. Done! Railway gives you a URL

### 4. Update Your App

In `AppState.swift`, replace:
```swift
let apiURL = "https://your-railway-app.up.railway.app/validate"
```

## Stripe Setup (Full Guide)

See `README.md` for complete Stripe configuration including:
- Creating products ($9 monthly, $79 yearly)
- Setting up payment links
- Configuring webhooks
- Customer portal

## Need Help?

- Check `README.md` for detailed docs
- Test locally first with Stripe test mode
- Use Stripe CLI to test webhooks: `stripe listen --forward-to localhost:3001/webhook`
