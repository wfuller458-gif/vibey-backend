const nodemailer = require('nodemailer');

// Create email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendLicenseEmail(email, licenseKey, plan) {
  const planName = plan === 'monthly' ? 'Monthly' : 'Yearly';
  const price = plan === 'monthly' ? '$9/month' : '$79/year';

  const mailOptions = {
    from: process.env.FROM_EMAIL || 'noreply@vibey.app',
    to: email,
    subject: 'Your Vibey License Key',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 30px 0; }
          .logo { font-size: 32px; font-weight: bold; color: #3B82F6; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 8px; margin: 20px 0; }
          .license-key { background: white; padding: 20px; border-radius: 6px; text-align: center; margin: 20px 0; border: 2px solid #3B82F6; }
          .key { font-family: 'SF Mono', Monaco, monospace; font-size: 18px; font-weight: bold; color: #3B82F6; letter-spacing: 1px; }
          .plan { color: #666; font-size: 14px; margin-top: 10px; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
          .button { display: inline-block; padding: 12px 30px; background: #3B82F6; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">Vibey</div>
          </div>

          <div class="content">
            <h2>Welcome to Vibey!</h2>
            <p>Thank you for subscribing. Here's your license key:</p>

            <div class="license-key">
              <div class="key">${licenseKey}</div>
              <div class="plan">${planName} Plan (${price})</div>
            </div>

            <h3>How to activate:</h3>
            <ol>
              <li>Open Vibey on your Mac</li>
              <li>If you see the paywall, click "Already subscribed? Enter license key"</li>
              <li>Paste your license key: <code>${licenseKey}</code></li>
              <li>Click "Activate License"</li>
            </ol>

            <p><strong>Keep this email safe</strong> - you'll need this license key to activate Vibey on your Mac.</p>

            <a href="https://vibey.app/account" class="button">Manage Subscription</a>
          </div>

          <div class="footer">
            <p>Questions? Reply to this email or visit <a href="https://vibey.app/support">vibey.app/support</a></p>
            <p>Vibey - A calm, focused app for Claude Code</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`License email sent to ${email}`);
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

module.exports = { sendLicenseEmail };
