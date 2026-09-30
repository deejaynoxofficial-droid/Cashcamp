# Cash Camp v2

Cash Camp v2 is a Node.js + Express + PostgreSQL MVP for task rewards, referrals, verified activation payments, wallet accounting and withdrawals.

## What changed from v1

- Email verification with single-use hashed tokens.
- Password reset with expiring single-use hashed tokens and generic responses.
- Per-feature rate limits for login, registration, reset, verification, tasks, payments and withdrawals.
- Server-side task sessions; rewards cannot be claimed before the required duration has elapsed.
- Wallet ledger with transaction references and atomic balance updates.
- Withdrawal state machine: `pending -> paid` or `pending -> refunded`.
- Payment-provider adapter with a generic HTTP provider and signed webhook endpoint.
- Manual deposit proof remains available as a reconciliation fallback.
- Deposit transaction references are unique and cannot be replayed.
- Referral bonus only becomes eligible after activation and basic anti-abuse checks.
- Audit logs and fraud events with IP/user-agent hash and metadata.
- Risk scoring for suspicious activity.
- Render deployment configuration and environment-variable placeholders.

## Important production note

The included `PAYMENT_PROVIDER=http` adapter is deliberately provider-neutral. It expects your selected licensed/authorized payment provider to expose an API that accepts the request fields used in `src/payments.js` and sends signed webhooks matching the documented payload contract in that file. **Do not put real provider credentials into source control.** Configure secrets in Render environment variables. Render recommends environment variables/secrets for credentials. See Render's environment-variable documentation.

The default `PAYMENT_PROVIDER=manual` mode does not claim an image proves payment. Manual proof is only a reconciliation workflow; an administrator must independently verify the transaction.

Before accepting public funds, have the exact business/payment/earning model reviewed for applicable Ugandan payment, AML/KYC, consumer-protection, tax and data-protection obligations.

## Local setup

1. Install Node.js 20+ and PostgreSQL.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` and a long random `JWT_SECRET`.
4. In development you can leave `EMAIL_MODE=console`; verification/reset links are printed to the server console.
5. Run:

```bash
npm install
npm run db:init
npm start
```

Open `http://localhost:10000`.

## Email in production

Set:

```text
EMAIL_MODE=smtp
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=Cash Camp <no-reply@your-domain.example>
APP_URL=https://your-cash-camp-domain.example
```

Password reset requests intentionally return the same message whether an email exists or not, reducing account enumeration risk.

## Payment provider

### Manual mode

```text
PAYMENT_PROVIDER=manual
```

Users can submit a transaction reference and screenshot. Admins independently verify the payment before activation.

### Generic HTTP provider mode

```text
PAYMENT_PROVIDER=http
PAYMENT_API_URL=https://provider.example/api/payments
PAYMENT_API_KEY=...
PAYMENT_WEBHOOK_SECRET=...
PAYMENT_CALLBACK_URL=https://your-domain.example/api/payments/webhook
```

`src/payments.js` sends a JSON request containing:

```json
{
  "reference": "CC-...",
  "amount": 11000,
  "currency": "UGX",
  "phone": "+256...",
  "callback_url": "https://.../api/payments/webhook"
}
```

The provider response may include `checkout_url`/`checkoutUrl`.

Webhook endpoint:

```text
POST /api/payments/webhook
X-CashCamp-Signature: <HMAC-SHA256-of-raw-body>
```

Expected useful webhook fields are:

```json
{
  "event_id": "unique-provider-event-id",
  "event_type": "payment.updated",
  "reference": "CC-...",
  "provider_ref": "provider-transaction-id",
  "amount": 11000,
  "status": "successful"
}
```

The webhook rejects invalid signatures, rejects amount mismatches, deduplicates event IDs, and activates the account only after a successful provider event.

**You must adapt `src/payments.js` to the exact API and webhook contract of your chosen provider before enabling real public payments.**

## Render

Render can connect a web service to Render Postgres using `render.yaml`. Set all `sync: false` values in the Render dashboard. Keep secrets out of Git.

For a production deployment:

1. Push the ZIP contents to a private Git repository.
2. Create the Render Blueprint from the repository.
3. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_URL`, SMTP variables and payment-provider secrets.
4. Keep `PAYMENT_PROVIDER=manual` until the real provider adapter has been tested in sandbox/test mode.
5. Run payment tests with small/sandbox transactions before accepting public money.
6. Review database backups, monitoring, domain HTTPS and operational access controls.

## Security checklist before public launch

- [ ] Use a real licensed/authorized payment provider and exact API adapter.
- [ ] Test signed webhook verification and replay protection.
- [ ] Configure SMTP and verify email delivery.
- [ ] Use a production domain and HTTPS.
- [ ] Set a strong admin password and protect admin access.
- [ ] Review KYC/AML/payment/consumer/data-protection requirements.
- [ ] Add a shared rate-limit store such as Redis before running multiple app instances.
- [ ] Add provider-side payout verification if automated withdrawals are enabled.
- [ ] Monitor audit logs and fraud events.
- [ ] Test deposit, duplicate payment, refund, withdrawal rejection and webhook replay cases.
- [ ] Back up PostgreSQL and test restoration.

## Main API areas

- `/api/auth/register`
- `/api/auth/login`
- `/api/auth/verify-email`
- `/api/auth/forgot-password`
- `/api/auth/reset-password`
- `/api/payments/start`
- `/api/payments/webhook`
- `/api/deposits`
- `/api/tasks/:id/start`
- `/api/tasks/:id/complete`
- `/api/withdrawals`
- `/api/referrals`
- `/api/transactions`
- `/api/admin/*`

## Files added/changed in v2

- `package.json`
- `.env.example`
- `render.yaml`
- `README.md`
- `sql/schema.sql`
- `src/server.js`
- `src/payments.js` (new)
- `src/mailer.js` (new)
- `src/rate-limit.js` (new)
- `src/migrate.js` (new)
- `src/init-db.js`
- `public/app.js`

