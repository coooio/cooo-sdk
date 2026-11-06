/** Validation for authoritative cooo state responses. */

import { CoooSdkError } from './error.js';
import type { CoooState } from './types.js';
import { isAddress, isDecimalAmount, isHex32 } from './validation.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireState(value: unknown): CoooState {
  if (!isRecord(value) || !isRecord(value.ledger) || !Array.isArray(value.tasks)) {
    throw new CoooSdkError('authoritative state has an unexpected shape', 'state_validation');
  }
  const ledger = value.ledger;
  for (const key of [
    'totalDeposits',
    'balancesTotal',
    'reserved',
    'earnedClaims',
    'completedPayouts',
    'completedRefunds',
    'platformFees',
  ] as const) {
    if (!isDecimalAmount(ledger[key])) {
      throw new CoooSdkError(`ledger.${key} must be a decimal uint256 string`, 'state_validation');
    }
  }
  if (typeof ledger.conserved !== 'boolean') {
    throw new CoooSdkError('ledger.conserved must be boolean', 'state_validation');
  }

  if (
    value.deployment !== undefined &&
    (!isRecord(value.deployment) ||
      typeof value.deployment.lyquidId !== 'string' ||
      (value.deployment.contract !== undefined &&
        (typeof value.deployment.contract !== 'string' || !isAddress(value.deployment.contract))) ||
      typeof value.deployment.protocolVersion !== 'string')
  ) {
    throw new CoooSdkError('deployment identity has an unexpected shape', 'state_validation');
  }

  if (value.asset !== undefined) {
    if (
      !isRecord(value.asset) ||
      typeof value.asset.id !== 'string' ||
      typeof value.asset.precision !== 'number' ||
      !Number.isSafeInteger(value.asset.precision) ||
      value.asset.precision < 0 ||
      typeof value.asset.synthetic !== 'boolean'
    ) {
      throw new CoooSdkError('asset has an unexpected shape', 'state_validation');
    }
  }
  if (value.balances !== undefined) {
    if (!Array.isArray(value.balances)) throw new CoooSdkError('balances must be an array', 'state_validation');
    for (const [balanceIndex, balance] of value.balances.entries()) {
      if (!isRecord(balance) || typeof balance.account !== 'string' || !isAddress(balance.account) || !isDecimalAmount(balance.amount)) {
        throw new CoooSdkError(`balances[${balanceIndex}] has an unexpected shape`, 'state_validation');
      }
    }
  }

  const tasks: unknown[] = value.tasks;
  for (const [taskIndex, task] of tasks.entries()) {
    if (
      !isRecord(task) ||
      typeof task.id !== 'string' ||
      typeof task.parent !== 'string' ||
      !Array.isArray(task.children) ||
      task.children.some(child => typeof child !== 'string') ||
      typeof task.executionState !== 'number' ||
      !Number.isSafeInteger(task.executionState) ||
      typeof task.paymentState !== 'number' ||
      !Number.isSafeInteger(task.paymentState)
    ) {
      throw new CoooSdkError(`tasks[${taskIndex}] has an unexpected shape`, 'state_validation');
    }
    const termsVersion = task.termsVersion;
    if (termsVersion !== undefined && (typeof termsVersion !== 'number' || !Number.isSafeInteger(termsVersion) || termsVersion < 1)) {
      throw new CoooSdkError(`tasks[${taskIndex}].termsVersion is invalid`, 'state_validation');
    }
    const termsDigest = task.termsDigest;
    if (termsDigest !== undefined && (typeof termsDigest !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(termsDigest))) {
      throw new CoooSdkError(`tasks[${taskIndex}].termsDigest is invalid`, 'state_validation');
    }
    if (task.providers !== undefined) {
      if (!Array.isArray(task.providers)) {
        throw new CoooSdkError(`tasks[${taskIndex}].providers must be an array`, 'state_validation');
      }
      for (const [providerIndex, provider] of task.providers.entries()) {
        if (
          !isRecord(provider) ||
          typeof provider.provider !== 'string' ||
          !isAddress(provider.provider) ||
          typeof provider.executionState !== 'number' ||
          !Number.isSafeInteger(provider.executionState) ||
          typeof provider.paymentState !== 'number' ||
          !Number.isSafeInteger(provider.paymentState)
        ) {
          throw new CoooSdkError(`tasks[${taskIndex}].providers[${providerIndex}] has an unexpected shape`, 'state_validation');
        }
      }
    }
    if (task.verifications !== undefined) {
      if (!Array.isArray(task.verifications)) {
        throw new CoooSdkError(`tasks[${taskIndex}].verifications must be an array`, 'state_validation');
      }
      for (const [verificationIndex, verification] of task.verifications.entries()) {
        if (
          !isRecord(verification) ||
          typeof verification.producer !== 'string' ||
          !isAddress(verification.producer) ||
          typeof verification.verifier !== 'string' ||
          !isAddress(verification.verifier) ||
          typeof verification.reward !== 'string' ||
          !isDecimalAmount(verification.reward) ||
          typeof verification.authorityEpoch !== 'number' ||
          !Number.isSafeInteger(verification.authorityEpoch) ||
          typeof verification.revoked !== 'boolean' ||
          typeof verification.paymentState !== 'number' ||
          !Number.isSafeInteger(verification.paymentState)
        ) {
          throw new CoooSdkError(`tasks[${taskIndex}].verifications[${verificationIndex}] has an unexpected shape`, 'state_validation');
        }
      }
    }
  }

  if (value.operations !== undefined) {
    if (!Array.isArray(value.operations)) {
      throw new CoooSdkError('operations must be an array', 'state_validation');
    }
    for (const [operationIndex, operation] of value.operations.entries()) {
      if (
        !isRecord(operation) ||
        typeof operation.caller !== 'string' ||
        !isAddress(operation.caller) ||
        typeof operation.operationId !== 'string' ||
        typeof operation.action !== 'number' ||
        !Number.isSafeInteger(operation.action) ||
        operation.action < 0 ||
        typeof operation.taskId !== 'string' ||
        typeof operation.parentId !== 'string' ||
        typeof operation.provider !== 'string' ||
        !isAddress(operation.provider) ||
        typeof operation.counterparty !== 'string' ||
        !isAddress(operation.counterparty) ||
        !isDecimalAmount(operation.amount) ||
        !isDecimalAmount(operation.cancellationFee) ||
        typeof operation.digest !== 'string' ||
        !isHex32(operation.digest) ||
        !Array.isArray(operation.scopes) ||
        operation.scopes.some(scope => typeof scope !== 'string')
      ) {
        throw new CoooSdkError(`operations[${operationIndex}] has an unexpected shape`, 'state_validation');
      }
    }
  }

  if (value.authorityGrants !== undefined) {
    if (!Array.isArray(value.authorityGrants)) {
      throw new CoooSdkError('authorityGrants must be an array', 'state_validation');
    }
    for (const [grantIndex, grant] of value.authorityGrants.entries()) {
      if (
        !isRecord(grant) ||
        typeof grant.provider !== 'string' ||
        !isAddress(grant.provider) ||
        !Array.isArray(grant.scopes) ||
        grant.scopes.some(scope => typeof scope !== 'string')
      ) {
        throw new CoooSdkError(`authorityGrants[${grantIndex}] has an unexpected shape`, 'state_validation');
      }
    }
  }

  return value as unknown as CoooState;
}
