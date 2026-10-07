'use strict';

/**
 * SRS-10 verification: 6 classification cases.
 * Runs the classifier in-process (no HTTP) so it can be executed before the
 * server or llama.cpp is up.
 */

const classifier = require('../lib/classifier');

const CASES = [
  {
    name: 'Software dev for US client',
    description: 'I built a React dashboard for a US client for $2000',
    expect: 'P0802',
    userType: 'freelancer',
  },
  {
    name: 'SaaS revenue from EU',
    description: 'Monthly SaaS subscription revenue from an EU customer, 40 subscribers on the annual plan',
    expect: 'P0807',
    userType: 'startup',
  },
  {
    name: 'Brand sponsorship UK',
    description: 'Paid brand sponsorship by a UK skincare brand for 2 Instagram reels',
    expect: 'P1007',
    userType: 'influencer',
  },
  {
    name: 'Business consulting Dubai',
    description: 'Management consulting engagement for a Dubai client, strategy and advisory work',
    expect: 'P1006',
    userType: 'freelancer',
  },
  {
    name: 'YouTube ad revenue',
    description: 'YouTube AdSense payout for my channel',
    expect: 'NON_EXPORT',
    userType: 'influencer',
  },
  {
    name: 'Remote salary US',
    description: 'Monthly salary from my remote job with a US company',
    expect: 'P1401',
    userType: 'freelancer',
  },
];

const run = async () => {
  const results = [];
  for (const testCase of CASES) {
    const result = await classifier.classify({
      description: testCase.description,
      userType: testCase.userType,
      receivedAt: '2026-10-15T00:00:00.000Z',
      persist: false,
    });
    const pass = result.purpose_code === testCase.expect;
    results.push({ ...testCase, actual: result.purpose_code, pass, edf: result.edf_required, deadline: result.edf_deadline, decided: result.decided_by });
  }

  console.log('\nSRS-10 classification verification\n');
  results.forEach((result) => {
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}`);
    console.log(`      expected ${result.expect} / got ${result.actual} · edf=${result.edf} deadline=${result.deadline || 'n/a'} (${result.decided})`);
  });

  const passed = results.filter((result) => result.pass).length;
  const accuracy = ((passed / results.length) * 100).toFixed(0);
  console.log(`\n${passed}/${results.length} correct — ${accuracy}% (PRD target >= 90%)\n`);
  process.exitCode = passed === results.length ? 0 : 1;
};

run().catch((err) => {
  console.error(`verification crashed: ${err.message}`);
  process.exitCode = 1;
});
