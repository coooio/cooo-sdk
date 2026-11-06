/** JSON-RPC quantity parsing for canonical Ethereum responses. */

import { CoooSdkError } from './error.js';

export type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: number; readonly result?: unknown; error?: undefined }
  | {
      readonly jsonrpc: '2.0';
      readonly id: number;
      readonly result?: undefined;
      readonly error: { readonly code?: unknown; readonly message?: unknown; readonly data?: unknown };
    };

export function parseQuantity(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new CoooSdkError(`${name} must be a canonical hexadecimal quantity`, 'rpc_error');
  }
  return BigInt(value);
}

