'use strict';

const express = require('express');

const trends = require('../lib/trends');
const store = require('../lib/store');

const router = express.Router();

// FR-19..FR-26: Agent Reach trend report.
router.post('/', async (req, res) => {
  try {
    const report = await trends.generateReport(req.body.niche, {
      useCache: req.body.useCache !== false,
      persist: req.body.persist !== false,
    });
    res.json({ success: true, data: report });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] trends failed: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/reports', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  res.json({ success: true, data: store.listTrendReports(limit) });
});

router.get('/doctor', async (req, res) => {
  try {
    const agentReach = require('../lib/agentReach');
    res.json({ success: true, data: await agentReach.doctor() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
