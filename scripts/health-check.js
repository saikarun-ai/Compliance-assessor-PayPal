'use strict';

/** NFR-1 style readiness probe: llama.cpp, PayPal and Agent Reach. */

const llama = require('../lib/llama');
const paypal = require('../lib/paypal');
const agentReach = require('../lib/agentReach');

const main = async () => {
  const llm = await llama.status();
  const reach = await agentReach.doctor();
  const pp = paypal.status();

  console.log('\ncompliance-assessor readiness\n');
  console.log(`llama.cpp    ${llm.available ? 'UP  ' : 'DOWN'}  ${llm.url}  ${llm.model}`);
  console.log(`paypal       ${pp.configured ? 'READY' : 'NO CREDENTIALS'}  ${pp.base_url}`);
  reach.channels.forEach((channel) => {
    console.log(`agent-reach  ${channel.ok ? 'OK   ' : 'MISS '}  ${channel.channel} (${channel.detail})`);
  });
  console.log(`\nmode: ${llm.available ? 'llm+rules' : 'rules-only'}\n`);
};

main().catch((err) => {
  console.error(`health check failed: ${err.message}`);
  process.exitCode = 1;
});
