'use strict';

const express = require('express');

const paypal = require('../lib/paypal');
const rules = require('../lib/rules');
const store = require('../lib/store');
const logger = require('../lib/logger');

const router = express.Router();

// FR-10..FR-14: draft invoice with the purpose code encoded in invoice_number.
router.post('/', async (req, res) => {
  try {
    const purposeCode = String(req.body.purposeCode || req.body.purpose_code || '').toUpperCase();
    const codeInfo = rules.getCode(purposeCode);
    if (!codeInfo) throw new Error('a valid purposeCode is required (P0802, P0807, P1006, P1007, P1401, NON_EXPORT)');
    if (codeInfo.code === 'NON_EXPORT') throw new Error('platform income is not an export of services — no cross-border invoice is needed');

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be a positive number');

    const invoice = await paypal.createInvoice({
      purposeCode: codeInfo.code,
      purposeLabel: codeInfo.label,
      purposeDescription: codeInfo.description,
      amount,
      currency: req.body.currency,
      description: req.body.description,
      memo: req.body.memo,
    });

    if (req.body.recordId) {
      store.attachInvoice(req.body.recordId, invoice.id, invoice.invoice_number, invoice.approval_url)
        .catch((err) => logger.warn(`invoice link write failed: ${err.message}`));
    }

    res.json({ success: true, data: invoice });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] invoice failed: ${err.message}`);
    res.status(err.message.includes('credentials missing') ? 503 : 400).json({ success: false, error: err.message });
  }
});

// Dry run: shows the exact payload that would be sent, no credentials needed.
router.post('/preview', (req, res) => {
  try {
    const purposeCode = String(req.body.purposeCode || '').toUpperCase();
    const codeInfo = rules.getCode(purposeCode);
    if (!codeInfo) throw new Error('a valid purposeCode is required');
    const amount = Number(req.body.amount) || 0;
    res.json({
      success: true,
      data: {
        invoice_number: paypal.buildInvoiceNumber(codeInfo.code, 1),
        detail: {
          invoice_number: paypal.buildInvoiceNumber(codeInfo.code, 1),
          currency_code: req.body.currency || 'USD',
          note: `RBI Purpose Code ${codeInfo.code} - ${codeInfo.label}`,
          memo: `Purpose Code: ${codeInfo.code}. ${codeInfo.description}`,
          items: [{
            name: `${codeInfo.code} - ${codeInfo.label}`,
            quantity: '1',
            unit_amount: { currency_code: req.body.currency || 'USD', value: amount.toFixed(2) },
            description: `RBI purpose code ${codeInfo.code}.`.slice(0, 127),
          }],
        },
        status: 'DRAFT (preview only — nothing sent to PayPal)',
        configured: paypal.isConfigured(),
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/status', (req, res) => {
  res.json({ success: true, data: paypal.status() });
});

module.exports = router;
