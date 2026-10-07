'use strict';

/**
 * Deterministic RBI purpose-code rule engine.
 *
 * This module is the authoritative classifier. The LLM is only ever allowed to
 * confirm or correct a rule hit; EDF deadlines are computed here, never by a
 * model. See docs/MEMORY.md (2026-10-06: rule engine is authoritative).
 */

const logger = require('./logger');

// FR-2, FR-4, FR-5, FR-6: the five codes in scope for this prototype.
const PURPOSE_CODES = {
  P0802: {
    code: 'P0802',
    label: 'Software Consultancy',
    family: 'software',
    edf: true,
    deadlineType: '30-days-after-month-end',
    description: 'Contractual software development / consultancy for a foreign client.',
  },
  P0807: {
    code: 'P0807',
    label: 'Off-Site Software Exports',
    family: 'software',
    edf: true,
    deadlineType: '30-days-after-month-end',
    description: 'Sale/licensing of software, SaaS subscription or digital product to an overseas buyer.',
  },
  P1006: {
    code: 'P1006',
    label: 'Business Consultancy',
    family: 'consulting',
    edf: true,
    deadlineType: 'on-or-before-payment-receipt',
    description: 'Advisory, management, legal, accounting or strategy consulting for a foreign client.',
  },
  P1007: {
    code: 'P1007',
    label: 'Advertising, Marketing & Market Research',
    family: 'services',
    edf: true,
    deadlineType: 'on-or-before-payment-receipt',
    description: 'Promotion, advertising, sponsorship and influencer brand collaborations.',
  },
  P1401: {
    code: 'P1401',
    label: 'Compensation of Employees',
    family: 'employment',
    edf: true,
    deadlineType: 'on-or-before-payment-receipt',
    description: 'Salary or wages paid to a resident employee by a foreign entity (remote employment).',
  },
  NON_EXPORT: {
    code: 'NON_EXPORT',
    label: 'Non-Export of Services (platform income)',
    family: 'non-export',
    edf: false,
    deadlineType: null,
    description: 'Income earned on an Indian platform for foreign audience consumption; no export of services, hence no EDF.',
  },
};

// Score order: first family listed with the strongest evidence wins.
// Each entry: [weight, keywords] — keywords are matched on word boundaries.
const RULES = [
  {
    code: 'NON_EXPORT',
    weight: 100,
    keywords: [
      'adsense', 'ad revenue', 'youtube revenue', 'youtube ad', 'youtubepayout',
      'platform revenue', 'platform income', 'app store', 'google play', 'play store',
      'subscription revenue from platform', 'royalty from platform', 'creator fund',
      'monetisation', 'monetization', 'per view', 'cpm', 'ppc earnings',
    ],
  },
  {
    code: 'P1401',
    weight: 95,
    keywords: [
      'salary', 'salaries', 'payroll', 'wages', 'employee', 'employment', 'employed',
      'full time role', 'full-time role', 'contract employment', 'monthly salary',
      'remote job', 'onboarding bonus', 'joining bonus', 'staff salary', 'retainer salary',
    ],
  },
  {
    code: 'P0807',
    weight: 80,
    keywords: [
      'saas', 'software as a service', 'subscription', 'licence', 'license', 'licensing',
      'plugin', 'theme', 'template', 'mobile app', 'app sold', 'api access', 'hosting',
      'saas product', 'software product', 'source code sale', 'white label', 'reseller',
      'per user per month', 'monthly recurring', 'mrr', 'annual plan', 'software export',
      'off-site software', 'offsite software',
    ],
  },
  {
    code: 'P0802',
    weight: 75,
    keywords: [
      'built', 'develop', 'developed', 'development', 'code', 'coding', 'programmed',
      'programming', 'frontend', 'backend', 'full stack', 'full-stack', 'react',
      'angular', 'vue', 'node', 'django', 'flutter', 'website', 'web app', 'dashboard',
      'bug fix', 'bugfix', 'maintenance', 'integration', 'api', 'integration service',
      'custom software', 'outsourced development', 'software consultancy',
      'software development', 'web development', 'app development', 'ui', 'ux',
    ],
  },
  {
    code: 'P1007',
    weight: 70,
    keywords: [
      'influencer', 'influencing', 'brand deal', 'brand collaboration', 'sponsorship',
      'sponsored', 'sponsor', 'sponsors', 'promotion', 'promote', 'marketing',
      'advertising', 'advertisement', 'campaign', 'content creation', 'ugc',
      'social media post', 'instagram post', 'youtube video', 'tiktok', 'reel',
      'brand ambassador', 'affiliate', 'collaboration with', 'endorsement',
      'product review', 'paid partnership',
    ],
  },
  {
    code: 'P1006',
    weight: 65,
    keywords: [
      'consulting', 'consultancy', 'consultant', 'advisory', 'advisor', 'advisement',
      'management consulting', 'strategy', 'strategic', 'market research',
      'business advice', 'financial advice', 'legal advice', 'audit', 'accounting',
      'due diligence', 'feasibility study', 'training', 'workshop', 'coaching',
      'professional services', 'analysis', 'research', 'hr consulting',
    ],
  },
];

