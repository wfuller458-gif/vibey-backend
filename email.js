const { Resend } = require('resend');

// Initialize lazily to ensure env vars are loaded
let resend = null;
function getResend() {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set');
      return null;
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

async function sendLicenseEmail(email, licenseKey, plan) {
  const client = getResend();
  if (!client) {
    console.error('Cannot send email - Resend not configured');
    return false;
  }
  const planName = plan === 'monthly' ? 'Monthly' : 'Yearly';
  const price = plan === 'monthly' ? '£5.99/month' : '£39.99/year';

  try {
    const { data, error } = await client.emails.send({
      from: process.env.FROM_EMAIL || 'Vibey <onboarding@resend.dev>',
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
            .logo { font-size: 32px; font-weight: bold; color: #0459FE; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 8px; margin: 20px 0; }
            .license-key { background: white; padding: 20px; border-radius: 6px; text-align: center; margin: 20px 0; border: 2px solid #0459FE; }
            .key { font-family: 'SF Mono', Monaco, monospace; font-size: 18px; font-weight: bold; color: #0459FE; letter-spacing: 1px; }
            .plan { color: #666; font-size: 14px; margin-top: 10px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Vibey.code</div>
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
                <li>Click "Already subscribed? Enter license key"</li>
                <li>Paste your license key</li>
                <li>Click "Activate License"</li>
              </ol>

              <p><strong>Keep this email safe</strong> - you'll need this license key to activate Vibey.</p>
            </div>

            <div class="footer">
              <p>Questions? Reply to this email.</p>
              <p>Vibey.code - Claude Code without the pain of the terminal</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log(`License email sent to ${email}, id: ${data.id}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error.message);
    return false;
  }
}

module.exports = { sendLicenseEmail };
