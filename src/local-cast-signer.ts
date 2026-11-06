/** Caller-held Foundry Cast signer for local integration. */

import { spawn } from 'node:child_process';
import { CoooSdkError } from './error.js';
import type { Address, Hex, SignableTransaction } from './types.js';

export interface LocalCastSignerOptions {
  /** Address that the caller has provisioned for this Agent. */
  readonly expectedAddress: Address;
  /** Supplies a caller-held key only to the local Cast process; never persists or sends it to cooo. */
  readonly readPrivateKey: () => string | Promise<string>;
  readonly castCommand?: string;
  readonly commandPrefix?: readonly string[];
  readonly timeoutMs?: number;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const RAW_TRANSACTION_PATTERN = /^0x[0-9a-fA-F]{4,}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Signs transactions with a caller-held Foundry Cast key. */
export class LocalCastSigner {
  readonly expectedAddress: Address;
  private readonly readPrivateKey: () => string | Promise<string>;
  private readonly castCommand: string;
  private readonly commandPrefix: readonly string[];
  private readonly timeoutMs: number;
  private verifiedAddress?: Address;
  private privateKeyPromise?: Promise<string>;

  constructor(options: LocalCastSignerOptions) {
    if (!ADDRESS_PATTERN.test(options.expectedAddress)) {
      throw new CoooSdkError('expectedAddress must be a 20-byte address', 'invalid_argument');
    }
    this.expectedAddress = options.expectedAddress;
    this.readPrivateKey = options.readPrivateKey;
    this.castCommand = options.castCommand ?? 'cast';
    this.commandPrefix = options.commandPrefix ?? [];
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new CoooSdkError('LocalCastSigner timeout must be 100-120000 milliseconds', 'invalid_argument');
    }
  }

  async signMessage(message: string): Promise<Hex> {
    if (message.length === 0 || message.length > 4096) {
      throw new CoooSdkError('message must contain 1-4096 characters', 'invalid_argument');
    }
    await this.verifyKeyControl();
    const output = await this.runCast(['wallet', 'sign', '--interactive', message]);
    if (!/^0x[0-9a-fA-F]{130}$/.test(output)) {
      throw new CoooSdkError('local Cast signer did not return a 65-byte signature', 'rpc_error');
    }
    return output;
  }
  async signTransaction(transaction: SignableTransaction): Promise<Hex> {
    if (transaction.from.toLowerCase() !== this.expectedAddress.toLowerCase()) {
      throw new CoooSdkError('transaction signer does not match the provisioned account', 'invalid_argument');
    }
    await this.verifyKeyControl();
    const output = await this.runCast([
      'mktx',
      '--interactive',
      '--legacy',
      '--chain', transaction.chainId.toString(10),
      '--nonce', transaction.nonce.toString(10),
      '--gas-limit', BigInt(transaction.gas).toString(10),
      '--gas-price', transaction.gasPrice.toString(10),
      transaction.to,
      transaction.data,
    ]);
    if (!RAW_TRANSACTION_PATTERN.test(output)) {
      throw new CoooSdkError('local Cast signer did not return a raw transaction', 'rpc_error');
    }
    return output;
  }

  private async verifyKeyControl(): Promise<void> {
    if (this.verifiedAddress?.toLowerCase() === this.expectedAddress.toLowerCase()) return;
    const output = await this.runCast(['wallet', 'address', '--interactive']);
    if (!ADDRESS_PATTERN.test(output) || output.toLowerCase() !== this.expectedAddress.toLowerCase()) {
      throw new CoooSdkError('caller-held key does not control the provisioned account', 'invalid_argument');
    }
    this.verifiedAddress = output;
  }

  private loadPrivateKey(): Promise<string> {
    this.privateKeyPromise ??= Promise.resolve(this.readPrivateKey());
    return this.privateKeyPromise;
  }
  private async runCast(args: readonly string[]): Promise<string> {
    const privateKey = await this.loadPrivateKey();
    if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
      throw new CoooSdkError('caller-held private key is malformed', 'invalid_argument');
    }
    const child = spawn(this.castCommand, [...this.commandPrefix, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, this.timeoutMs);
    const finished = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.write(`${privateKey}\n`);
    child.stdin.end();
    try {
      const code = await finished;
      if (timedOut) throw new CoooSdkError('local Cast signer timed out', 'timeout');
      if (code !== 0) throw new CoooSdkError('local Cast signer rejected the request', 'rpc_error');
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (line === undefined) throw new CoooSdkError('local Cast signer returned no result', 'invalid_argument');
      // A PTY can append the result to an interactive prompt on the same line.
      return line.match(/0x[0-9a-fA-F]+$/)?.[0] ?? line;
    } finally {
      clearTimeout(timer);
    }
  }
}
