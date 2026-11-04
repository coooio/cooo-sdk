import { CoooSdkError } from './error.js';
import type { Address, Hex } from './types.js';

export function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function sameDigest(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export const UINT256_LIMIT = 1n << 256n;
const UINT64_EXCLUSIVE_LIMIT = 1n << 64n;
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_SCOPE = /^[a-z][a-z0-9:_-]{0,63}$/;

export function assertPositiveMilliseconds(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CoooSdkError(`${name} must be a positive integer`, 'invalid_argument');
  }
}

export function assertEndpoint(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoooSdkError(`${name} must be an absolute URL`, 'invalid_argument');
  }
  const allowsHttp = LOCAL_HTTP_HOSTS.has(url.hostname);
  if ((url.protocol !== 'https:' && !allowsHttp) || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new CoooSdkError(`${name} must use HTTPS or an explicit local HTTP host`, 'invalid_argument');
  }
  return url;
}

export function assertIdentifier(value: string, name: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new CoooSdkError(`${name} must match ${SAFE_IDENTIFIER.source}`, 'invalid_argument');
  }
}

export function assertScope(value: string): void {
  if (!SAFE_SCOPE.test(value)) {
    throw new CoooSdkError(`scope must match ${SAFE_SCOPE.source}`, 'invalid_argument');
  }
}

export function assertSmallUint(value: bigint, name: string): void {
  if (value <= 0n || value >= UINT64_EXCLUSIVE_LIMIT) {
    throw new CoooSdkError(`${name} must fit a positive uint64`, 'invalid_argument');
  }
}

export function assertAmount(value: bigint, name: string): void {
  if (value < 0n || value >= UINT256_LIMIT) {
    throw new CoooSdkError(`${name} must be a uint256 integer`, 'invalid_argument');
  }
}

export function isDecimalAmount(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < UINT256_LIMIT;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function assertAddress(value: string, name: string): void {
  if (!isAddress(value)) throw new CoooSdkError(`${name} must be a 20-byte address`, 'invalid_argument');
}

export function assertHex32(value: string, name: string): void {
  if (!isHex32(value)) throw new CoooSdkError(`${name} must be exactly 32 bytes`, 'invalid_argument');
}
