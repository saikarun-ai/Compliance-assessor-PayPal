'use strict';

/**
 * Flat-file storage for compliance records and trend reports (SRS-7).
 * Writes are serialised through a promise chain so concurrent requests cannot
 * clobber data/records.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const logger = require('./logger');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const MAX_RECORDS = 500;

const emptyDb = () => ({ compliance_records: [], trend_reports: [], issued_invoices: [] });

let writeChain = Promise.resolve();

const ensureDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const read = () => {
  try {
    ensureDir();
    if (!fs.existsSync(DATA_FILE)) return emptyDb();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { ...emptyDb(), ...parsed };
  } catch (err) {
    logger.warn(`store read failed (${err.message}); starting from an empty db`);
    return emptyDb();
  }
};

const write = (db) => {
  ensureDir();
  const trimmed = {
    compliance_records: db.compliance_records.slice(-MAX_RECORDS),
    trend_reports: db.trend_reports.slice(-MAX_RECORDS),
    issued_invoices: db.issued_invoices.slice(-MAX_RECORDS),
  };
  // Write-then-rename: a crash mid-write would otherwise leave a truncated
  // records.json, losing every classification taken so far.
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  return trimmed;
};

const update = (mutator) => {
  writeChain = writeChain.then(() => mutator(read())).catch((err) => {
    logger.error(`store update failed: ${err.message}`);
    throw err;
  });
  return writeChain;
};

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

const addComplianceRecord = (record) => update((db) => {
  db.compliance_records.push(record);
  return write(db);
});

const attachInvoice = (recordId, invoiceId, invoiceNumber, approvalUrl) => update((db) => {
  const record = db.compliance_records.find((item) => item.id === recordId);
  if (record) {
    record.paypal_invoice_id = invoiceId;
    record.invoice_number = invoiceNumber;
    record.approval_url = approvalUrl;
  }
  return write(db);
});

/**
 * Every invoice actually issued, tracked independently of whether it was
 * linked to a classification. FR-12 numbers invoices per purpose code per year,
 * and PayPal rejects a duplicate invoice_number, so the counter must not depend
 * on the caller passing a recordId.
 */
const recordInvoice = ({ invoiceNumber, invoiceId, purposeCode, amount, currency }) => update((db) => {
  db.issued_invoices.push({
    invoice_number: invoiceNumber,
    paypal_invoice_id: invoiceId,
    purpose_code: purposeCode,
    amount,
    currency,
    created_at: new Date().toISOString(),
  });
  return write(db);
});

const addTrendReport = (report) => update((db) => {
  db.trend_reports.push(report);
  return write(db);
});

const listComplianceRecords = (limit = 25) => read().compliance_records.slice(-limit).reverse();
const listTrendReports = (limit = 10) => read().trend_reports.slice(-limit).reverse();

/** 24h cache so a re-run during judging does not re-hit the network (TASKS.md). */
const findCachedReport = (niche, maxAgeHours) => {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  return read().trend_reports.find(
    (report) => report.niche.toLowerCase() === niche.toLowerCase() && Date.parse(report.created_at) > cutoff,
  ) || null;
};

module.exports = {
  DATA_FILE,
  newId,
  addComplianceRecord,
  attachInvoice,
  recordInvoice,
  addTrendReport,
  listComplianceRecords,
  listTrendReports,
  findCachedReport,
  read,
};
