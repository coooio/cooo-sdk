// examples/mcp-server.mjs — zero-dependency MCP server over stdio for @cooo/sdk.
// Wire format: one JSON-RPC 2.0 message per line (UTF-8, newline-delimited).
// stdout carries protocol lines only; every diagnostic goes to stderr.
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { CoooSdk } from '../dist/index.js';

function timeoutFromEnv() {
  const raw = process.env.COOO_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 30000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

const ENV = {
  rpcUrl: process.env.COOO_RPC_URL || 'http://127.0.0.1:8080/lyquid/api',
  infoUrl: process.env.COOO_INFO_URL || 'http://127.0.0.1:8080/lyquid/info',
  stateUrl: process.env.COOO_STATE_URL || 'http://127.0.0.1:8080/api/state',
  timeoutMs: timeoutFromEnv(),
  caller: process.env.COOO_CALLER || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  lyquidId: process.env.COOO_LYQUID_ID || '',
  contract: process.env.COOO_CONTRACT || '',
};

const log = (...parts) => process.stderr.write(parts.join(' ') + '\n');

let sdkInstance = null;
function getSdk() {
  if (!sdkInstance) {
    const options = {
      rpcUrl: ENV.rpcUrl,
      infoUrl: ENV.infoUrl,
      stateUrl: ENV.stateUrl,
      timeoutMs: ENV.timeoutMs,
    };
    if (ENV.lyquidId) options.expectedLyquidId = ENV.lyquidId;
    if (ENV.contract) options.expectedContract = ENV.contract;
    sdkInstance = new CoooSdk(options);
  }
  return sdkInstance;
}

// Lazy facade: misconfiguration only fails the calls that actually touch the SDK.
const sdk = new Proxy({}, {
  get(_target, prop) {
    if (typeof prop !== 'string' || prop === 'then') return undefined;
    return (...args) => getSdk()[prop](...args);
  },
});

// ---------------------------------------------------------------- helpers

function toUint256(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error('uint256 must be decimal digits');
}

let opSeq = 0;
function nextOperationId(toolName) {
  opSeq += 1;
  return `cooo-${toolName.replace(/^cooo_/, '')}-${Date.now().toString(36)}-${opSeq}`;
}

// Shared wrapper for every state-changing tool: resolves `from` and `operationId`.
function write(toolName, fn) {
  return async (args, client, env) => {
    const given = args.operationId;
    const operationId = typeof given === 'string' && given.length > 0 ? given : nextOperationId(toolName);
    return fn(client, args, env.caller, operationId);
  };
}

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const eq = (a, b) => String(a) === String(b);

const P = {
  operationId: { type: 'string', description: 'Optional idempotency key; generated when omitted.' },
  taskId: { type: 'string', description: 'Task id string.' },
  parentId: { type: 'string', description: 'Parent task id string.' },
  childId: { type: 'string', description: 'Child task id string.' },
  provider: { type: 'string', description: 'Provider address (0x-hex).' },
  producer: { type: 'string', description: 'Producer address (0x-hex).' },
  verifier: { type: 'string', description: 'Verifier address (0x-hex).' },
  amount: { type: 'string', description: 'uint256 as decimal digits.' },
  cancellationFee: { type: 'string', description: 'uint256 as decimal digits.' },
  reward: { type: 'string', description: 'uint256 as decimal digits.' },
  reviewThreshold: { type: ['string', 'number'], description: 'uint256 review threshold.' },
  termsVersion: { type: ['string', 'number'], description: 'uint256 terms version.' },
  termsDigest: { type: 'string', description: 'Terms digest (0x-hex).' },
  expectedDigest: { type: 'string', description: 'Expected work digest (0x-hex).' },
  evidenceDigest: { type: 'string', description: 'Verifier evidence digest (0x-hex).' },
  digest: { type: 'string', description: 'Delivery digest (0x-hex).' },
  approved: { type: 'boolean', description: 'Verifier verdict.' },
  scopes: { type: 'array', items: { type: 'string' }, description: 'Authority scopes.' },
  text: { type: 'string', description: 'UTF-8 text to hash.' },
};

function buildPredicate(match) {
  return (state) => {
    const tasks = Array.isArray(state && state.tasks) ? state.tasks : [];
    if (match.taskId !== undefined) {
      const task = tasks.find((t) => t && t.id === match.taskId);
      if (!task) return false;
      if (match.executionState !== undefined && !eq(task.executionState, match.executionState)) return false;
      if (match.paymentState !== undefined && !eq(task.paymentState, match.paymentState)) return false;
    } else if (match.executionState !== undefined || match.paymentState !== undefined) {
      const found = tasks.some((t) => t
        && (match.executionState === undefined || eq(t.executionState, match.executionState))
        && (match.paymentState === undefined || eq(t.paymentState, match.paymentState)));
      if (!found) return false;
    }
    if (match.ledgerField !== undefined) {
      const ledger = (state && state.ledger) || {};
      if (!eq(ledger[match.ledgerField], match.equals)) return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------- tools

const TOOLS = [
  {
    name: 'cooo_discover',
    description: 'Read the Lyquid discovery document listing endpoints and chain identifiers.',
    inputSchema: obj({}),
    run: (_args, client) => client.discover(),
  },
  {
    name: 'cooo_get_state',
    description: 'Read the current ledger and task state snapshot.',
    inputSchema: obj({}),
    run: (_args, client) => client.getState(),
  },
  {
    name: 'cooo_wait_for_state',
    description: 'Poll state until the given match predicate holds, then return that state.',
    inputSchema: obj({
      match: {
        type: 'object',
        description: 'Predicate over tasks and/or ledger fields.',
        properties: {
          taskId: { type: 'string' },
          executionState: { type: 'number' },
          paymentState: { type: 'number' },
          ledgerField: { type: 'string' },
          equals: { type: 'string' },
        },
      },
      timeoutMs: { type: 'number', description: 'Maximum wait in milliseconds (default 30000).' },
    }, ['match']),
    run: async (args, client) => {
      const match = args.match && typeof args.match === 'object' ? args.match : {};
      const keys = ['taskId', 'executionState', 'paymentState', 'ledgerField', 'equals'];
      if (!keys.some((k) => match[k] !== undefined)) {
        throw new Error('match must set at least one of taskId, executionState, paymentState, ledgerField, equals');
      }
      if ((match.ledgerField === undefined) !== (match.equals === undefined)) {
        throw new Error('ledgerField and equals must be provided together');
      }
      const timeoutMs = args.timeoutMs === undefined ? 30000 : Number(args.timeoutMs);
      return client.waitForState(buildPredicate(match), timeoutMs);
    },
  },
  {
    name: 'cooo_list_tasks',
    description: 'List every task in the current state snapshot.',
    inputSchema: obj({}),
    run: async (_args, client) => {
      const state = await client.getState();
      return Array.isArray(state && state.tasks) ? state.tasks : [];
    },
  },
  {
    name: 'cooo_task_detail',
    description: 'Return the state record for one task id.',
    inputSchema: obj({ taskId: P.taskId }, ['taskId']),
    run: async (args, client) => {
      const state = await client.getState();
      const tasks = Array.isArray(state && state.tasks) ? state.tasks : [];
      const task = tasks.find((t) => t && t.id === args.taskId);
      if (!task) throw new Error('no such task');
      return task;
    },
  },
  {
    name: 'cooo_deposit',
    description: 'Deposit tokens from the caller into the Lyquid ledger.',
    inputSchema: obj({ amount: P.amount, operationId: P.operationId }, ['amount']),
    run: write('cooo_deposit', (client, a, from, op) => client.deposit(from, op, toUint256(a.amount))),
  },
  {
    name: 'cooo_grant_authority',
    description: 'Grant a provider the listed authority scopes.',
    inputSchema: obj({ provider: P.provider, scopes: P.scopes, operationId: P.operationId }, ['provider', 'scopes']),
    run: write('cooo_grant_authority', (client, a, from, op) => {
      if (!Array.isArray(a.scopes)) throw new Error('scopes must be an array of strings');
      return client.grantAuthority(from, op, a.provider, a.scopes.map(String));
    }),
  },
  {
    name: 'cooo_create_task',
    description: 'Create a task funded by the caller with an expected work digest.',
    inputSchema: obj({
      taskId: P.taskId,
      provider: P.provider,
      amount: P.amount,
      cancellationFee: P.cancellationFee,
      expectedDigest: P.expectedDigest,
      operationId: P.operationId,
    }, ['taskId', 'provider', 'amount', 'cancellationFee', 'expectedDigest']),
    run: write('cooo_create_task', (client, a, from, op) => client.createTask(
      from, op, a.taskId, a.provider, toUint256(a.amount), toUint256(a.cancellationFee), a.expectedDigest,
    )),
  },
  {
    name: 'cooo_allocate_child',
    description: 'Allocate a child task under an existing parent task.',
    inputSchema: obj({
      parentId: P.parentId,
      childId: P.childId,
      provider: P.provider,
      amount: P.amount,
      cancellationFee: P.cancellationFee,
      expectedDigest: P.expectedDigest,
      operationId: P.operationId,
    }, ['parentId', 'childId', 'provider', 'amount', 'cancellationFee', 'expectedDigest']),
    run: write('cooo_allocate_child', (client, a, from, op) => client.allocateChild(
      from, op, a.parentId, a.childId, a.provider, toUint256(a.amount), toUint256(a.cancellationFee), a.expectedDigest,
    )),
  },
  {
    name: 'cooo_create_reviewed_task',
    description: 'Create a task that requires verifier review before settlement.',
    inputSchema: obj({
      taskId: P.taskId,
      provider: P.provider,
      amount: P.amount,
      cancellationFee: P.cancellationFee,
      expectedDigest: P.expectedDigest,
      reviewThreshold: P.reviewThreshold,
      termsVersion: P.termsVersion,
      termsDigest: P.termsDigest,
      operationId: P.operationId,
    }, ['taskId', 'provider', 'amount', 'cancellationFee', 'expectedDigest', 'reviewThreshold', 'termsVersion', 'termsDigest']),
    run: write('cooo_create_reviewed_task', (client, a, from, op) => client.createReviewedTask(
      from, op, a.taskId, a.provider, toUint256(a.amount), toUint256(a.cancellationFee), a.expectedDigest,
      toUint256(a.reviewThreshold), toUint256(a.termsVersion), a.termsDigest,
    )),
  },
  {
    name: 'cooo_dispatch',
    description: 'Dispatch a task so its provider can start work.',
    inputSchema: obj({ taskId: P.taskId, operationId: P.operationId }, ['taskId']),
    run: write('cooo_dispatch', (client, a, from, op) => client.dispatchTask(from, op, a.taskId)),
  },
  {
    name: 'cooo_deliver',
    description: 'Record the provider delivery digest for a dispatched task.',
    inputSchema: obj({ taskId: P.taskId, digest: P.digest, operationId: P.operationId }, ['taskId', 'digest']),
    run: write('cooo_deliver', (client, a, from, op) => client.deliverTask(from, op, a.taskId, a.digest)),
  },
  {
    name: 'cooo_accept',
    description: 'Accept a delivered task and release payment to the provider.',
    inputSchema: obj({ taskId: P.taskId, operationId: P.operationId }, ['taskId']),
    run: write('cooo_accept', (client, a, from, op) => client.acceptTask(from, op, a.taskId)),
  },
  {
    name: 'cooo_withdraw',
    description: 'Withdraw the caller funds from a settled task.',
    inputSchema: obj({ taskId: P.taskId, operationId: P.operationId }, ['taskId']),
    run: write('cooo_withdraw', (client, a, from, op) => client.withdrawTask(from, op, a.taskId)),
  },
  {
    name: 'cooo_cancel',
    description: 'Cancel a task and apply its cancellation fee.',
    inputSchema: obj({ taskId: P.taskId, operationId: P.operationId }, ['taskId']),
    run: write('cooo_cancel', (client, a, from, op) => client.cancel(from, op, a.taskId)),
  },
  {
    name: 'cooo_assign_verifier',
    description: 'Assign a verifier to a reviewed task with a reward.',
    inputSchema: obj({
      taskId: P.taskId,
      producer: P.producer,
      verifier: P.verifier,
      reward: P.reward,
      operationId: P.operationId,
    }, ['taskId', 'producer', 'verifier', 'reward']),
    run: write('cooo_assign_verifier', (client, a, from, op) => client.assignVerifier(
      from, op, a.taskId, a.producer, a.verifier, toUint256(a.reward),
    )),
  },
  {
    name: 'cooo_submit_verifier_result',
    description: 'Submit a verifier approval or rejection for a reviewed task.',
    inputSchema: obj({
      taskId: P.taskId,
      producer: P.producer,
      verifier: P.verifier,
      termsVersion: P.termsVersion,
      termsDigest: P.termsDigest,
      evidenceDigest: P.evidenceDigest,
      approved: P.approved,
      operationId: P.operationId,
    }, ['taskId', 'producer', 'verifier', 'termsVersion', 'termsDigest', 'evidenceDigest', 'approved']),
    run: write('cooo_submit_verifier_result', (client, a, from, op) => {
      if (typeof a.approved !== 'boolean') throw new Error('approved must be a boolean');
      return client.submitVerifierResult(
        from, op, a.taskId, a.producer, a.verifier, toUint256(a.termsVersion),
        a.termsDigest, a.evidenceDigest, a.approved,
      );
    }),
  },
  {
    name: 'cooo_revoke_reviewer',
    description: 'Revoke a verifier from a reviewed task.',
    inputSchema: obj({
      taskId: P.taskId,
      producer: P.producer,
      verifier: P.verifier,
      operationId: P.operationId,
    }, ['taskId', 'producer', 'verifier']),
    run: write('cooo_revoke_reviewer', (client, a, from, op) => client.revokeReviewer(
      from, op, a.taskId, a.producer, a.verifier,
    )),
  },
  {
    name: 'cooo_withdraw_verifier_reward',
    description: "Withdraw a verifier's earned reward for a reviewed task.",
    inputSchema: obj({
      taskId: P.taskId,
      producer: P.producer,
      verifier: P.verifier,
      operationId: P.operationId,
    }, ['taskId', 'producer', 'verifier']),
    run: write('cooo_withdraw_verifier_reward', (client, a, from, op) => client.withdrawVerifierReward(
      from, op, a.taskId, a.producer, a.verifier,
    )),
  },
  {
    name: 'cooo_sha256_text',
    description: 'Hash UTF-8 text with sha256 and return a 0x-prefixed digest.',
    inputSchema: obj({ text: P.text }, ['text']),
    run: (args) => ({ digest: '0x' + createHash('sha256').update(String(args.text), 'utf8').digest('hex') }),
  },
];

// ---------------------------------------------------------------- transport

function emit(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const reply = (id, result) => emit({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => emit({ jsonrpc: '2.0', id, error: { code, message } });

function errText(e) {
  if (e && e.code) return `${e.code}: ${e.message}`;
  return String((e && e.message) || e);
}

// SDK state carries uint256 values; keep bigint serializable as decimal strings.
function serialize(value) {
  return JSON.stringify(value === undefined ? null : value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item);
}

function initializeResult(params) {
  const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
  return {
    protocolVersion: requested || '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'cooo-mcp', version: '0.1.0' },
  };
}

async function callTool(id, hasId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const name = typeof p.name === 'string' ? p.name : '';
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    if (hasId) replyError(id, -32602, `unknown tool: ${name}`);
    return;
  }
  if (!hasId) return;
  const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {};
  try {
    const missing = (tool.inputSchema.required || []).find((k) => args[k] === undefined || args[k] === null);
    if (missing) throw new Error(`missing required argument: ${missing}`);
    const value = await tool.run(args, sdk, ENV);
    reply(id, { content: [{ type: 'text', text: serialize(value) }] });
  } catch (e) {
    reply(id, {
      content: [{ type: 'text', text: JSON.stringify({ error: errText(e) }) }],
      isError: true,
    });
  }
}

async function handleLine(line) {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log('ignoring unparsable line');
    return;
  }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    log('ignoring non-object JSON message');
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
  const id = hasId ? message.id : undefined;
  const method = typeof message.method === 'string' && message.method.length > 0 ? message.method : null;
  if (!method) {
    if (hasId) replyError(id, -32600, 'invalid request: missing method');
    else log('ignoring message without method');
    return;
  }
  try {
    if (method === 'initialize') {
      if (hasId) reply(id, initializeResult(message.params));
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'ping') {
      if (hasId) reply(id, {});
      return;
    }
    if (method === 'tools/list') {
      if (hasId) {
        reply(id, {
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      }
      return;
    }
    if (method === 'tools/call') {
      await callTool(id, hasId, message.params);
      return;
    }
    if (hasId) replyError(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error:', (e && e.stack) || String(e));
    if (hasId) replyError(id, -32603, 'internal error');
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

// Track in-flight handlers so a closed stdin drains responses instead of truncating them.
let inFlight = 0;
let closing = false;

function maybeExit() {
  if (closing && inFlight === 0) process.exit(0);
}

rl.on('line', (line) => {
  inFlight += 1;
  handleLine(line)
    .catch((e) => log('unhandled line error:', (e && e.stack) || String(e)))
    .finally(() => {
      inFlight -= 1;
      maybeExit();
    });
});

rl.on('close', () => {
  closing = true;
  maybeExit();
});

process.stdout.on('error', () => process.exit(0));

log(`cooo-mcp listening on stdio (caller ${ENV.caller})`);
