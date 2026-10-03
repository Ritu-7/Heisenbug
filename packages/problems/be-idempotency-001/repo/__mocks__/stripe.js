'use strict';

/**
 * Manual mock for 'stripe' — single shared paymentIntents.create jest.fn()
 * so every test file that does jest.mock('stripe') shares one mockable function.
 *
 * Usage in tests:
 *   const stripe = require('stripe');
 *   stripe.__create.mockRejectedValueOnce(new Error('Stripe error'));
 *   expect(stripe.__create).toHaveBeenCalledTimes(1);
 */

const createPaymentIntent = jest.fn(async ({ amount, currency = 'usd', customer, metadata } = {}) => ({
  id:            `pi_mock_${Math.random().toString(36).slice(2, 10)}`,
  client_secret: `pi_mock_secret_${Math.random().toString(36).slice(2, 10)}`,
  amount,
  currency,
  customer,
  metadata,
  status: 'requires_payment_method',
}));

const mockInstance = { paymentIntents: { create: createPaymentIntent } };

// stripeFactory() always returns the SAME instance so all call tracking is shared
const stripeFactory = jest.fn(() => mockInstance);

// Expose for direct test control
stripeFactory.__instance = mockInstance;
stripeFactory.__create   = createPaymentIntent;

module.exports = stripeFactory;
