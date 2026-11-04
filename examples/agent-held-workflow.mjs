import { createHash } from 'node:crypto';

const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const ZERO_DIGEST = '0x' + '0'.repeat(64);

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function agentHeldTerms({ requester, provider, reviewer, evidenceDigest }) {
  return Object.freeze({
    acceptanceCriteria: 'Return the agreed canonical evidence payload and verify its SHA-256 digest.',
    assetId: 'LOCAL-TEST-USD',
    assetPrecision: 8,
    providerAmount: '90',
    reviewerReward: '10',
    cancellationFee: '0',
    scope: 'work:data',
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    requester,
    provider,
    reviewer,
    termsVersion: 1,
    expectedEvidenceDigest: evidenceDigest,
  });
}

export function agentHeldTermsDigest(terms) {
  return `0x${createHash('sha256').update(stableJson(terms)).digest('hex')}`;
}

function requireDistinctAddresses(accounts) {
  const normalized = new Set(Object.entries(accounts).map(([role, address]) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`${role} must be a 20-byte address`);
    return String(address).toLowerCase();
  }));
  if (normalized.size !== Object.keys(accounts).length) {
    throw new Error('operator, requester, provider, and reviewer must be distinct protocol principals');
  }
}

export function buildAgentHeldWorkflow({
  taskId,
  operator,
  requester,
  provider,
  reviewer,
  evidenceDigest,
  termsDigest,
  deploymentTag,
}) {
  if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('taskId is required');
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidenceDigest)) throw new Error('evidenceDigest must be 32 bytes');
  if (!/^0x[0-9a-fA-F]{64}$/.test(termsDigest)) throw new Error('termsDigest must be 32 bytes');
  if (!/^[0-9a-f]{12}$/.test(deploymentTag)) throw new Error('deploymentTag must be twelve hexadecimal characters');
  requireDistinctAddresses({ operator, requester, provider, reviewer });

  const operationId = name => {
    const value = `${taskId}:${name}:d${deploymentTag}`;
    if (value.length > 128) throw new Error('task ID is too long for a protocol operation ID');
    return value;
  };
  const scope = 'work:data';
  const reviewerScope = `verify:${scope}`;
  const termsScope = `terms-digest:${termsDigest.toLowerCase()}`;
  const step = (principal, label, method, types, values, expectedIntent) => Object.freeze({
    principal,
    label,
    method,
    types: Object.freeze(types),
    values: Object.freeze(values),
    operationId: operationId(label),
    expectedIntent: Object.freeze({
      taskId: '',
      parentId: '',
      provider: ZERO_ADDRESS,
      counterparty: ZERO_ADDRESS,
      amount: '0',
      cancellationFee: '0',
      digest: ZERO_DIGEST,
      scopes: [],
      ...expectedIntent,
    }),
  });

  return Object.freeze([
    step('requester', 'requester-deposit', 'deposit',
      ['string', 'uint256'], [operationId('requester-deposit'), 100n],
      { action: 0, amount: '100' }),
    step('operator', 'operator-admit-provider', 'grantAuthority',
      ['string', 'address', 'string[]'], [operationId('operator-admit-provider'), provider, [scope]],
      { action: 8, provider, scopes: [scope] }),
    step('operator', 'operator-admit-reviewer', 'grantAuthority',
      ['string', 'address', 'string[]'], [operationId('operator-admit-reviewer'), reviewer, [reviewerScope]],
      { action: 8, provider: reviewer, scopes: [reviewerScope] }),
    step('requester', 'requester-reviewed-terms', 'createReviewedTask',
      ['string', 'string', 'address', 'uint256', 'uint256', 'bytes32', 'uint256', 'uint256', 'bytes32'],
      [operationId('requester-reviewed-terms'), taskId, provider, 100n, 0n, evidenceDigest, 1n, 1n, termsDigest],
      {
        action: 27,
        taskId,
        parentId: '1',
        provider,
        amount: '100',
        cancellationFee: '0',
        digest: evidenceDigest,
        scopes: ['terms-version:1', termsScope],
      }),
    step('requester', 'requester-provider-assignment', 'assignProvider',
      ['string', 'string', 'address', 'uint256', 'bytes32'],
      [operationId('requester-provider-assignment'), taskId, provider, 90n, evidenceDigest],
      { action: 9, taskId, provider, amount: '90', digest: evidenceDigest }),
    step('requester', 'requester-reviewer-assignment', 'assignVerifier',
      ['string', 'string', 'address', 'address', 'uint256'],
      [operationId('requester-reviewer-assignment'), taskId, provider, reviewer, 10n],
      { action: 15, taskId, provider: reviewer, counterparty: provider, amount: '10' }),
    step('provider', 'provider-dispatch', 'dispatchProvider',
      ['string', 'string', 'address'], [operationId('provider-dispatch'), taskId, provider],
      { action: 10, taskId, provider }),
    step('provider', 'provider-delivery', 'deliverProvider',
      ['string', 'string', 'address', 'bytes32'], [operationId('provider-delivery'), taskId, provider, evidenceDigest],
      { action: 11, taskId, provider, digest: evidenceDigest }),
    step('reviewer', 'reviewer-decision', 'submitVerifierResult',
      ['string', 'string', 'address', 'address', 'uint256', 'bytes32', 'bytes32', 'bool'],
      [operationId('reviewer-decision'), taskId, provider, reviewer, 1n, termsDigest, evidenceDigest, true],
      {
        action: 16,
        taskId,
        parentId: '1',
        provider: reviewer,
        counterparty: provider,
        amount: '1',
        digest: evidenceDigest,
        scopes: [termsScope],
      }),
    step('requester', 'requester-acceptance', 'acceptProvider',
      ['string', 'string', 'address'], [operationId('requester-acceptance'), taskId, provider],
      { action: 12, taskId, provider, amount: '90' }),
    step('provider', 'provider-payout', 'withdrawProvider',
      ['string', 'string', 'address'], [operationId('provider-payout'), taskId, provider],
      { action: 13, taskId, provider, amount: '90' }),
    step('reviewer', 'reviewer-payout', 'withdrawVerifierReward',
      ['string', 'string', 'address', 'address'], [operationId('reviewer-payout'), taskId, provider, reviewer],
      { action: 17, taskId, provider: reviewer, counterparty: provider, amount: '10' }),
    step('requester', 'requester-close-remainder', 'cancel',
      ['string', 'string'], [operationId('requester-close-remainder'), taskId],
      { action: 6, taskId, amount: '100' }),
  ].map(Object.freeze));
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function sameDigest(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

export function operationMatches(actual, expected) {
  return actual.action === expected.action &&
    actual.taskId === expected.taskId &&
    actual.parentId === expected.parentId &&
    sameAddress(actual.provider, expected.provider) &&
    sameAddress(actual.counterparty, expected.counterparty) &&
    actual.amount === expected.amount &&
    actual.cancellationFee === expected.cancellationFee &&
    sameDigest(actual.digest, expected.digest) &&
    actual.scopes.length === expected.scopes.length &&
    actual.scopes.every((scope, index) => scope === expected.scopes[index]);
}

export function findExactOperation(state, caller, operationId, expectedIntent) {
  return (state.operations ?? []).find(operation =>
    sameAddress(operation.caller, caller) &&
    operation.operationId === operationId &&
    operationMatches(operation, expectedIntent));
}
