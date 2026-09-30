const rateLimit = require('express-rate-limit');
const windowMs = Number(process.env.RATE_WINDOW_MS || 15 * 60 * 1000);
const make = (envKey, fallback) => rateLimit({
  windowMs,
  limit: Number(process.env[envKey] || fallback),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
module.exports = {
  global: make('RATE_GLOBAL', 300),
  login: make('RATE_LOGIN', 10),
  register: make('RATE_REGISTER', 5),
  reset: make('RATE_RESET', 5),
  verify: make('RATE_VERIFY', 10),
  task: make('RATE_TASK', 60),
  withdraw: make('RATE_WITHDRAW', 10),
  payment: make('RATE_PAYMENT', 10)
};
