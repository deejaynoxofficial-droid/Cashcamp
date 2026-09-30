const crypto = require('crypto');

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function timingSafeEqualHex(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

class ManualPaymentProvider {
  async createPayment({ reference, amount, currency, phone }) {
    return { mode: 'manual', reference, amount, currency, phone, status: 'pending' };
  }

  verifyWebhook() {
    throw new Error('Manual payment mode does not accept provider webhooks');
  }
}

class HttpPaymentProvider {
  constructor() {
    this.url = process.env.PAYMENT_API_URL;
    this.apiKey = process.env.PAYMENT_API_KEY;
    this.secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!this.url || !this.apiKey) throw new Error('PAYMENT_API_URL and PAYMENT_API_KEY are required for PAYMENT_PROVIDER=http');
  }

  async createPayment({ reference, amount, currency, phone }) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        reference,
        amount,
        currency,
        phone,
        callback_url: process.env.PAYMENT_CALLBACK_URL
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(data.error || data.message || `Payment provider HTTP ${response.status}`);
    return data;
  }

  verifyWebhook(rawBody, signature) {
    const expected = hmac(rawBody, this.secret);
    return timingSafeEqualHex(expected, signature);
  }
}

function getPaymentProvider() {
  return process.env.PAYMENT_PROVIDER === 'http' ? new HttpPaymentProvider() : new ManualPaymentProvider();
}

module.exports = { getPaymentProvider, hmac, timingSafeEqualHex };
