/** Canonical Solidity ABI encoding for cooo operation arguments. */

import { CoooSdkError } from './error.js';
import type { AbiValue } from './abi.js';
import { UINT256_LIMIT, assertAddress, assertHex32 } from './validation.js';

function encodeUint(value: bigint | number | boolean): string {
  let integer: bigint;
  try {
    integer = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw new CoooSdkError('unsigned integer is malformed', 'invalid_argument');
  }
  if (integer < 0n || integer >= UINT256_LIMIT) {
    throw new CoooSdkError('unsigned integer must fit uint256', 'invalid_argument');
  }
  return integer.toString(16).padStart(64, '0');
}

function encodeAddress(value: string): string {
  return value.slice(2).toLowerCase().padStart(64, '0');
}

function encodeString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 1024 * 1024) {
    throw new CoooSdkError('ABI string exceeds one MiB', 'invalid_argument');
  }
  const words = Math.ceil(bytes.length / 32);
  const body = new Uint8Array(words * 32);
  body.set(bytes);
  return encodeUint(bytes.length) + Array.from(body, byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodeStringArray(values: readonly string[]): string {
  const encoded = values.map(value => encodeString(value));
  const offsets: string[] = [];
  let cursor = BigInt(values.length * 32);
  for (const value of encoded) {
    offsets.push(encodeUint(cursor));
    cursor += BigInt(value.length / 2);
  }
  return encodeUint(values.length) + offsets.join('') + encoded.join('');
}

export function encodeParameters(types: readonly string[], values: readonly AbiValue[]): string {
  if (types.length !== values.length) {
    throw new CoooSdkError('ABI type and value counts differ', 'invalid_argument');
  }
  const heads: string[] = [];
  const tails: string[] = [];
  types.forEach((type, index) => {
    const value = values[index];
    if (type === 'string') {
      if (typeof value !== 'string') {
        throw new CoooSdkError(`argument ${index} must be a string`, 'invalid_argument');
      }
      const encoded = encodeString(value);
      heads.push(encodeUint(BigInt(types.length * 32 + tails.reduce((sum, item) => sum + item.length / 2, 0))));
      tails.push(encoded);
    } else if (type === 'string[]') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new CoooSdkError(`argument ${index} must be a string array`, 'invalid_argument');
      }
      const encoded = encodeStringArray(value);
      heads.push(encodeUint(BigInt(types.length * 32 + tails.reduce((sum, item) => sum + item.length / 2, 0))));
      tails.push(encoded);
    } else if (type === 'address') {
      if (typeof value !== 'string') {
        throw new CoooSdkError(`argument ${index} must be an address string`, 'invalid_argument');
      }
      assertAddress(value, `argument ${index}`);
      heads.push(encodeAddress(value));
    } else if (type === 'bool') {
      if (typeof value !== 'boolean') {
        throw new CoooSdkError(`argument ${index} must be boolean`, 'invalid_argument');
      }
      heads.push(encodeUint(value));
    } else if (type === 'uint256') {
      if (typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
        throw new CoooSdkError(`argument ${index} must be bigint or a safe integer`, 'invalid_argument');
      }
      heads.push(encodeUint(value));
    } else if (type === 'bytes32') {
      if (typeof value !== 'string') {
        throw new CoooSdkError(`argument ${index} must be a bytes32 string`, 'invalid_argument');
      }
      assertHex32(value, `argument ${index}`);
      heads.push(value.slice(2).toLowerCase().padStart(64, '0'));
    } else {
      throw new CoooSdkError(`unsupported ABI type ${type}`, 'invalid_argument');
    }
  });
  return heads.concat(tails).join('');
}
