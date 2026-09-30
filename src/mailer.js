const nodemailer = require('nodemailer');

function makeTransport() {
  const mode = String(process.env.EMAIL_MODE || 'smtp').toLowerCase();

  if (mode === 'console' || !process.env.SMTP_HOST) {
    return null;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined,

    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });

  return transport;
}

async function verifyMailConfig() {
  const transport = makeTransport();

  if (!transport) {
    console.log('[MAILER] Email mode: console');
    return false;
  }

  try {
    await transport.verify();
    console.log('[MAILER] SMTP connection verified successfully');
    return true;
  } catch (error) {
    console.error('[MAILER] SMTP verification failed:', {
      message: error.message,
      code: error.code,
      response: error.response
    });
    return false;
  }
}

async function sendMail({ to, subject, text, html }) {
  if (!to) {
    throw new Error('Recipient email is required');
  }

  if (!process.env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM is not configured');
  }

  const transport = makeTransport();

  if (!transport) {
    console.log(`[EMAIL:${to}] ${subject}\n${text}`);

    return {
      delivered: false,
      mode: 'console'
    };
  }

  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html
    });

    console.log('[MAILER] Email sent:', {
      to,
      messageId: info.messageId,
      response: info.response
    });

    return {
      delivered: true,
      mode: 'smtp',
      messageId: info.messageId
    };
  } catch (error) {
    console.error('[MAILER] Email sending failed:', {
      to,
      subject,
      message: error.message,
      code: error.code,
      response: error.response,
      responseCode: error.responseCode
    });

    throw new Error(`Email sending failed: ${error.message}`);
  }
}

module.exports = {
  sendMail,
  verifyMailConfig
};
