import { SELECTORS, type AbiValue, type CoooMethod } from './abi.js';
import { encodeParameters } from './abi-encoder.js';
import { CoooSdkError } from './error.js';
import { parseQuantity, type JsonRpcResponse } from './json-rpc.js';
import { findCallerOperation, findExactOperation } from './operation.js';
import { requireState } from './state.js';
import { COOO_PROTOCOL_VERSION } from './types.js';
import type {
  Address,
  CoooSdkOptions,
  CoooState,
  DeploymentIdentity,
  ExpectedOperationIntent,
  Hex,
  LyquidMetadata,
  OperationConfirmation,
  PreparedTransaction,
  SignableTransaction,
  TransactionSubmission,
  Uint256,
} from './types.js';
import {
  assertAddress,
  assertAmount,
  assertEndpoint,
  assertHex32,
  assertIdentifier,
  isAddress,
  assertPositiveMilliseconds,
  assertScope,
  assertSmallUint,
} from './validation.js';

export class CoooSdk {
  private readonly rpcUrl: string;
  private readonly infoUrl: string;
  private readonly stateUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private readonly expectedLyquidId?: string;
  private readonly expectedContract?: string;
  private readonly transactionSender?: (transaction: PreparedTransaction) => Promise<Hex>;
  private contractAddress = '';
  private requestIndex = 0;

