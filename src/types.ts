export type Address = string;
export type Hex = string;
export type Uint256 = bigint;

export const COOO_PROTOCOL_VERSION = 'cooo-local-v0.3-terms-bound-review' as const;

export interface LyquidMetadata {
  readonly backend_contract?: string;
  readonly contract?: string;
  readonly lyquid_id?: string;
  readonly lyquidId?: string;
}

export interface LedgerState {
  readonly totalDeposits: string;
  readonly balancesTotal: string;
  readonly reserved: string;
  readonly earnedClaims: string;
  readonly completedPayouts: string;
  readonly completedRefunds: string;
  readonly platformFees: string;
  readonly conserved: boolean;
}

export interface AssetState {
  readonly id: string;
  readonly precision: number;
  readonly synthetic: boolean;
}

export interface WalletState {
  readonly account: Address;
  readonly amount: string;
}

export interface TaskState {
  readonly id: string;
  readonly parent: string;
  readonly children: readonly string[];
  readonly executionState: number;
  readonly paymentState: number;
  readonly providers?: readonly ProviderState[];
  readonly verifications?: readonly VerificationState[];
  readonly termsVersion?: number;
  readonly termsDigest?: string;
}

export interface ProviderState {
  readonly provider: Address;
  readonly executionState: number;
  readonly paymentState: number;
}

export interface AuthorityGrantState {
  readonly provider: Address;
  readonly scopes: readonly string[];
}

export interface VerificationState {
  readonly producer: Address;
  readonly verifier: Address;
  readonly effectiveScope: string;
  readonly reward: string;
  readonly approved?: boolean | null;
  readonly authorityEpoch: number;
  readonly revoked: boolean;
  readonly paymentState: number;
}

export interface DeploymentIdentity {
  readonly lyquidId: string;
  readonly contract?: Address;
  readonly protocolVersion: string;
}

/** An external wallet/agent owns keys and submits the exact prepared transaction. */
export interface PreparedTransaction {
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly gas: Hex;
  readonly deployment: DeploymentIdentity;
}

/** Exact legacy transaction fields supplied to a caller-held signing adapter. */
export interface SignableTransaction extends PreparedTransaction {
  readonly chainId: bigint;
  readonly nonce: bigint;
  readonly gasPrice: bigint;
}

export interface OperationState {
  readonly caller: Address;
  readonly operationId: string;
  readonly action: number;
  readonly taskId: string;
  readonly parentId: string;
  readonly provider: Address;
  readonly counterparty: Address;
  readonly amount: string;
  readonly cancellationFee: string;
  readonly digest: Hex;
  readonly scopes: readonly string[];
}

export interface CoooState {
  readonly deployment?: DeploymentIdentity;
  readonly ledger: LedgerState;
  readonly asset?: AssetState;
  readonly balances?: readonly WalletState[];
  readonly tasks: readonly TaskState[];
  readonly authorityGrants?: readonly AuthorityGrantState[];
  readonly operations?: readonly OperationState[];
}

export interface CoooSdkOptions {
  readonly rpcUrl: string;
  readonly infoUrl: string;
  readonly stateUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly expectedLyquidId?: string;
  readonly expectedContract?: string;
  readonly transactionSender?: (transaction: PreparedTransaction) => Promise<Hex>;
}

export interface TransactionSubmission {
  readonly status: 'submitted';
  readonly transactionHash: Hex;
}

export type ExpectedOperationIntent = Readonly<Partial<OperationState>>;

export interface OperationConfirmation {
  readonly operation: OperationState;
  readonly state: CoooState;
}
