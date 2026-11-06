/** Exact caller and operation-intent reconciliation helpers. */

import { sameAddress, sameDigest } from './validation.js';
import type {
  Address,
  CoooState,
  ExpectedOperationIntent,
  OperationState,
} from './types.js';

export function operationMatches(actual: OperationState, expected: ExpectedOperationIntent): boolean {
  return (expected.action === undefined || actual.action === expected.action) &&
    (expected.taskId === undefined || actual.taskId === expected.taskId) &&
    (expected.parentId === undefined || actual.parentId === expected.parentId) &&
    (expected.provider === undefined || sameAddress(actual.provider, expected.provider)) &&
    (expected.counterparty === undefined || sameAddress(actual.counterparty, expected.counterparty)) &&
    (expected.amount === undefined || actual.amount === expected.amount) &&
    (expected.cancellationFee === undefined || actual.cancellationFee === expected.cancellationFee) &&
    (expected.digest === undefined || sameDigest(actual.digest, expected.digest)) &&
    (expected.scopes === undefined ||
      (actual.scopes.length === expected.scopes.length &&
        actual.scopes.every((scope, index) => scope === expected.scopes?.[index])));
}

export function findExactOperation(
  state: CoooState,
  caller: Address,
  operationId: string,
  expectedIntent: ExpectedOperationIntent,
): OperationState | undefined {
  return (state.operations ?? []).find(operation =>
    sameAddress(operation.caller, caller) &&
    operation.operationId === operationId &&
    operationMatches(operation, expectedIntent),
  );
}

export function findCallerOperation(
  state: CoooState,
  caller: Address,
  operationId: string,
): OperationState | undefined {
  return (state.operations ?? []).find(operation =>
    sameAddress(operation.caller, caller) && operation.operationId === operationId,
  );
}
