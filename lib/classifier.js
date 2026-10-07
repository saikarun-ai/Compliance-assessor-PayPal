'use strict';

/**
 * Compliance classifier: rule engine (authoritative) + llama.cpp second opinion.
 *
 * Reconciliation policy (docs/MEMORY.md):
 *   - NON_EXPORT is never downgraded by the model: if rules say the income is
 *     platform income, there is no export of services and therefore no EDF.
 *   - An LLM code outside the table is discarded.
 *   - EDF dates always come from lib/rules.js.
 */

const llama = require('./llama');
const rules = require('./rules');
const logger = require('./logger');
const store = require('./store');

const CODE_LIST_HINT = rules.listCodes()
  .map((entry) => `${entry.code} = ${entry.label}`)
  .join('; ');

const SYSTEM_PROMPT = `You are an Indian export compliance assistant.
Classify the transaction into exactly one RBI purpose code.
Allowed codes: ${CODE_LIST_HINT}.
Rules: salary/employment = P1401. Income earned on YouTube/AdSense/app stores for
a foreign audience is NOT an export of services: return NON_EXPORT.
Software work for a client = P0802. Sold/licensed software or SaaS subscription
= P0807. Business consulting/advice = P1006. Sponsorship, advertising, influencer
brand deals and content promotion = P1007.
Reply with one JSON object only: {"purpose_code":"P0802","reason":"max 20 words","confidence":0.9}`;

const USER_TYPES = ['freelancer', 'startup', 'influencer'];

const parseUserType = (value) => {
  const normalized = String(value || 'freelancer').trim().toLowerCase();
  return USER_TYPES.includes(normalized) ? normalized : 'freelancer';
};

const validateDescription = (description) => {
  const text = String(description || '').trim();
  if (!text) throw new Error('description is required');
  if (text.length > 2000) throw new Error('description must be under 2000 characters');
  return text;
};

const askModel = async (description, ruleVerdict) => {
  try {
    const { data, endpoint } = await llama.chatJson(
      SYSTEM_PROMPT,
      `Description: ${description}\nRule engine hint: ${ruleVerdict.code} (${rules.getCode(ruleVerdict.code).label})`,
    );
    const code = String(data.purpose_code || data.code || '').trim().toUpperCase();
    return {
      used: true,
      endpoint,
      code: rules.isKnownCode(code) ? code : null,
      rawCode: code || null,
      reason: String(data.reason || '').slice(0, 300),
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
    };
  } catch (err) {
    logger.warn(`llm second opinion unavailable: ${err.message}`);
    return { used: false, code: null, reason: null, confidence: null };
  }
};

const reconcile = (ruleVerdict, modelVerdict) => {
  const ruleCode = ruleVerdict.code;

  // Non-export is a regulatory fact, not a preference. Never let a model
  // downgrade it and force an EDF filing on a creator.
  if (ruleCode === 'NON_EXPORT') {
    return {
      code: 'NON_EXPORT',
      source: 'rules',
      agreement: !modelVerdict.used || modelVerdict.code === 'NON_EXPORT',
      note: 'Platform income detected: no export of services, so no EDF filing.',
    };
  }

  if (modelVerdict.used && modelVerdict.code && modelVerdict.code !== ruleCode) {
    if (ruleVerdict.ambiguous) {
      return {
        code: modelVerdict.code,
        source: 'llm',
        agreement: false,
        note: `Rules were ambiguous (${ruleCode} vs ${modelVerdict.code}); LLM tie-break applied.`,
      };
    }
    if (rules.getCode(ruleCode).family === 'software' && rules.getCode(modelVerdict.code).family === 'software') {
      return {
        code: ruleCode,
        source: 'rules',
        agreement: false,
        note: 'Both codes are software exports; kept the higher-scoring rule hit.',
      };
    }
    return {
      code: ruleCode,
      source: 'rules',
      agreement: false,
      note: `LLM suggested ${modelVerdict.code}; rejected because rules scored ${ruleCode} decisively.`,
    };
  }

  const confirmed = modelVerdict.used && modelVerdict.code === ruleCode;
  return {
    code: ruleCode,
    source: confirmed ? 'rules+llm' : 'rules',
    agreement: modelVerdict.used ? modelVerdict.code === ruleCode : null,
    note: modelVerdict.used ? 'LLM confirmed the rule classification.' : 'LLM unavailable; rules-only mode.',
  };
};

const buildExplanation = (description, verdict, ruleVerdict, modelVerdict, codeInfo) => {
  const parts = [codeInfo.label];
  if (ruleVerdict.matched.length) parts.push(`matched: ${ruleVerdict.matched.join(', ')}`);
  if (modelVerdict.reason) parts.push(`model: ${modelVerdict.reason}`);
  return parts.join(' | ');
};

const classify = async ({ description, userType, receivedAt, persist = true }) => {
  const cleanDescription = validateDescription(description);
  const type = parseUserType(userType);
  const ruleVerdict = rules.classifyByRules(cleanDescription);
  rules.logRuleHit(ruleVerdict.code, ruleVerdict.confidence, ruleVerdict.ambiguous);

  const modelVerdict = await askModel(cleanDescription, ruleVerdict);
  const verdict = reconcile(ruleVerdict, modelVerdict);
  const codeInfo = rules.getCode(verdict.code);
  const edf = rules.computeEdfDeadline(verdict.code, receivedAt);

  const result = {
    id: store.newId('cmp'),
    user_type: type,
    description: cleanDescription,
    purpose_code: verdict.code,
    purpose_label: codeInfo.label,
    purpose_description: codeInfo.description,
    category: codeInfo.family,
    is_export_of_services: codeInfo.code !== 'NON_EXPORT',
    edf_required: edf.required,
    edf_deadline_type: edf.type,
    edf_deadline: edf.date,
    edf_rule: edf.rule || 'No eForm B2 / RBD filing required for this category.',
    confidence: ruleVerdict.confidence,
    ambiguous: ruleVerdict.ambiguous,
    decided_by: verdict.source,
    agreement: verdict.agreement,
    rationale: buildExplanation(cleanDescription, verdict, ruleVerdict, modelVerdict, codeInfo),
    llm: {
      used: modelVerdict.used,
      suggested_code: modelVerdict.code,
      raw_code: modelVerdict.rawCode,
      note: verdict.note,
    },
    paypal_invoice_id: null,
    created_at: new Date().toISOString(),
  };

  if (persist) store.addComplianceRecord(result);
  return result;
};

module.exports = { classify, parseUserType, USER_TYPES };