  constructor(options: CoooSdkOptions) {
    this.rpcUrl = assertEndpoint(options.rpcUrl, 'rpcUrl').toString();
    this.infoUrl = assertEndpoint(options.infoUrl, 'infoUrl').toString();
    this.stateUrl = assertEndpoint(options.stateUrl, 'stateUrl').toString();
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (options.transactionSender !== undefined) this.transactionSender = options.transactionSender;
    if (options.transactionSender && (!options.expectedLyquidId || !options.expectedContract)) {
      throw new CoooSdkError('external signing requires an explicit deployment binding', 'invalid_argument');
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (options.signal !== undefined) this.signal = options.signal;
    if (options.expectedLyquidId !== undefined) this.expectedLyquidId = options.expectedLyquidId;
    if (options.expectedContract !== undefined) this.expectedContract = options.expectedContract;
    assertPositiveMilliseconds(this.timeoutMs, 'timeoutMs');
  }

  private async requestJson(url: string, init?: RequestInit): Promise<unknown> {
    this.throwIfAborted(url);
    const controller = new AbortController();
    const callerAbort = () => controller.abort();
    this.signal?.addEventListener('abort', callerAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        throw new CoooSdkError(`HTTP ${response.status}`, 'http_error', { endpoint: url, status: response.status });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new CoooSdkError(`HTTP ${response.status} response is not valid JSON`, 'state_validation', {
          endpoint: url,
          status: response.status,
          cause: error,
        });
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new CoooSdkError('HTTP response body must be a JSON object', 'state_validation', { endpoint: url });
      }
      return body;
    } catch (error) {
      if (error instanceof CoooSdkError) throw error;
      if (this.signal?.aborted) {
        throw new CoooSdkError('request was aborted', 'aborted', { endpoint: url, cause: error });
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new CoooSdkError(`request timed out after ${this.timeoutMs}ms`, 'timeout', { endpoint: url });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', callerAbort);
    }
  }

  private throwIfAborted(endpoint?: string): void {
    if (this.signal?.aborted) {
      throw new CoooSdkError('request was aborted', 'aborted', { endpoint });
    }
  }

  private requireMutationBinding(): void {
    if (this.expectedLyquidId === undefined || this.expectedContract === undefined) {
      throw new CoooSdkError(
        'trusted mutations require both expectedLyquidId and expectedContract deployment pins',
        'invalid_argument',
      );
    }
  }

  async discover(): Promise<LyquidMetadata> {
    const metadata = (await this.requestJson(this.infoUrl)) as LyquidMetadata;
    if (metadata.lyquid_id !== undefined && typeof metadata.lyquid_id !== 'string') {
      throw new CoooSdkError('lyquid_id must be a string', 'state_validation');
    }
    if (metadata.lyquidId !== undefined && typeof metadata.lyquidId !== 'string') {
      throw new CoooSdkError('lyquidId must be a string', 'state_validation');
    }
    const actualLyquidId = metadata.lyquid_id ?? metadata.lyquidId;
    if (this.expectedLyquidId !== undefined && actualLyquidId !== this.expectedLyquidId) {
      throw new CoooSdkError('Lyquid deployment identity does not match the configured deployment', 'state_validation', {
        expectedLyquidId: this.expectedLyquidId,
        actualLyquidId,
      });
    }
    this.contractAddress = metadata.backend_contract ?? metadata.contract ?? '';
    if (!isAddress(this.contractAddress)) {
      throw new CoooSdkError('backend contract address is missing', 'state_validation');
    }
    if (this.expectedContract !== undefined && this.contractAddress.toLowerCase() !== this.expectedContract.toLowerCase()) {
      throw new CoooSdkError('backend contract address does not match the configured deployment', 'state_validation', {
        expectedContract: this.expectedContract,
        actualContract: this.contractAddress,
      });
    }
    return metadata;
  }

  async getState(): Promise<CoooState> {
    if (this.expectedLyquidId !== undefined || this.expectedContract !== undefined) {
      await this.discover();
    }
    const state = requireState(await this.requestJson(this.stateUrl));
    const deployment = state.deployment;
    if (!deployment || deployment.protocolVersion !== COOO_PROTOCOL_VERSION ||
        (this.expectedLyquidId !== undefined && deployment.lyquidId !== this.expectedLyquidId) ||
        (deployment.contract !== undefined &&
          (typeof deployment.contract !== 'string' ||
            deployment.contract.toLowerCase() !== this.contractAddress.toLowerCase()))) {
      throw new CoooSdkError('state response is not bound to the expected deployment and protocol', 'state_validation', {
        expectedLyquidId: this.expectedLyquidId,
        expectedContract: this.expectedContract,
        expectedProtocolVersion: COOO_PROTOCOL_VERSION,
      });
    }
    return state;
  }

  async waitForState(
    predicate: (state: CoooState) => boolean,
    timeoutMs = 30_000,
    intervalMs = 200,
    signal?: AbortSignal,
  ): Promise<CoooState> {
    assertPositiveMilliseconds(timeoutMs, 'timeoutMs');
    assertPositiveMilliseconds(intervalMs, 'intervalMs');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted || this.signal?.aborted) {
        throw new CoooSdkError('state wait was aborted', 'aborted');
      }
      const state = await this.getState();
      if (predicate(state)) return state;
      if (Date.now() >= deadline) {
        throw new CoooSdkError('timed out waiting for authoritative state', 'timeout', { timeoutMs });
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  async waitForOperation(
    caller: Address,
    operationId: string,
    expectedIntent: ExpectedOperationIntent,
    timeoutMs = 30_000,
    intervalMs = 200,
    signal?: AbortSignal,
  ): Promise<OperationConfirmation> {
    assertPositiveMilliseconds(timeoutMs, 'timeoutMs');
    assertPositiveMilliseconds(intervalMs, 'intervalMs');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted || this.signal?.aborted) {
        throw new CoooSdkError('operation wait was aborted', 'aborted');
      }
      const state = await this.getState();
      const operation = findExactOperation(state, caller, operationId, expectedIntent);
      if (operation) return Object.freeze({ operation, state });
      const conflicting = findCallerOperation(state, caller, operationId);
      if (conflicting) {
        throw new CoooSdkError('authoritative operation intent does not match the requested payload', 'state_validation', {
          caller,
          operationId,
          expectedIntent,
          actualIntent: conflicting,
        });
      }
      if (Date.now() >= deadline) {
        throw new CoooSdkError('timed out waiting for the authoritative operation', 'timeout', {
          caller,
          operationId,
          timeoutMs,
        });
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  private async rpc(method: string, params: readonly unknown[]): Promise<unknown> {
    const payload = { jsonrpc: '2.0' as const, id: ++this.requestIndex, method, params };
    const body = (await this.requestJson(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })) as JsonRpcResponse;
    if (body.jsonrpc !== '2.0' || body.id !== payload.id ||
        (('error' in body) === ('result' in body)) ||
        (body.error === undefined && body.result === undefined)) {
      throw new CoooSdkError('JSON-RPC response does not match the request', 'rpc_error', {
        endpoint: this.rpcUrl,
        method,
      });
    }
    if (body.error !== undefined) {
      if (body.error === null || typeof body.error !== 'object' || typeof body.error.message !== 'string') {
        throw new CoooSdkError('JSON-RPC error has an unexpected shape', 'rpc_error', {
          endpoint: this.rpcUrl,
          method,
        });
      }
      throw new CoooSdkError(String(body.error.message), 'rpc_error', {
        endpoint: this.rpcUrl,
        method,
        serverCode: body.error.code,
      });
    }
    return body.result;
  }

  async prepareTransaction(
    method: CoooMethod,
    from: Address,
    types: readonly string[],
    values: readonly AbiValue[],
  ): Promise<SignableTransaction> {
    if (this.expectedLyquidId === undefined || this.expectedContract === undefined) {
      throw new CoooSdkError('transaction preparation requires both Lyquid and contract deployment pins', 'invalid_argument');
    }
    await this.discover();
    assertAddress(from, 'from');
    if (this.expectedLyquidId !== undefined || this.expectedContract !== undefined) await this.getState();
    const [chainId, nonce, gasPrice] = await Promise.all([
      this.rpc('eth_chainId', []),
      this.rpc('eth_getTransactionCount', [from, 'latest']),
      this.rpc('eth_gasPrice', []),
    ]);
    const parsedChainId = parseQuantity(chainId, 'eth_chainId');
    const parsedNonce = parseQuantity(nonce, 'eth_getTransactionCount');
    const parsedGasPrice = parseQuantity(gasPrice, 'eth_gasPrice');
    return Object.freeze({
      from,
      to: this.contractAddress,
      data: SELECTORS[method] + encodeParameters(types, values),
      gas: '0x249f00',
      chainId: parsedChainId,
      nonce: parsedNonce,
      gasPrice: parsedGasPrice,
      deployment: Object.freeze({
        lyquidId: this.expectedLyquidId!,
        contract: this.contractAddress,
        protocolVersion: COOO_PROTOCOL_VERSION,
      }),
    });
  }

  async sendRawTransaction(rawTransaction: Hex, expectedDeployment?: DeploymentIdentity): Promise<Hex> {
    this.requireMutationBinding();
    if (!/^0x(?:02[0-9a-fA-F]{2})?[0-9a-fA-F]{6,}$/.test(rawTransaction)) {
      throw new CoooSdkError('raw transaction must be a hexadecimal envelope', 'invalid_argument');
    }
    await this.discover();
    if (expectedDeployment) {
      const actual = {
        lyquidId: this.expectedLyquidId,
        contract: this.contractAddress,
        protocolVersion: COOO_PROTOCOL_VERSION,
      };
      if (actual.lyquidId !== expectedDeployment.lyquidId ||
          actual.contract?.toLowerCase() !== expectedDeployment.contract?.toLowerCase() ||
          actual.protocolVersion !== expectedDeployment.protocolVersion) {
        throw new CoooSdkError('raw transaction deployment binding changed before submission', 'state_validation', {
          expectedDeployment,
          actualDeployment: {
            lyquidId: this.expectedLyquidId,
            contract: this.contractAddress,
            protocolVersion: COOO_PROTOCOL_VERSION,
          },
        });
      }
    }
    if (this.expectedLyquidId !== undefined || this.expectedContract !== undefined) await this.getState();
    const hash = await this.rpc('eth_sendRawTransaction', [rawTransaction]);
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new CoooSdkError('eth_sendRawTransaction did not return a 32-byte hash', 'rpc_error');
    }
    return hash;
  }

  async submitRawTransaction(
    rawTransaction: Hex,
    expectedDeployment?: DeploymentIdentity,
  ): Promise<TransactionSubmission> {
    const transactionHash = await this.sendRawTransaction(rawTransaction, expectedDeployment);
    return Object.freeze({ status: 'submitted', transactionHash });
  }

  async send(
    method: CoooMethod,
    from: Address,
    types: readonly string[],
    values: readonly AbiValue[],
  ): Promise<Hex> {
    this.requireMutationBinding();
    await this.discover();
    assertAddress(from, 'from');
    const data = SELECTORS[method] + encodeParameters(types, values);
    if (this.expectedLyquidId !== undefined || this.expectedContract !== undefined) await this.getState();
    return await this.unlockedDevelopmentSubmit({
      from, to: this.contractAddress, data, gas: '0x249f00',
      deployment: {
        lyquidId: this.expectedLyquidId!,
        contract: this.contractAddress,
        protocolVersion: COOO_PROTOCOL_VERSION,
      },
    });
  }

  private async unlockedDevelopmentSubmit(transaction: PreparedTransaction): Promise<Hex> {
    if (this.transactionSender) {
      const hash = await this.transactionSender(transaction);
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new CoooSdkError('signer returned an invalid transaction hash', 'rpc_error', { transaction });
      }
      return hash;
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.rpcUrl).hostname)) {
      throw new CoooSdkError('unlocked submission is restricted to loopback development endpoints; configure an external signer', 'invalid_argument');
    }
    const hash = await this.rpc('eth_sendTransaction', [{
      from: transaction.from,
      to: transaction.to,
      data: transaction.data,
      gas: transaction.gas,
    }]);
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new CoooSdkError('JSON-RPC result is not a 32-byte transaction hash', 'rpc_error');
    }
    return hash;
  }
  async deposit(from: Address, operationId: string, amount: Uint256): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertAmount(amount, 'amount');
    return this.send('deposit', from, ['string', 'uint256'], [operationId, amount]);
  }

  async grantAuthority(
    from: Address,
    operationId: string,
    provider: Address,
    scopes: readonly string[],
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    scopes.forEach(assertScope);
    return this.send('grantAuthority', from, ['string', 'address', 'string[]'], [operationId, provider, scopes]);
  }

  async createTask(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
    amount: Uint256,
    cancellationFee: Uint256,
    expectedDigest: Hex,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertAmount(amount, 'amount');
    assertAmount(cancellationFee, 'cancellationFee');
    assertIdentifier(taskId, 'taskId');
    return this.send(
      'create',
      from,
      ['string', 'string', 'address', 'uint256', 'uint256', 'bytes32'],
      [operationId, taskId, provider, amount, cancellationFee, expectedDigest],
    );
  }

  async allocateChild(
    from: Address,
    operationId: string,
    parentId: string,
    childId: string,
    provider: Address,
    amount: Uint256,
    cancellationFee: Uint256,
    expectedDigest: Hex,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertAmount(amount, 'amount');
    assertAmount(cancellationFee, 'cancellationFee');
    assertIdentifier(parentId, 'parentId');
    assertIdentifier(childId, 'childId');
    return this.send(
      'delegate',
      from,
      ['string', 'string', 'string', 'address', 'uint256', 'uint256', 'bytes32'],
      [operationId, parentId, childId, provider, amount, cancellationFee, expectedDigest],
    );
  }

  async dispatchTask(from: Address, operationId: string, taskId: string): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('dispatch', from, ['string', 'string'], [operationId, taskId]);
  }

  async deliverTask(from: Address, operationId: string, taskId: string, digest: Hex): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('deliver', from, ['string', 'string', 'bytes32'], [operationId, taskId, digest]);
  }

  async acceptTask(from: Address, operationId: string, taskId: string): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('accept', from, ['string', 'string'], [operationId, taskId]);
  }

  async withdrawTask(from: Address, operationId: string, taskId: string): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('withdraw', from, ['string', 'string'], [operationId, taskId]);
  }

  async assignProvider(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
    amount: Uint256,
    digest: Hex,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    assertAmount(amount, 'amount');
    return this.send(
      'assignProvider',
      from,
      ['string', 'string', 'address', 'uint256', 'bytes32'],
      [operationId, taskId, provider, amount, digest],
    );
  }

  async dispatchProvider(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('dispatchProvider', from, ['string', 'string', 'address'], [operationId, taskId, provider]);
  }

  async deliverProvider(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
    digest: Hex,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send(
      'deliverProvider',
      from,
      ['string', 'string', 'address', 'bytes32'],
      [operationId, taskId, provider, digest],
    );
  }

  async acceptProvider(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('acceptProvider', from, ['string', 'string', 'address'], [operationId, taskId, provider]);
  }

  async withdrawProvider(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('withdrawProvider', from, ['string', 'string', 'address'], [operationId, taskId, provider]);
  }

  async cancel(from: Address, operationId: string, taskId: string): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send('cancel', from, ['string', 'string'], [operationId, taskId]);
  }

  async createReviewedTask(
    from: Address,
    operationId: string,
    taskId: string,
    provider: Address,
    amount: Uint256,
    cancellationFee: Uint256,
    expectedDigest: Hex,
    reviewThreshold: bigint,
    termsVersion: bigint,
    termsDigest: Hex,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    assertAmount(amount, 'amount');
    assertAmount(cancellationFee, 'cancellationFee');
    assertSmallUint(reviewThreshold, 'reviewThreshold');
    assertSmallUint(termsVersion, 'termsVersion');
    return this.send(
      'createReviewedTask',
      from,
      ['string', 'string', 'address', 'uint256', 'uint256', 'bytes32', 'uint256', 'uint256', 'bytes32'],
      [operationId, taskId, provider, amount, cancellationFee, expectedDigest, reviewThreshold, termsVersion, termsDigest],
    );
  }

  async assignVerifier(
    from: Address,
    operationId: string,
    taskId: string,
    producer: Address,
    verifier: Address,
    reward: Uint256,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    assertAmount(reward, 'reward');
    return this.send(
      'assignVerifier',
      from,
      ['string', 'string', 'address', 'address', 'uint256'],
      [operationId, taskId, producer, verifier, reward],
    );
  }

  async submitVerifierResult(
    from: Address,
    operationId: string,
    taskId: string,
    producer: Address,
    verifier: Address,
    termsVersion: bigint,
    termsDigest: Hex,
    evidenceDigest: Hex,
    approved: boolean,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    assertSmallUint(termsVersion, 'termsVersion');
    return this.send(
      'submitVerifierResult',
      from,
      ['string', 'string', 'address', 'address', 'uint256', 'bytes32', 'bytes32', 'bool'],
      [operationId, taskId, producer, verifier, termsVersion, termsDigest, evidenceDigest, approved],
    );
  }

  async revokeReviewer(
    from: Address,
    operationId: string,
    taskId: string,
    producer: Address,
    verifier: Address,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send(
      'revokeReviewer',
      from,
      ['string', 'string', 'address', 'address'],
      [operationId, taskId, producer, verifier],
    );
  }

  async withdrawVerifierReward(
    from: Address,
    operationId: string,
    taskId: string,
    producer: Address,
    verifier: Address,
  ): Promise<Hex> {
    assertIdentifier(operationId, 'operationId');
    assertIdentifier(taskId, 'taskId');
    return this.send(
      'withdrawVerifierReward',
      from,
      ['string', 'string', 'address', 'address'],
      [operationId, taskId, producer, verifier],
    );
  }
}

