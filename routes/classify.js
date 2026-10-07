'use strict';

const express = require('express');

const classifier = require('../lib/classifier');
const rules = require('../lib/rules');
const store = require('../lib/store');

const router = express.Router();

// FR-1..FR-9: natural language in, purpose code + EDF out.
router.post('/', async (req, res) => {
  try {
    const result = await classifier.classify({
      description: req.body.description,
      userType: req.body.userType || req.body.user_type,
      receivedAt: req.body.receivedAt || req.body.received_at,
      persist: req.body.persist !== false,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] classify failed: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Purpose code reference table for the UI dropdown.
router.get('/codes', (req, res) => {
  res.json({ success: true, data: rules.listCodes() });
});

router.get('/records', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 200);
  res.json({ success: true, data: store.listComplianceRecords(limit) });
});

module.exports = router;