const normalize = (text) => ` ${String(text || '').toLowerCase().replace(/[^a-z0-9+#. -]/g, ' ').replace(/\s+/g, ' ')} `;

/**
 * Format from local calendar fields, never from toISOString(). A filing date is
 * a local calendar fact: in a UTC+5:30 zone a local midnight serialises as the
 * previous UTC day and the deadline silently shifts by one.
 */
const formatLocalDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const scoreCode = (description, rule) => {
  const haystack = normalize(description);
  return rule.keywords.reduce(
    (score, keyword) => score + (haystack.includes(keyword) ? rule.weight : 0),
    0,
  );
};

/**
 * Rule-based classification. Returns ranked evidence so the caller can explain
 * the decision in the UI.
 */
const classifyByRules = (description) => {
  const ranked = RULES
    .map((rule) => ({ code: rule.code, score: scoreCode(description, rule) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    return {
      code: 'P1006',
      confidence: 0.3,
      matched: [],
      ambiguous: true,
      reason: 'No rule keywords matched; defaulted to business consultancy. Manual review advised.',
    };
  }

  const [top, second] = ranked;
  const margin = top.score - (second ? second.score : 0);
  const confidence = Math.min(0.95, 0.55 + margin / 100);

  return {
    code: top.code,
    confidence: Number(confidence.toFixed(2)),
    matched: RULES.find((rule) => rule.code === top.code).keywords.slice(0, 5),
    ambiguous: margin < 15,
    reason: margin < 15
      ? `Close call between ${top.code} and ${second.code}; LLM second opinion used.`
      : `Rule keywords strongly indicate ${PURPOSE_CODES[top.code].label}.`,
  };
};

/**
 * FR-8 / FR-9: EDF deadline computation.
 * Software exports: within 30 days from the end of the month of receipt.
 * Everything else: on or before the date of receipt of payment.
 */
const computeEdfDeadline = (purposeCode, receivedAt) => {
  const code = PURPOSE_CODES[purposeCode];
  if (!code || !code.edf) return { required: false, type: null, date: null };

  const base = receivedAt ? new Date(receivedAt) : new Date();

  if (code.deadlineType === '30-days-after-month-end') {
    const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    monthEnd.setDate(monthEnd.getDate() + 30);
    return {
      required: true,
      type: code.deadlineType,
      date: formatLocalDate(monthEnd),
      rule: 'Software export: eForm B2 / RBD within 30 days from end of month of receipt (FR-8).',
    };
  }

  return {
    required: true,
    type: code.deadlineType,
    date: formatLocalDate(base),
    rule: 'Non-software service: eForm B2 within 15 days of receipt, and not later than the annual due date (FR-9).',
  };
};

const isKnownCode = (code) => Object.prototype.hasOwnProperty.call(PURPOSE_CODES, String(code || '').toUpperCase());

const getCode = (code) => PURPOSE_CODES[String(code || '').toUpperCase()] || null;

const listCodes = () => Object.values(PURPOSE_CODES);

const logRuleHit = (code, confidence, ambiguous) => {
  logger.info(`rules -> ${code} (confidence=${confidence}${ambiguous ? ', ambiguous' : ''})`);
};

module.exports = {
  PURPOSE_CODES,
  classifyByRules,
  computeEdfDeadline,
  formatLocalDate,
  isKnownCode,
  getCode,
  listCodes,
  logRuleHit,
};
