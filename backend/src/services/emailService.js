const nodemailer = require('nodemailer');

const sendAlertEmail = async (smtpConfig, toEmails, alertData) => {
  try {
    if (!smtpConfig.host || !smtpConfig.username || !smtpConfig.password) {
      console.warn("SMTP not configured, email not sent");
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465, // true for 465, false for other ports
      auth: {
        user: smtpConfig.username,
        pass: smtpConfig.password,
      },
    });

    const riskColor = alertData.risk_level === 'high' ? '#dc2626' : '#f59e0b';

    const htmlBody = `
      <html>
          <head>
              <style>
                  body { font-family: Arial, sans-serif; }
                  .header { background: #dc2626; color: white; padding: 20px; }
                  .content { padding: 20px; }
                  .risk-high { color: #dc2626; font-weight: bold; }
                  .risk-medium { color: #f59e0b; font-weight: bold; }
                  .info { margin: 10px 0; }
                  .label { font-weight: bold; }
              </style>
          </head>
          <body>
              <div class="header">
                  <h1>BLURA HUB Security Alert</h1>
              </div>
              <div class="content">
                  <h2 style="color: ${riskColor}">${alertData.risk_level.toUpperCase()} RISK DETECTED</h2>
                  
                  <div class="info">
                      <span class="label">Platform:</span> ${alertData.platform.toUpperCase()}
                  </div>
                  
                  <div class="info">
                      <span class="label">Author:</span> ${alertData.author}
                  </div>
                  
                  <div class="info">
                      <span class="label">Content URL:</span> <a href="${alertData.content_url}">${alertData.content_url}</a>
                  </div>
                  
                  <div class="info">
                      <span class="label">Description:</span> ${alertData.description}
                  </div>
                  
                  <div class="info">
                      <span class="label">Triggered Keywords:</span> ${alertData.triggered_keywords.join(', ')}
                  </div>
                  
                  <div class="info">
                      <span class="label">Alert Time:</span> ${alertData.created_at}
                  </div>
                  
                  <p style="margin-top: 30px;">
                      <strong>Action Required:</strong> Please review this alert in the Blura Hub dashboard immediately.
                  </p>
              </div>
          </body>
      </html>
    `;

    const info = await transporter.sendMail({
      from: smtpConfig.username,
      to: toEmails.join(', '),
      subject: `[BLURA HUB] ${alertData.risk_level.toUpperCase()} Risk Alert`,
      html: htmlBody,
    });

    console.log(`Alert email sent to ${toEmails}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send alert email: ${error.message}`);
    return false;
  }
};

module.exports = {
  sendAlertEmail
};
