const nodemailer = require('nodemailer');

function makeTransport() {
  if (process.env.EMAIL_MODE === 'console' || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

async function sendMail({ to, subject, text, html }) {
  const transport = makeTransport();
  if (!transport) {
    console.log(`[EMAIL:${to}] ${subject}\n${text}`);
    return { delivered: false, mode: 'console' };
  }
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text, html });
  return { delivered: true, mode: 'smtp' };
}

module.exports = { sendMail };
