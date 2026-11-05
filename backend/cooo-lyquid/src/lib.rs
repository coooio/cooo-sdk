//! cooo local demo Lyquid.
//!
//! This single Lyquid is the authoritative boundary for the local prototype:
//! it owns synthetic asset accounting, task terms, delegation, execution state,
//! payment state, deterministic acceptance, cancellation, and payout records.
//! It intentionally has no external model, tool, wallet, or production custody
//! dependency. The hosted UI is a local demo, not a production application.

use lyquid::prelude::*;
use lyquor_primitives::B256;
use serde::{Deserialize, Serialize};

const ASSET_ID: &str = "LOCAL-TEST-USD";
const ASSET_PRECISION: u8 = 8;

// Numeric states are used at the ABI boundary so browsers can map them to
// explicit labels without decoding nested Rust enums.
const EXECUTION_CREATED: u8 = 0;
const EXECUTION_DISPATCHED: u8 = 1;
const EXECUTION_DELIVERED: u8 = 2;
const EXECUTION_ACCEPTED: u8 = 3;
const EXECUTION_CANCELLED: u8 = 4;

const PAYMENT_RESERVED: u8 = 0;
const PAYMENT_DELEGATED: u8 = 1;
const PAYMENT_EARNED: u8 = 2;
const PAYMENT_PAID: u8 = 3;
const PAYMENT_REFUNDED: u8 = 4;
const PAYMENT_CANCELLED: u8 = 5;
const EXECUTION_HANDED_OFF: u8 = 5;
const PAYMENT_HANDED_OFF: u8 = 6;
const EFFECT_PENDING: u8 = 0;
const EFFECT_STARTED: u8 = 1;
const EFFECT_UNKNOWN: u8 = 2;
const EFFECT_FAILED: u8 = 3;
const EFFECT_TERMINAL: u8 = 4;
const OFFER_SUBMITTED: u8 = 0;
const OFFER_SELECTED: u8 = 1;
const OFFER_REJECTED: u8 = 2;
const PAYMENT_OPEN: u8 = 7;

fn default_terms_version() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TaskRecord {
    payer: Address,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
    #[serde(default = "default_terms_version")]
    terms_version: u64,
    #[serde(default)]
    terms_digest: B256,
    evidence: B256,
    parent_id: String,
    child_ids: Vec<String>,
    remaining_allocation: U256,
    earned_claim: U256,
    execution_state: u8,
    payment_state: u8,
    required_scope: String,
    provider_allocation_remaining: U256,
    provider_epoch: u64,
    review_threshold: u64,
    authority_scopes: Vec<String>,
    authority_depth: u64,
    authority_epoch: u64,
    authority_revoked: bool,
    created_sequence: u64,
    updated_sequence: u64,
}

/// Isolated work and payment state for one provider attached to one task.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProviderRecord {
    provider: Address,
    effective_scope: String,
    amount: U256,
    expected_digest: B256,
    evidence: B256,
    execution_state: u8,
    payment_state: u8,
    authority_epoch: u64,
    created_sequence: u64,
    updated_sequence: u64,
}

impl ProviderRecord {
    fn is_terminal(&self) -> bool {
        self.payment_state == PAYMENT_PAID
            || self.payment_state == PAYMENT_CANCELLED
            || self.payment_state == PAYMENT_HANDED_OFF
    }
}

/// Independent verification work attached to one producer assignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VerificationRecord {
    producer: Address,
    verifier: Address,
    effective_scope: String,
    reward: U256,
    approved: Option<bool>,
    payment_state: u8,
    authority_epoch: u64,
    revoked: bool,
    created_sequence: u64,
    updated_sequence: u64,
}

impl VerificationRecord {
    fn is_terminal(&self) -> bool {
        self.payment_state == PAYMENT_PAID || self.payment_state == PAYMENT_CANCELLED
    }
}

/// One private adjudication result; only a certificate commitment is stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConfidentialOutcomeRecord {
    adjudicator: Address,
    certificate: B256,
    approved: bool,
    created_sequence: u64,
}

/// Bounded authoritative metadata for off-chain confidential evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConfidentialEvidenceRecord {
    producer: Address,
    digest: B256,
    size_bytes: U256,
    access_policy: Vec<Address>,
    outcomes: Vec<ConfidentialOutcomeRecord>,
    created_sequence: u64,
    updated_sequence: u64,
}
/// Durable state for one non-idempotent external action.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExternalEffectRecord {
    provider: Address,
    nonce: U256,
    state: u8,
    receipt: B256,
    attempts: U256,
    created_sequence: u64,
    updated_sequence: u64,
}

impl ExternalEffectRecord {
    fn is_terminal(&self) -> bool {
        self.state == EFFECT_TERMINAL
    }
}

/// A committed competitive offer for one provider and terms version.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct OfferRecord {
    provider: Address,
    terms_version: u64,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
    status: u8,
    created_sequence: u64,
    updated_sequence: u64,
}

/// An explicit funding lineage from one parent task to a shared dependency.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DependencyShareRecord {
    parent_id: String,
    dependency_id: String,
    amount: U256,
    created_sequence: u64,
}

impl TaskRecord {
    fn has_terminal_children(&self, tasks: &HashMap<String, TaskRecord>) -> bool {
        self.child_ids.iter().all(|child_id| {
            tasks.get(child_id).map_or(false, |child| {
                matches!(
                    child.payment_state,
                    PAYMENT_PAID | PAYMENT_REFUNDED | PAYMENT_CANCELLED
                )
            })
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct OperationIntent {
    action: u8,
    task_id: String,
    parent_id: String,
    provider: Address,
    counterparty: Address,
    amount: U256,
    cancellation_fee: U256,
    digest: B256,
    scopes: Vec<String>,
}

impl OperationIntent {
    fn deposit(amount: U256) -> Self {
        Self {
            action: 0,
            task_id: String::new(),
            parent_id: String::new(),
            provider: Address::ZERO,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn authority(provider: Address, scopes: Vec<String>) -> Self {
        Self {
            action: 8,
            task_id: String::new(),
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount: U256::ZERO,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes,
        }
    }

    fn provider_assignment(task_id: String, provider: Address, amount: U256, digest: B256) -> Self {
        Self {
            action: 9,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee: U256::ZERO,
            digest,
            scopes: Vec::new(),
        }
    }

    fn provider_execution(action: u8, task_id: String, provider: Address, digest: B256) -> Self {
        Self {
            action,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount: U256::ZERO,
            cancellation_fee: U256::ZERO,
            digest,
            scopes: Vec::new(),
        }
    }

    fn provider_settlement(action: u8, task_id: String, provider: Address, amount: U256) -> Self {
        Self {
            action,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn offer(
        action: u8,
        task_id: String,
        provider: Address,
        terms_version: u64,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
    ) -> Self {
        Self {
            action,
            task_id,
            parent_id: terms_version.to_string(),
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes: Vec::new(),
        }
    }

    fn external_effect(action: u8, task_id: String, provider: Address, value: U256) -> Self {
        Self {
            action,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount: value,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn dependency_share(task_id: String, dependency_id: String, amount: U256) -> Self {
        Self {
            action: 26,
            task_id,
            parent_id: dependency_id,
            provider: Address::ZERO,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn reviewed_task(
        task_id: String,
        provider: Address,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
        review_threshold: u64,
        terms_version: u64,
        terms_digest: B256,
    ) -> Self {
        Self {
            action: 27,
            parent_id: review_threshold.to_string(),
            task_id,
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes: vec![
                format!("terms-version:{terms_version}"),
                format!("terms-digest:{terms_digest:#x}"),
            ],
        }
    }

    fn reviewer_revocation(task_id: String, producer: Address, verifier: Address) -> Self {
        Self {
            action: 28,
            task_id,
            parent_id: String::new(),
            provider: verifier,
            counterparty: producer,
            amount: U256::ZERO,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }
    fn verification_assignment(
        task_id: String,
        producer: Address,
        verifier: Address,
        reward: U256,
    ) -> Self {
        Self {
            action: 15,
            task_id,
            parent_id: String::new(),
            provider: verifier,
            counterparty: producer,
            amount: reward,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn verification_result(
        task_id: String,
        producer: Address,
        verifier: Address,
        terms_version: u64,
        terms_digest: B256,
        evidence_digest: B256,
        approved: bool,
    ) -> Self {
        Self {
            action: 16,
            task_id,
            parent_id: terms_version.to_string(),
            provider: verifier,
            counterparty: producer,
            amount: U256::from(u8::from(approved)),
            cancellation_fee: U256::ZERO,
            digest: evidence_digest,
            scopes: vec![format!("terms-digest:{terms_digest:#x}")],
        }
    }

    fn verification_withdrawal(
        task_id: String,
        producer: Address,
        verifier: Address,
        reward: U256,
    ) -> Self {
        Self {
            action: 17,
            task_id,
            parent_id: String::new(),
            provider: verifier,
            counterparty: producer,
            amount: reward,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }

    fn provider_handoff(
        task_id: String,
        from_provider: Address,
        to_provider: Address,
        amount: U256,
        digest: B256,
    ) -> Self {
        Self {
            action: 14,
            task_id,
            parent_id: String::new(),
            provider: from_provider,
            counterparty: to_provider,
            amount,
            cancellation_fee: U256::ZERO,
            digest,
            scopes: Vec::new(),
        }
    }

    fn create(
        task_id: String,
        provider: Address,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
    ) -> Self {
        Self {
            action: 1,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes: Vec::new(),
        }
    }

    fn delegate(
        task_id: String,
        parent_id: String,
        provider: Address,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
    ) -> Self {
        Self {
            action: 2,
            task_id,
            parent_id,
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes: Vec::new(),
        }
    }

    fn scoped_root(
        task_id: String,
        provider: Address,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
        scopes: Vec<String>,
    ) -> Self {
        Self {
            action: 31,
            task_id,
            parent_id: String::new(),
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes,
        }
    }
    fn scoped_delegate(
        task_id: String,
        parent_id: String,
        provider: Address,
        amount: U256,
        cancellation_fee: U256,
        digest: B256,
        scopes: Vec<String>,
    ) -> Self {
        Self {
            action: 29,
            task_id,
            parent_id,
            provider,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee,
            digest,
            scopes,
        }
    }

    fn confidential_commitment(
        task_id: String,
        producer: Address,
        digest: B256,
        size_bytes: U256,
        access_policy: Vec<String>,
    ) -> Self {
        Self {
            action: 32,
            task_id,
            parent_id: String::new(),
            provider: producer,
            counterparty: Address::ZERO,
            amount: size_bytes,
            cancellation_fee: U256::ZERO,
            digest,
            scopes: access_policy,
        }
    }

    fn confidential_outcome(
        task_id: String,
        producer: Address,
        adjudicator: Address,
        certificate: B256,
        approved: bool,
    ) -> Self {
        Self {
            action: 33,
            task_id,
            parent_id: String::new(),
            provider: producer,
            counterparty: adjudicator,
            amount: U256::from(u8::from(approved)),
            cancellation_fee: U256::ZERO,
            digest: certificate,
            scopes: Vec::new(),
        }
    }
    fn authority_revocation(task_id: String) -> Self {
        Self {
            action: 30,
            task_id,
            parent_id: String::new(),
            provider: Address::ZERO,
            counterparty: Address::ZERO,
            amount: U256::ZERO,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }
    fn execution(action: u8, task_id: String, digest: B256) -> Self {
        Self {
            action,
            task_id,
            parent_id: String::new(),
            provider: Address::ZERO,
            counterparty: Address::ZERO,
            amount: U256::ZERO,
            cancellation_fee: U256::ZERO,
            digest,
            scopes: Vec::new(),
        }
    }

    fn settlement(action: u8, task_id: String, amount: U256) -> Self {
        Self {
            action,
            task_id,
            parent_id: String::new(),
            provider: Address::ZERO,
            counterparty: Address::ZERO,
            amount,
            cancellation_fee: U256::ZERO,
            digest: B256::ZERO,
            scopes: Vec::new(),
        }
    }
}

fn runtime_error(message: impl Into<String>) -> LyquidError {
    LyquidError::LyquorRuntime(message.into())
}

fn require_nonempty_id(value: &str, label: &str) -> LyquidResult<()> {
    if value.trim().is_empty() {
        return Err(runtime_error(format!("{label} cannot be empty")));
    }
    Ok(())
}

fn checked_add(left: U256, right: U256, label: &str) -> LyquidResult<U256> {
    left.checked_add(right)
        .ok_or_else(|| runtime_error(format!("{label} overflow")))
}

fn checked_sub(left: U256, right: U256, label: &str) -> LyquidResult<U256> {
    left.checked_sub(right)
        .ok_or_else(|| runtime_error(format!("{label} underflow")))
}

fn next_sequence(state: &mut __lyquid::NetworkState) -> LyquidResult<u64> {
    let value = state
        .sequence
        .checked_add(1)
        .ok_or_else(|| runtime_error("sequence overflow"))?;
    *state.sequence = value;
    Ok(value)
}

// The operation record is inserted before the state mutation. Lyquid network
// calls are atomic: if validation later fails, both the intent record and the
// partial mutation revert together. Identical retries return true without a
// second economic transition; changed payloads are explicit conflicts.
fn record_intent(
    state: &mut __lyquid::NetworkState,
    caller: Address,
    operation_id: &str,
    intent: &OperationIntent,
) -> LyquidResult<bool> {
    require_nonempty_id(operation_id, "operation id")?;
    let key = (caller, operation_id.to_string());
    if let Some(existing) = state.operations.get(&key) {
        if *existing == *intent {
            return Ok(true);
        }
        return Err(runtime_error("operation id reused with a different intent"));
    }
    state.operations.insert(key, OperationIntent::clone(intent));
    Ok(false)
}

fn balance_mut<'a>(state: &'a mut __lyquid::NetworkState, account: &Address) -> &'a mut U256 {
    state.balances.entry(*account).or_insert(U256::ZERO)
}

fn task_mut<'a>(
    state: &'a mut __lyquid::NetworkState,
    task_id: &str,
) -> LyquidResult<&'a mut TaskRecord> {
    state
        .tasks
        .get_mut(task_id)
        .ok_or_else(|| runtime_error("task not found"))
}

fn authority_chain(state: &__lyquid::NetworkState, task_id: &str) -> LyquidResult<Vec<TaskRecord>> {
    let mut chain = Vec::new();
    let mut current_id = task_id.to_string();
    let mut current = state
        .tasks
        .get(&current_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    let mut visited = std::collections::HashSet::new();
    loop {
        if !visited.insert(current_id.clone()) {
            return Err(runtime_error("authority chain contains a cycle"));
        }
        let parent_id = current.parent_id.clone();
        chain.push(current);
        if parent_id.is_empty() {
            return Ok(chain);
        }
        current_id = parent_id.clone();
        current = state
            .tasks
            .get(&current_id)
            .cloned()
            .ok_or_else(|| runtime_error("authority parent not found"))?;
    }
}

fn ensure_authority_chain_active(
    state: &__lyquid::NetworkState,
    task_id: &str,
) -> LyquidResult<()> {
    if authority_chain(state, task_id)?
        .iter()
        .any(|task| task.authority_revoked)
    {
        return Err(runtime_error("ancestor authority is revoked"));
    }
    Ok(())
}

fn intersect_authority_scopes(
    parent_scopes: &[String],
    requested: &[String],
    granted: &[String],
) -> Vec<String> {
    let mut effective = parent_scopes
        .iter()
        .filter(|scope| requested.contains(scope) && granted.contains(scope))
        .cloned()
        .collect::<Vec<_>>();
    effective.sort();
    effective.dedup();
    effective
}

fn descendant_task_ids(state: &__lyquid::NetworkState, task_id: &str) -> Vec<String> {
    let mut stack = vec![task_id.to_string()];
    let mut visited = std::collections::HashSet::new();
    let mut descendants = Vec::new();
    while let Some(current_id) = stack.pop() {
        if !visited.insert(current_id.clone()) {
            continue;
        }
        if let Some(task) = state.tasks.get(&current_id) {
            for child_id in &task.child_ids {
                stack.push(child_id.clone());
            }
        }
        if current_id != task_id {
            descendants.push(current_id);
        }
    }
    descendants
}
fn validate_terms(amount: U256, cancellation_fee: U256, digest: B256) -> LyquidResult<()> {
    if amount == U256::ZERO {
        return Err(runtime_error("task amount must be greater than zero"));
    }
    if cancellation_fee > amount {
        return Err(runtime_error("cancellation fee exceeds task amount"));
    }
    if digest == B256::ZERO {
        return Err(runtime_error("expected digest cannot be zero"));
    }
    Ok(())
}

state! {
    network operator: Address = Address::ZERO;
    network asset_id: String = ASSET_ID.to_string();
    network asset_precision: u8 = ASSET_PRECISION;
    network sequence: u64 = 0;
    network total_deposits: U256 = U256::ZERO;
    network reserved: U256 = U256::ZERO;
    network earned_claims: U256 = U256::ZERO;
    network completed_payouts: U256 = U256::ZERO;
    network completed_refunds: U256 = U256::ZERO;
    network platform_fees: U256 = U256::ZERO;
    network balances: HashMap<Address, U256> = new_hashmap();
    network tasks: HashMap<String, TaskRecord> = new_hashmap();
    network root_task_ids: Vec<String> = Vec::new();
    network operations: HashMap<(Address, String), OperationIntent> = new_hashmap();
    network authority_grants: HashMap<Address, Vec<String>> = new_hashmap();
    network provider_records: HashMap<(String, Address), ProviderRecord> = new_hashmap();
    network verification_records: HashMap<(String, Address, Address), VerificationRecord> = new_hashmap();
    network external_effects: HashMap<(String, Address), ExternalEffectRecord> = new_hashmap();
    network used_effect_nonces: HashMap<U256, bool> = new_hashmap();
    network offers: HashMap<(String, Address, u64), OfferRecord> = new_hashmap();
    network dependency_shares: HashMap<(String, String), DependencyShareRecord> = new_hashmap();
    network confidential_evidence: HashMap<(String, Address), ConfidentialEvidenceRecord> = new_hashmap();
}

#[method::network(export = eth)]
fn constructor(ctx: &mut _) {
    *ctx.network.operator = ctx.caller;
}

#[method::network(export = eth)]
fn deposit(ctx: &mut _, operation_id: String, amount: U256) -> LyquidResult<bool> {
    if record_intent(
        &mut ctx.network,
        ctx.caller,
        &operation_id,
        &OperationIntent::deposit(amount),
    )? {
        return Ok(true);
    }
    if amount == U256::ZERO {
        return Err(runtime_error("deposit amount must be greater than zero"));
    }

    let account = balance_mut(&mut ctx.network, &ctx.caller);
    *account = checked_add(*account, amount, "account balance")?;
    *ctx.network.total_deposits =
        checked_add(*ctx.network.total_deposits, amount, "total deposits")?;
    next_sequence(&mut ctx.network)?;
    Ok(true)
}

#[method::network(export = eth)]
fn create_task(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::create(
        task_id.clone(),
        provider,
        amount,
        cancellation_fee,
        expected_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&task_id, "task id")?;
    validate_terms(amount, cancellation_fee, expected_digest)?;
    if ctx.network.tasks.contains_key(&task_id) {
        return Err(runtime_error("task id already exists"));
    }
    let payer = ctx.caller;
    let available = balance_mut(&mut ctx.network, &payer);
    if *available < amount {
        return Err(runtime_error("insufficient available funds"));
    }
    *available = checked_sub(*available, amount, "payer balance")?;
    *ctx.network.reserved = checked_add(*ctx.network.reserved, amount, "reservation")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = TaskRecord {
        payer,
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        terms_version: 1,
        terms_digest: B256::ZERO,
        evidence: B256::ZERO,
        parent_id: String::new(),
        child_ids: Vec::new(),
        remaining_allocation: amount,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        required_scope: "work:data".to_string(),
        provider_allocation_remaining: amount,
        provider_epoch: 0,
        review_threshold: 1,
        authority_scopes: vec!["work:data".to_string()],
        authority_depth: 0,
        authority_epoch: 0,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(task_id.clone(), task);
    ctx.network.root_task_ids.push(task_id);
    Ok(true)
}

#[method::network(export = eth)]
fn create_reviewed_task(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
    review_threshold: U256,
    terms_version: U256,
    terms_digest: B256,
) -> LyquidResult<bool> {
    if review_threshold.is_zero() || review_threshold > U256::from(u64::MAX) {
        return Err(runtime_error("review threshold is outside uint64 range"));
    }
    if terms_version.is_zero() || terms_version > U256::from(u64::MAX) {
        return Err(runtime_error("terms version is outside uint64 range"));
    }
    if terms_digest == B256::ZERO {
        return Err(runtime_error("terms digest must be a nonzero commitment"));
    }
    let review_threshold = review_threshold.to::<u64>();
    let terms_version = terms_version.to::<u64>();
    let intent = OperationIntent::reviewed_task(
        task_id.clone(),
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        review_threshold,
        terms_version,
        terms_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&task_id, "reviewed task id")?;
    validate_terms(amount, cancellation_fee, expected_digest)?;
    if ctx.network.tasks.contains_key(&task_id) {
        return Err(runtime_error("task id already exists"));
    }
    let payer = ctx.caller;
    let available = balance_mut(&mut ctx.network, &payer);
    if *available < amount {
        return Err(runtime_error("insufficient available funds"));
    }
    *available = checked_sub(*available, amount, "payer balance")?;
    *ctx.network.reserved = checked_add(*ctx.network.reserved, amount, "reservation")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = TaskRecord {
        payer,
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        terms_version,
        terms_digest,
        evidence: B256::ZERO,
        parent_id: String::new(),
        child_ids: Vec::new(),
        remaining_allocation: amount,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        required_scope: "work:data".to_string(),
        provider_allocation_remaining: amount,
        provider_epoch: 0,
        review_threshold,
        authority_scopes: vec!["work:data".to_string()],
        authority_depth: 0,
        authority_epoch: 0,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(task_id.clone(), task);
    ctx.network.root_task_ids.push(task_id);
    Ok(true)
}
#[method::network(export = eth)]
fn allocate_child(
    ctx: &mut _,
    operation_id: String,
    parent_id: String,
    child_id: String,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::delegate(
        child_id.clone(),
        parent_id.clone(),
        provider,
        amount,
        cancellation_fee,
        expected_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&child_id, "child task id")?;
    require_nonempty_id(&parent_id, "parent task id")?;
    validate_terms(amount, cancellation_fee, expected_digest)?;
    if ctx.network.tasks.contains_key(&child_id) || parent_id == child_id {
        return Err(runtime_error("child task id already exists"));
    }
    let caller = ctx.caller;
    let parent_snapshot = ctx
        .network
        .tasks
        .get(&parent_id)
        .cloned()
        .ok_or_else(|| runtime_error("parent task not found"))?;
    ensure_authority_chain_active(&ctx.network, &parent_id)?;
    if parent_snapshot.provider != caller {
        return Err(runtime_error("only the parent provider can delegate"));
    }
    if !matches!(
        (
            parent_snapshot.execution_state,
            parent_snapshot.payment_state
        ),
        (EXECUTION_CREATED, PAYMENT_RESERVED)
            | (EXECUTION_CREATED, PAYMENT_DELEGATED)
            | (EXECUTION_DISPATCHED, PAYMENT_RESERVED)
            | (EXECUTION_DISPATCHED, PAYMENT_DELEGATED)
    ) {
        return Err(runtime_error(
            "parent cannot accept new delegated commitments",
        ));
    }
    if parent_snapshot.remaining_allocation < amount {
        return Err(runtime_error("child amount exceeds parent remainder"));
    }
    let direct_floor = if parent_snapshot.child_ids.is_empty() {
        parent_snapshot.cancellation_fee
    } else {
        U256::ZERO
    };
    if parent_snapshot.remaining_allocation - amount < direct_floor {
        return Err(runtime_error(
            "delegation would leave cancellation fee unfunded",
        ));
    }

    let sequence = next_sequence(&mut ctx.network)?;
    let parent = task_mut(&mut ctx.network, &parent_id)?;
    parent.remaining_allocation =
        checked_sub(parent.remaining_allocation, amount, "parent remainder")?;
    parent.child_ids.push(child_id.clone());
    parent.payment_state = PAYMENT_DELEGATED;
    parent.updated_sequence = sequence;

    let child = TaskRecord {
        payer: parent_snapshot.provider,
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        terms_version: 1,
        terms_digest: B256::ZERO,
        evidence: B256::ZERO,
        parent_id: parent_id.clone(),
        child_ids: Vec::new(),
        remaining_allocation: amount,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        required_scope: "work:data".to_string(),
        provider_allocation_remaining: amount,
        provider_epoch: 0,
        review_threshold: 1,
        authority_scopes: parent_snapshot
            .authority_scopes
            .iter()
            .filter(|scope| **scope == "work:data")
            .cloned()
            .collect::<Vec<_>>(),
        authority_depth: parent_snapshot.authority_depth + 1,
        authority_epoch: parent_snapshot.authority_epoch,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(child_id, child);
    Ok(true)
}

#[method::network(export = eth)]
fn create_scoped_task(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
    requested_scopes: Vec<String>,
) -> LyquidResult<bool> {
    let mut scopes = requested_scopes;
    scopes.sort();
    scopes.dedup();
    let intent = OperationIntent::scoped_root(
        task_id.clone(),
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        scopes.clone(),
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&task_id, "scoped task id")?;
    validate_terms(amount, cancellation_fee, expected_digest)?;
    if provider == Address::ZERO || scopes.is_empty() || scopes.iter().any(|s| s.trim().is_empty())
    {
        return Err(runtime_error("invalid scoped task authority"));
    }
    if ctx.network.tasks.contains_key(&task_id) {
        return Err(runtime_error("task id already exists"));
    }
    let granted = ctx
        .network
        .authority_grants
        .get(&provider)
        .cloned()
        .unwrap_or_default();
    let effective = granted
        .iter()
        .filter(|scope| scopes.contains(scope))
        .cloned()
        .collect::<Vec<_>>();
    if effective.is_empty() {
        return Err(runtime_error(
            "root provider lacks requested authority scopes",
        ));
    }
    let required_scope = effective
        .first()
        .cloned()
        .ok_or_else(|| runtime_error("effective authority scope is empty"))?;
    let payer = ctx.caller;
    let available = balance_mut(&mut ctx.network, &payer);
    if *available < amount {
        return Err(runtime_error("insufficient available funds"));
    }
    *available = checked_sub(*available, amount, "payer balance")?;
    *ctx.network.reserved = checked_add(*ctx.network.reserved, amount, "reservation")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = TaskRecord {
        payer,
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        terms_version: 1,
        terms_digest: B256::ZERO,
        evidence: B256::ZERO,
        parent_id: String::new(),
        child_ids: Vec::new(),
        remaining_allocation: amount,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        required_scope,
        provider_allocation_remaining: amount,
        provider_epoch: 0,
        review_threshold: 1,
        authority_scopes: effective,
        authority_depth: 0,
        authority_epoch: 0,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(task_id.clone(), task);
    ctx.network.root_task_ids.push(task_id);
    Ok(true)
}

#[method::network(export = eth)]
fn allocate_scoped_child(
    ctx: &mut _,
    operation_id: String,
    parent_id: String,
    child_id: String,
    provider: Address,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
    requested_scopes: Vec<String>,
) -> LyquidResult<bool> {
    let mut scopes = requested_scopes;
    scopes.sort();
    scopes.dedup();
    let intent = OperationIntent::scoped_delegate(
        child_id.clone(),
        parent_id.clone(),
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        scopes.clone(),
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&child_id, "scoped child task id")?;
    require_nonempty_id(&parent_id, "parent task id")?;
    validate_terms(amount, cancellation_fee, expected_digest)?;
    if ctx.network.tasks.contains_key(&child_id)
        || parent_id == child_id
        || provider == Address::ZERO
        || scopes.is_empty()
        || scopes.iter().any(|scope| scope.trim().is_empty())
    {
        return Err(runtime_error("invalid scoped child delegation"));
    }
    let parent_snapshot = ctx
        .network
        .tasks
        .get(&parent_id)
        .cloned()
        .ok_or_else(|| runtime_error("parent task not found"))?;
    ensure_authority_chain_active(&ctx.network, &parent_id)?;
    if parent_snapshot.provider != ctx.caller {
        return Err(runtime_error("only the parent provider can delegate"));
    }
    if parent_snapshot.authority_depth >= 3 {
        return Err(runtime_error(
            "scoped delegation depth exceeds three levels",
        ));
    }
    if !matches!(
        (
            parent_snapshot.execution_state,
            parent_snapshot.payment_state
        ),
        (EXECUTION_CREATED, PAYMENT_RESERVED)
            | (EXECUTION_CREATED, PAYMENT_DELEGATED)
            | (EXECUTION_DISPATCHED, PAYMENT_RESERVED)
            | (EXECUTION_DISPATCHED, PAYMENT_DELEGATED)
    ) {
        return Err(runtime_error(
            "parent cannot accept new delegated commitments",
        ));
    }
    if parent_snapshot.remaining_allocation < amount {
        return Err(runtime_error("child amount exceeds parent spend cap"));
    }
    let direct_floor = if parent_snapshot.child_ids.is_empty() {
        parent_snapshot.cancellation_fee
    } else {
        U256::ZERO
    };
    if parent_snapshot.remaining_allocation - amount < direct_floor {
        return Err(runtime_error(
            "delegation would leave cancellation fee unfunded",
        ));
    }
    let granted = ctx
        .network
        .authority_grants
        .get(&provider)
        .cloned()
        .unwrap_or_default();
    let effective =
        intersect_authority_scopes(&parent_snapshot.authority_scopes, &scopes, &granted);
    if effective.is_empty() {
        return Err(runtime_error(
            "child authority does not intersect every ancestor scope",
        ));
    }
    let required_scope = effective
        .first()
        .cloned()
        .ok_or_else(|| runtime_error("effective child scope is empty"))?;
    let sequence = next_sequence(&mut ctx.network)?;
    let parent = task_mut(&mut ctx.network, &parent_id)?;
    parent.remaining_allocation =
        checked_sub(parent.remaining_allocation, amount, "parent remainder")?;
    parent.child_ids.push(child_id.clone());
    parent.payment_state = PAYMENT_DELEGATED;
    parent.updated_sequence = sequence;
    let child = TaskRecord {
        payer: parent_snapshot.provider,
        provider,
        amount,
        cancellation_fee,
        expected_digest,
        terms_version: 1,
        terms_digest: B256::ZERO,
        evidence: B256::ZERO,
        parent_id: parent_id.clone(),
        child_ids: Vec::new(),
        remaining_allocation: amount,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        required_scope,
        provider_allocation_remaining: amount,
        provider_epoch: 0,
        review_threshold: 1,
        authority_scopes: effective,
        authority_depth: parent_snapshot.authority_depth + 1,
        authority_epoch: parent_snapshot.authority_epoch,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(child_id, child);
    Ok(true)
}

#[method::network(export = eth)]
fn revoke_task_authority(ctx: &mut _, operation_id: String, task_id: String) -> LyquidResult<bool> {
    let intent = OperationIntent::authority_revocation(task_id.clone());
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let snapshot = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    let chain = authority_chain(&ctx.network, &task_id)?;
    if ctx.caller != snapshot.payer
        && ctx.caller != snapshot.provider
        && !chain.iter().any(|task| task.provider == ctx.caller)
    {
        return Err(runtime_error(
            "only an ancestor principal can revoke authority",
        ));
    }
    if snapshot.authority_revoked {
        return Err(runtime_error("task authority is already revoked"));
    }
    let subtree = descendant_task_ids(&ctx.network, &task_id);
    for effect_task_id in std::iter::once(task_id.clone()).chain(subtree.iter().cloned()) {
        if ctx
            .network
            .external_effects
            .iter()
            .any(|((candidate_id, _), record)| {
                candidate_id == &effect_task_id && !record.is_terminal()
            })
        {
            return Err(runtime_error(
                "resolve unresolved external effects before authority revocation",
            ));
        }
    }
    let next_epoch = snapshot
        .authority_epoch
        .checked_add(1)
        .ok_or_else(|| runtime_error("authority epoch overflow"))?;
    let sequence = next_sequence(&mut ctx.network)?;
    for current_id in std::iter::once(task_id.clone()).chain(subtree) {
        let mut current = ctx
            .network
            .tasks
            .get(&current_id)
            .cloned()
            .ok_or_else(|| runtime_error("task not found"))?;
        current.authority_revoked = true;
        current.authority_epoch = next_epoch;
        current.provider_epoch = current
            .provider_epoch
            .checked_add(1)
            .ok_or_else(|| runtime_error("provider epoch overflow"))?;
        let mut returned_provider_allocation = U256::ZERO;
        let provider_keys = ctx
            .network
            .provider_records
            .iter()
            .filter(|((provider_task_id, _), record)| {
                provider_task_id == &current_id && !record.is_terminal()
            })
            .map(|((_, provider), _)| (current_id.clone(), *provider))
            .collect::<Vec<_>>();
        for key in provider_keys {
            if let Some(record) = ctx.network.provider_records.get_mut(&key) {
                returned_provider_allocation = checked_add(
                    returned_provider_allocation,
                    record.amount,
                    "returned provider allocation",
                )?;
                record.execution_state = EXECUTION_CANCELLED;
                record.payment_state = PAYMENT_CANCELLED;
                record.updated_sequence = sequence;
            }
        }
        current.provider_allocation_remaining = checked_add(
            current.provider_allocation_remaining,
            returned_provider_allocation,
            "provider allocation",
        )?;
        let review_keys = ctx
            .network
            .verification_records
            .iter()
            .filter(|((review_task_id, _, _), record)| {
                review_task_id == &current_id
                    && !record.revoked
                    && record.payment_state == PAYMENT_RESERVED
            })
            .map(|((review_task_id, producer, verifier), _)| {
                (review_task_id.clone(), *producer, *verifier)
            })
            .collect::<Vec<_>>();
        let mut returned_review_allocation = U256::ZERO;
        for key in review_keys {
            if let Some(record) = ctx.network.verification_records.get_mut(&key) {
                returned_review_allocation = checked_add(
                    returned_review_allocation,
                    record.reward,
                    "returned reviewer allocation",
                )?;
                record.revoked = true;
                record.payment_state = PAYMENT_CANCELLED;
                record.updated_sequence = sequence;
            }
        }
        current.provider_allocation_remaining = checked_add(
            current.provider_allocation_remaining,
            returned_review_allocation,
            "reviewer allocation",
        )?;
        current.updated_sequence = sequence;
        ctx.network.tasks.insert(current_id, current);
    }
    Ok(true)
}
#[method::network(export = eth)]
fn commit_confidential_evidence(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    evidence_digest: B256,
    size_bytes: U256,
    access_policy: Vec<Address>,
) -> LyquidResult<bool> {
    let mut policy = access_policy;
    policy.sort();
    policy.dedup();
    let intent = OperationIntent::confidential_commitment(
        task_id.clone(),
        producer,
        evidence_digest,
        size_bytes,
        policy
            .iter()
            .map(|address| format!("{address:#x}"))
            .collect(),
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can commit evidence policy",
        ));
    }
    let provider = ctx
        .network
        .provider_records
        .get(&(task_id.clone(), producer))
        .cloned()
        .ok_or_else(|| runtime_error("producer assignment not found"))?;
    if provider.execution_state != EXECUTION_DELIVERED
        || provider.evidence != provider.expected_digest
        || provider.evidence != evidence_digest
    {
        return Err(runtime_error(
            "confidential commitment must match delivered evidence",
        ));
    }
    if evidence_digest == B256::ZERO
        || size_bytes.is_zero()
        || size_bytes > U256::from(1_048_576_u64)
        || policy.is_empty()
        || policy.contains(&producer)
        || policy.contains(&task.payer)
        || policy.contains(&Address::ZERO)
    {
        return Err(runtime_error("invalid confidential evidence commitment"));
    }
    if ctx
        .network
        .confidential_evidence
        .contains_key(&(task_id.clone(), producer))
    {
        return Err(runtime_error("confidential evidence already committed"));
    }
    for adjudicator in &policy {
        let granted = ctx
            .network
            .authority_grants
            .get(adjudicator)
            .cloned()
            .unwrap_or_default();
        if !granted.iter().any(|scope| scope == "adjudicate:private") {
            return Err(runtime_error("adjudicator lacks private evidence scope"));
        }
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let record = ConfidentialEvidenceRecord {
        producer,
        digest: evidence_digest,
        size_bytes,
        access_policy: policy,
        outcomes: Vec::new(),
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network
        .confidential_evidence
        .insert((task_id, producer), record);
    Ok(true)
}

#[method::network(export = eth)]
fn record_confidential_outcome(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    adjudicator: Address,
    certificate: B256,
    approved: bool,
) -> LyquidResult<bool> {
    let intent = OperationIntent::confidential_outcome(
        task_id.clone(),
        producer,
        adjudicator,
        certificate,
        approved,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    let key = (task_id.clone(), producer);
    let mut evidence = ctx
        .network
        .confidential_evidence
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("confidential evidence commitment not found"))?;
    if ctx.caller != adjudicator || !evidence.access_policy.contains(&adjudicator) {
        return Err(runtime_error("caller is not in the evidence access policy"));
    }
    if certificate == B256::ZERO
        || evidence
            .outcomes
            .iter()
            .any(|outcome| outcome.adjudicator == adjudicator)
    {
        return Err(runtime_error("invalid or duplicate adjudication outcome"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    evidence.outcomes.push(ConfidentialOutcomeRecord {
        adjudicator,
        certificate,
        approved,
        created_sequence: sequence,
    });
    evidence.updated_sequence = sequence;
    ctx.network.confidential_evidence.insert(key, evidence);
    Ok(true)
}
#[method::network(export = eth)]
fn dispatch(ctx: &mut _, operation_id: String, task_id: String) -> LyquidResult<bool> {
    let intent = OperationIntent::execution(3, task_id.clone(), B256::ZERO);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let caller = ctx.caller;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = task_mut(&mut ctx.network, &task_id)?;
    if task.provider != caller {
        return Err(runtime_error("only the task provider can dispatch"));
    }
    if task.execution_state != EXECUTION_CREATED {
        return Err(runtime_error("only a created task can be dispatched"));
    }
    task.execution_state = EXECUTION_DISPATCHED;
    task.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn deliver(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    evidence: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::execution(4, task_id.clone(), evidence);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let caller = ctx.caller;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = task_mut(&mut ctx.network, &task_id)?;
    if task.provider != caller {
        return Err(runtime_error("only the task provider can deliver"));
    }
    if task.execution_state != EXECUTION_DISPATCHED {
        return Err(runtime_error("task has not been dispatched"));
    }
    if evidence == B256::ZERO {
        return Err(runtime_error("evidence digest cannot be zero"));
    }
    task.evidence = evidence;
    task.execution_state = EXECUTION_DELIVERED;
    task.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn accept(ctx: &mut _, operation_id: String, task_id: String) -> LyquidResult<bool> {
    let task_snapshot = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    let intent =
        OperationIntent::settlement(5, task_id.clone(), task_snapshot.remaining_allocation);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let caller = ctx.caller;
    if task_snapshot.payer != caller {
        return Err(runtime_error("only the task payer can accept"));
    }
    if task_snapshot.execution_state != EXECUTION_DELIVERED {
        return Err(runtime_error("task has not been delivered"));
    }
    if task_snapshot.evidence != task_snapshot.expected_digest {
        return Err(runtime_error("evidence digest does not match terms"));
    }
    let claim = task_snapshot.remaining_allocation;
    if claim == U256::ZERO {
        return Err(runtime_error("task has no unallocated direct claim"));
    }
    *ctx.network.reserved = checked_sub(*ctx.network.reserved, claim, "reserved funds")?;
    *ctx.network.earned_claims = checked_add(*ctx.network.earned_claims, claim, "earned claims")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = task_mut(&mut ctx.network, &task_id)?;
    task.earned_claim = claim;
    task.remaining_allocation = U256::ZERO;
    task.execution_state = EXECUTION_ACCEPTED;
    task.payment_state = PAYMENT_EARNED;
    task.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn cancel(ctx: &mut _, operation_id: String, task_id: String) -> LyquidResult<bool> {
    let task_snapshot = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    let intent =
        OperationIntent::settlement(6, task_id.clone(), task_snapshot.remaining_allocation);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if task_snapshot.payer != ctx.caller {
        return Err(runtime_error("only the task payer can cancel"));
    }
    if matches!(
        task_snapshot.payment_state,
        PAYMENT_EARNED | PAYMENT_PAID | PAYMENT_REFUNDED | PAYMENT_CANCELLED
    ) {
        return Err(runtime_error("task payment is already terminal"));
    }
    if !task_snapshot.child_ids.is_empty()
        && !task_snapshot.has_terminal_children(&ctx.network.tasks)
    {
        return Err(runtime_error(
            "cancel parent while a child obligation is unresolved",
        ));
    }
    let has_provider_records = ctx
        .network
        .provider_records
        .iter()
        .any(|((provider_task_id, _), _)| provider_task_id == &task_id);
    if has_provider_records {
        let unresolved_provider =
            ctx.network
                .provider_records
                .iter()
                .any(|((provider_task_id, _), record)| {
                    provider_task_id == &task_id && !record.is_terminal()
                });
        if unresolved_provider {
            return Err(runtime_error(
                "cancel task while a provider obligation is unresolved",
            ));
        }
    }
    let unresolved_verifier =
        ctx.network
            .verification_records
            .iter()
            .any(|((verification_task_id, _, _), record)| {
                verification_task_id == &task_id && !record.is_terminal()
            });
    if unresolved_verifier {
        return Err(runtime_error(
            "cancel task while a verifier obligation is unresolved",
        ));
    }
    let has_unresolved_dependents = ctx.network.dependency_shares.values().any(|share| {
        share.dependency_id == task_id
            && !matches!(
                task_snapshot.payment_state,
                PAYMENT_PAID | PAYMENT_REFUNDED | PAYMENT_CANCELLED
            )
    });
    if has_unresolved_dependents {
        return Err(runtime_error(
            "cancel dependency while parent shares are unresolved",
        ));
    }
    let unresolved_effect = ctx
        .network
        .external_effects
        .iter()
        .any(|((effect_task_id, _), record)| effect_task_id == &task_id && !record.is_terminal());
    if unresolved_effect {
        return Err(runtime_error(
            "cancel task while an external effect is unresolved",
        ));
    }
    // Collaborative provider allocations use their own unallocated budget;
    // parent/child tasks continue to use the original remaining allocation.
    let releasable = if has_provider_records {
        task_snapshot.provider_allocation_remaining
    } else {
        task_snapshot.remaining_allocation
    };
    let refund = if releasable == U256::ZERO {
        U256::ZERO
    } else {
        if releasable < task_snapshot.cancellation_fee {
            return Err(runtime_error(
                "remaining funds cannot cover cancellation fee",
            ));
        }
        checked_sub(
            releasable,
            task_snapshot.cancellation_fee,
            "cancellation refund",
        )?
    };
    if releasable > U256::ZERO {
        *ctx.network.reserved = checked_sub(*ctx.network.reserved, releasable, "reserved funds")?;
        *ctx.network.completed_refunds =
            checked_add(*ctx.network.completed_refunds, refund, "refunds")?;
        *ctx.network.platform_fees = checked_add(
            *ctx.network.platform_fees,
            task_snapshot.cancellation_fee,
            "platform fees",
        )?;
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let task = task_mut(&mut ctx.network, &task_id)?;
    task.remaining_allocation = U256::ZERO;
    task.execution_state = EXECUTION_CANCELLED;
    task.payment_state = PAYMENT_CANCELLED;
    task.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn withdraw_claim(ctx: &mut _, operation_id: String, task_id: String) -> LyquidResult<bool> {
    let task_snapshot = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    let intent = OperationIntent::settlement(7, task_id.clone(), task_snapshot.earned_claim);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if task_snapshot.provider != ctx.caller {
        return Err(runtime_error("only the task provider can withdraw"));
    }
    if task_snapshot.payment_state != PAYMENT_EARNED || task_snapshot.earned_claim == U256::ZERO {
        return Err(runtime_error("no earned unpaid claim"));
    }
    let amount = task_snapshot.earned_claim;
    *ctx.network.earned_claims = checked_sub(*ctx.network.earned_claims, amount, "earned claims")?;
    *ctx.network.completed_payouts =
        checked_add(*ctx.network.completed_payouts, amount, "provider payouts")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let task = task_mut(&mut ctx.network, &task_id)?;
    task.payment_state = PAYMENT_PAID;
    task.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn grant_authority(
    ctx: &mut _,
    operation_id: String,
    provider: Address,
    scopes: Vec<String>,
) -> LyquidResult<bool> {
    let intent = OperationIntent::authority(provider, scopes.clone());
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if *ctx.network.operator != ctx.caller {
        return Err(runtime_error("only the operator can grant authority"));
    }
    if provider == Address::ZERO || scopes.is_empty() || scopes.iter().any(|s| s.trim().is_empty())
    {
        return Err(runtime_error("invalid authority grant"));
    }
    let mut unique = scopes;
    unique.sort();
    unique.dedup();
    ctx.network.authority_grants.insert(provider, unique);
    next_sequence(&mut ctx.network)?;
    Ok(true)
}

#[method::network(export = eth)]
fn assign_provider(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    amount: U256,
    expected_digest: B256,
) -> LyquidResult<bool> {
    let intent =
        OperationIntent::provider_assignment(task_id.clone(), provider, amount, expected_digest);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let mut task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.payer != ctx.caller {
        return Err(runtime_error("only the task payer can assign providers"));
    }
    if !matches!(
        (task.execution_state, task.payment_state),
        (EXECUTION_CREATED, PAYMENT_RESERVED)
            | (EXECUTION_CREATED, PAYMENT_DELEGATED)
            | (EXECUTION_DISPATCHED, PAYMENT_RESERVED)
            | (EXECUTION_DISPATCHED, PAYMENT_DELEGATED)
    ) {
        return Err(runtime_error("task cannot accept new provider commitments"));
    }
    if amount == U256::ZERO || expected_digest == B256::ZERO {
        return Err(runtime_error("invalid provider assignment"));
    }
    if ctx
        .network
        .provider_records
        .contains_key(&(task_id.clone(), provider))
    {
        return Err(runtime_error("provider already assigned"));
    }
    let granted = ctx
        .network
        .authority_grants
        .get(&provider)
        .cloned()
        .unwrap_or_default();
    let effective = granted
        .iter()
        .find(|scope| **scope == task.required_scope)
        .cloned()
        .ok_or_else(|| runtime_error("provider lacks the required task scope"))?;
    if task.provider_allocation_remaining < amount {
        return Err(runtime_error(
            "provider assignment exceeds unallocated funds",
        ));
    }
    task.provider_allocation_remaining = checked_sub(
        task.provider_allocation_remaining,
        amount,
        "provider allocation",
    )?;
    let sequence = next_sequence(&mut ctx.network)?;
    task.updated_sequence = sequence;
    let authority_epoch = task.provider_epoch;
    ctx.network.tasks.insert(task_id.clone(), task);
    let record = ProviderRecord {
        provider,
        effective_scope: effective,
        amount,
        expected_digest,
        evidence: B256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        authority_epoch,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network
        .provider_records
        .insert((task_id, provider), record);
    Ok(true)
}

fn record_authority_epoch(
    state: &__lyquid::NetworkState,
    task_id: &str,
    provider: Address,
) -> LyquidResult<u64> {
    state
        .provider_records
        .get(&(task_id.to_string(), provider))
        .map(|record| record.authority_epoch)
        .ok_or_else(|| runtime_error("provider assignment not found"))
}

#[method::network(export = eth)]
fn handoff_provider(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    from_provider: Address,
    to_provider: Address,
    amount: U256,
    next_digest: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::provider_handoff(
        task_id.clone(),
        from_provider,
        to_provider,
        amount,
        next_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let mut task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can hand off provider work",
        ));
    }
    if task.execution_state == EXECUTION_CANCELLED || from_provider == to_provider {
        return Err(runtime_error("invalid provider handoff"));
    }
    let from_key = (task_id.clone(), from_provider);
    let from_snapshot = ctx
        .network
        .provider_records
        .get(&from_key)
        .cloned()
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    if from_snapshot.authority_epoch != task.provider_epoch {
        return Err(runtime_error("provider authority epoch is stale"));
    }
    if amount != from_snapshot.amount || next_digest == B256::ZERO {
        return Err(runtime_error("invalid handoff terms"));
    }
    if !matches!(
        from_snapshot.execution_state,
        EXECUTION_DISPATCHED | EXECUTION_DELIVERED
    ) || from_snapshot.payment_state != PAYMENT_RESERVED
    {
        return Err(runtime_error("provider work cannot be handed off"));
    }
    if ctx.network.verification_records.iter().any(
        |((verification_task_id, verification_producer, _), _)| {
            verification_task_id == &task_id && verification_producer == &from_provider
        },
    ) {
        return Err(runtime_error(
            "provider with an assigned verifier cannot be handed off",
        ));
    }
    if ctx
        .network
        .external_effects
        .contains_key(&(task_id.clone(), from_provider))
    {
        return Err(runtime_error(
            "provider with an external effect cannot be handed off",
        ));
    }
    if next_digest == from_snapshot.expected_digest {
        return Err(runtime_error(
            "replacement must use a new evidence identity",
        ));
    }
    if ctx
        .network
        .provider_records
        .contains_key(&(task_id.clone(), to_provider))
    {
        return Err(runtime_error("replacement provider already assigned"));
    }
    let granted = ctx
        .network
        .authority_grants
        .get(&to_provider)
        .cloned()
        .unwrap_or_default();
    let effective = granted
        .iter()
        .find(|scope| **scope == task.required_scope)
        .cloned()
        .ok_or_else(|| runtime_error("replacement provider lacks the required task scope"))?;
    let next_epoch = task
        .provider_epoch
        .checked_add(1)
        .ok_or_else(|| runtime_error("provider epoch overflow"))?;
    let sequence = next_sequence(&mut ctx.network)?;
    task.provider_epoch = next_epoch;
    task.updated_sequence = sequence;
    ctx.network.tasks.insert(task_id.clone(), task);
    let old = ctx
        .network
        .provider_records
        .get_mut(&from_key)
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    old.execution_state = EXECUTION_HANDED_OFF;
    old.payment_state = PAYMENT_HANDED_OFF;
    old.updated_sequence = sequence;
    let record = ProviderRecord {
        provider: to_provider,
        effective_scope: effective,
        amount,
        expected_digest: next_digest,
        evidence: B256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_RESERVED,
        authority_epoch: next_epoch,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network
        .provider_records
        .insert((task_id, to_provider), record);
    Ok(true)
}

#[method::network(export = eth)]
fn enable_external_effect(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    nonce: U256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::external_effect(18, task_id.clone(), provider, nonce);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can enable an external effect",
        ));
    }
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    let provider_record = ctx
        .network
        .provider_records
        .get(&(task_id.clone(), provider))
        .cloned()
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    if provider_record.execution_state != EXECUTION_CREATED
        || ctx
            .network
            .external_effects
            .contains_key(&(task_id.clone(), provider))
    {
        return Err(runtime_error("external effect transition is invalid"));
    }
    if nonce == U256::ZERO || ctx.network.used_effect_nonces.contains_key(&nonce) {
        return Err(runtime_error(
            "external effect nonce is zero or already used",
        ));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let record = ExternalEffectRecord {
        provider,
        nonce,
        state: EFFECT_PENDING,
        receipt: B256::ZERO,
        attempts: U256::from(1_u8),
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.used_effect_nonces.insert(nonce, true);
    ctx.network
        .external_effects
        .insert((task_id, provider), record);
    Ok(true)
}

#[method::network(export = eth)]
fn mark_effect_unknown(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
) -> LyquidResult<bool> {
    let intent = OperationIntent::external_effect(19, task_id.clone(), provider, U256::ZERO);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    if ctx.caller != provider {
        return Err(runtime_error(
            "only the assigned provider can report an unknown effect",
        ));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id, provider);
    let record = ctx
        .network
        .external_effects
        .get_mut(&key)
        .ok_or_else(|| runtime_error("external effect not found"))?;
    if record.state != EFFECT_STARTED {
        return Err(runtime_error("external effect transition is invalid"));
    }
    record.state = EFFECT_UNKNOWN;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn retry_external_effect(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    next_nonce: U256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::external_effect(20, task_id.clone(), provider, next_nonce);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can retry an external effect",
        ));
    }
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    if next_nonce == U256::ZERO || ctx.network.used_effect_nonces.contains_key(&next_nonce) {
        return Err(runtime_error(
            "external effect nonce is zero or already used",
        ));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id, provider);
    let record = ctx
        .network
        .external_effects
        .get_mut(&key)
        .ok_or_else(|| runtime_error("external effect not found"))?;
    if record.state == EFFECT_UNKNOWN {
        return Err(runtime_error(
            "unknown external effect must be reconciled first",
        ));
    }
    if record.state != EFFECT_FAILED {
        return Err(runtime_error("external effect transition is invalid"));
    }
    record.nonce = next_nonce;
    record.state = EFFECT_PENDING;
    record.receipt = B256::ZERO;
    record.attempts = checked_add(record.attempts, U256::from(1_u8), "effect attempts")?;
    record.updated_sequence = sequence;
    ctx.network.used_effect_nonces.insert(next_nonce, true);
    Ok(true)
}

#[method::network(export = eth)]
fn start_external_effect(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
) -> LyquidResult<bool> {
    let intent = OperationIntent::external_effect(22, task_id.clone(), provider, U256::ZERO);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if ctx.caller != provider {
        return Err(runtime_error(
            "only the assigned provider can start an external effect",
        ));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id, provider);
    let record = ctx
        .network
        .external_effects
        .get_mut(&key)
        .ok_or_else(|| runtime_error("external effect not found"))?;
    if record.state != EFFECT_PENDING {
        return Err(runtime_error("external effect transition is invalid"));
    }
    record.state = EFFECT_STARTED;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn reconcile_external_effect(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    succeeded: bool,
    receipt: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::external_effect(
        21,
        task_id.clone(),
        provider,
        U256::from(u8::from(succeeded)),
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can reconcile an external effect",
        ));
    }
    if receipt == B256::ZERO {
        return Err(runtime_error("reconciliation receipt cannot be zero"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id, provider);
    let record = ctx
        .network
        .external_effects
        .get_mut(&key)
        .ok_or_else(|| runtime_error("external effect not found"))?;
    if record.state != EFFECT_UNKNOWN {
        return Err(runtime_error(
            "only an unknown external effect can be reconciled",
        ));
    }
    record.state = if succeeded {
        EFFECT_TERMINAL
    } else {
        EFFECT_FAILED
    };
    record.receipt = receipt;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn dispatch_provider(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
) -> LyquidResult<bool> {
    let intent = OperationIntent::provider_execution(10, task_id.clone(), provider, B256::ZERO);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    if ctx.caller != provider {
        return Err(runtime_error("only the assigned provider can dispatch"));
    }
    if task.provider_epoch != record_authority_epoch(&ctx.network, &task_id, provider)? {
        return Err(runtime_error("provider authority epoch is stale"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id.clone(), provider);
    if let Some(effect) = ctx.network.external_effects.get_mut(&key) {
        if effect.state != EFFECT_PENDING {
            return Err(runtime_error("external effect transition is invalid"));
        }
        effect.state = EFFECT_STARTED;
        effect.updated_sequence = sequence;
    }
    let record = ctx
        .network
        .provider_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    if record.execution_state != EXECUTION_CREATED {
        return Err(runtime_error("provider execution transition is invalid"));
    }
    record.execution_state = EXECUTION_DISPATCHED;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn deliver_provider(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    evidence: B256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::provider_execution(11, task_id.clone(), provider, evidence);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    if ctx.caller != provider {
        return Err(runtime_error("only the assigned provider can deliver"));
    }
    if evidence == B256::ZERO {
        return Err(runtime_error("evidence digest cannot be zero"));
    }
    if task.provider_epoch != record_authority_epoch(&ctx.network, &task_id, provider)? {
        return Err(runtime_error("provider authority epoch is stale"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let key = (task_id, provider);
    let record = ctx
        .network
        .provider_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    if record.execution_state != EXECUTION_DISPATCHED {
        return Err(runtime_error("provider execution transition is invalid"));
    }
    record.evidence = evidence;
    record.execution_state = EXECUTION_DELIVERED;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn accept_provider(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
) -> LyquidResult<bool> {
    let key = (task_id.clone(), provider);
    let record_snapshot = ctx
        .network
        .provider_records
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    let intent =
        OperationIntent::provider_settlement(12, task_id.clone(), provider, record_snapshot.amount);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.payer != ctx.caller {
        return Err(runtime_error(
            "only the task payer can accept provider work",
        ));
    }
    if task.provider_epoch != record_snapshot.authority_epoch {
        return Err(runtime_error("provider authority epoch is stale"));
    }
    if record_snapshot.execution_state != EXECUTION_DELIVERED {
        return Err(runtime_error("provider work has not been delivered"));
    }
    if record_snapshot.evidence != record_snapshot.expected_digest {
        return Err(runtime_error("provider evidence does not match terms"));
    }
    if let Some(confidential) = ctx
        .network
        .confidential_evidence
        .get(&(task_id.clone(), provider))
    {
        let submitted = confidential
            .outcomes
            .iter()
            .map(|outcome| outcome.adjudicator)
            .collect::<Vec<_>>();
        let complete = confidential
            .access_policy
            .iter()
            .all(|adjudicator| submitted.contains(adjudicator));
        let approved = confidential.outcomes.iter().all(|outcome| outcome.approved);
        if !complete || !approved {
            return Err(runtime_error(
                "private adjudication is incomplete or rejected",
            ));
        }
    }
    let reviews = ctx
        .network
        .verification_records
        .iter()
        .filter(|((review_task_id, review_producer, _), record)| {
            review_task_id == &task_id
                && review_producer == &provider
                && record.authority_epoch == task.provider_epoch
                && !record.revoked
        })
        .map(|(_, record)| record.clone())
        .collect::<Vec<_>>();
    if !reviews.is_empty() || task.review_threshold > 1 {
        if (reviews.len() as u64) < task.review_threshold {
            return Err(runtime_error("eligible reviewer set is below threshold"));
        }
        let approvals = reviews
            .iter()
            .filter(|review| review.approved == Some(true))
            .count();
        if (approvals as u64) < task.review_threshold {
            return Err(runtime_error("review approvals are below threshold"));
        }
    }
    if let Some(effect) = ctx
        .network
        .external_effects
        .get(&(task_id.clone(), provider))
    {
        if !effect.is_terminal() {
            return Err(runtime_error(
                "external effect must be terminal before release",
            ));
        }
    }
    let submitted_reviews = reviews
        .iter()
        .filter(|review| review.approved.is_some())
        .cloned()
        .collect::<Vec<_>>();
    let mut verifier_reward = U256::ZERO;
    for review in &submitted_reviews {
        verifier_reward = checked_add(verifier_reward, review.reward, "reviewer rewards")?;
    }
    let amount = record_snapshot.amount;
    let total_award = checked_add(amount, verifier_reward, "producer and verifier awards")?;
    *ctx.network.reserved = checked_sub(*ctx.network.reserved, total_award, "reserved funds")?;
    *ctx.network.earned_claims =
        checked_add(*ctx.network.earned_claims, total_award, "earned claims")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let updated_task = task_mut(&mut ctx.network, &task_id)?;
    updated_task.payment_state = PAYMENT_DELEGATED;
    updated_task.updated_sequence = sequence;
    let record = ctx
        .network
        .provider_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    record.execution_state = EXECUTION_ACCEPTED;
    record.payment_state = PAYMENT_EARNED;
    record.updated_sequence = sequence;
    for ((review_task_id, review_producer, _), review) in
        ctx.network.verification_records.iter_mut()
    {
        if review_task_id == &task_id
            && review_producer == &provider
            && review.authority_epoch == task.provider_epoch
            && !review.revoked
            && review.approved.is_some()
        {
            review.payment_state = PAYMENT_EARNED;
            review.updated_sequence = sequence;
        }
    }
    Ok(true)
}

#[method::network(export = eth)]
fn withdraw_provider_claim(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
) -> LyquidResult<bool> {
    let key = (task_id.clone(), provider);
    let record_snapshot = ctx
        .network
        .provider_records
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    let intent =
        OperationIntent::provider_settlement(13, task_id.clone(), provider, record_snapshot.amount);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if ctx.caller != provider {
        return Err(runtime_error("only the assigned provider can withdraw"));
    }
    if record_snapshot.payment_state != PAYMENT_EARNED || record_snapshot.amount == U256::ZERO {
        return Err(runtime_error("provider has no earned unpaid claim"));
    }
    let amount = record_snapshot.amount;
    *ctx.network.earned_claims = checked_sub(*ctx.network.earned_claims, amount, "earned claims")?;
    *ctx.network.completed_payouts =
        checked_add(*ctx.network.completed_payouts, amount, "provider payouts")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let record = ctx
        .network
        .provider_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("provider assignment not found"))?;
    record.payment_state = PAYMENT_PAID;
    record.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn assign_verifier(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    verifier: Address,
    reward: U256,
) -> LyquidResult<bool> {
    let intent =
        OperationIntent::verification_assignment(task_id.clone(), producer, verifier, reward);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let mut task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error("only the task payer can assign a verifier"));
    }
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    if !ctx
        .network
        .provider_records
        .contains_key(&(task_id.clone(), producer))
    {
        return Err(runtime_error("producer assignment not found"));
    }
    if ctx
        .network
        .verification_records
        .contains_key(&(task_id.clone(), producer, verifier))
    {
        return Err(runtime_error("reviewer already assigned to producer"));
    }
    if verifier == Address::ZERO
        || verifier == producer
        || ctx
            .network
            .provider_records
            .contains_key(&(task_id.clone(), verifier))
    {
        return Err(runtime_error("verifier must be independent from producers"));
    }
    if ctx.network.verification_records.iter().any(
        |((review_task_id, _, review_verifier), record)| {
            review_task_id == &task_id
                && review_verifier == &verifier
                && record.payment_state != PAYMENT_CANCELLED
        },
    ) {
        return Err(runtime_error(
            "verifier already has an active review for this task",
        ));
    }
    let verifier_scope = format!("verify:{}", task.required_scope);
    let granted = ctx
        .network
        .authority_grants
        .get(&verifier)
        .cloned()
        .unwrap_or_default();
    let effective = granted
        .iter()
        .find(|scope| **scope == verifier_scope)
        .cloned()
        .ok_or_else(|| runtime_error("verifier lacks the required verification scope"))?;
    if reward == U256::ZERO {
        return Err(runtime_error("verifier reward must be greater than zero"));
    }
    if task.provider_allocation_remaining < reward {
        return Err(runtime_error("verifier reward exceeds unallocated funds"));
    }
    task.provider_allocation_remaining = checked_sub(
        task.provider_allocation_remaining,
        reward,
        "verifier allocation",
    )?;
    let sequence = next_sequence(&mut ctx.network)?;
    task.updated_sequence = sequence;
    ctx.network.tasks.insert(task_id.clone(), task);
    let record = VerificationRecord {
        producer,
        verifier,
        effective_scope: effective,
        reward,
        approved: None,
        payment_state: PAYMENT_RESERVED,
        authority_epoch: ctx
            .network
            .tasks
            .get(&task_id)
            .map_or(0, |task| task.provider_epoch),
        revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network
        .verification_records
        .insert((task_id, producer, verifier), record);
    Ok(true)
}
#[method::network(export = eth)]
fn submit_verifier_result(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    verifier: Address,
    terms_version: U256,
    terms_digest: B256,
    evidence_digest: B256,
    approved: bool,
) -> LyquidResult<bool> {
    if terms_version.is_zero() || terms_version > U256::from(u64::MAX) {
        return Err(runtime_error(
            "review terms version is outside uint64 range",
        ));
    }
    let terms_version = terms_version.to::<u64>();
    let intent = OperationIntent::verification_result(
        task_id.clone(),
        producer,
        verifier,
        terms_version,
        terms_digest,
        evidence_digest,
        approved,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    ensure_authority_chain_active(&ctx.network, &task_id)?;
    if task.execution_state == EXECUTION_CANCELLED {
        return Err(runtime_error("task is cancelled"));
    }
    let provider = ctx
        .network
        .provider_records
        .get(&(task_id.clone(), producer))
        .cloned()
        .ok_or_else(|| runtime_error("producer assignment not found"))?;
    if task.terms_version != terms_version || task.terms_digest != terms_digest {
        return Err(runtime_error(
            "reviewer result is not bound to the active task terms",
        ));
    }
    if provider.execution_state != EXECUTION_DELIVERED
        || provider.evidence != provider.expected_digest
        || provider.evidence != evidence_digest
    {
        return Err(runtime_error(
            "reviewer result is not bound to delivered evidence",
        ));
    }
    let key = (task_id.clone(), producer, verifier);
    let record = ctx
        .network
        .verification_records
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    if ctx.caller != verifier || verifier != record.verifier {
        return Err(runtime_error(
            "only the assigned independent verifier can submit",
        ));
    }
    if record.revoked
        || record.payment_state != PAYMENT_RESERVED
        || record.approved.is_some()
        || record.authority_epoch != task.provider_epoch
    {
        return Err(runtime_error(
            "revoked reviewer cannot submit another result",
        ));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let updated = ctx
        .network
        .verification_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    updated.approved = Some(approved);
    updated.updated_sequence = sequence;
    Ok(true)
}

#[method::network(export = eth)]
fn revoke_reviewer(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    verifier: Address,
) -> LyquidResult<bool> {
    let intent = OperationIntent::reviewer_revocation(task_id.clone(), producer, verifier);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let mut task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error("only the task payer can revoke a reviewer"));
    }
    let key = (task_id.clone(), producer, verifier);
    let record_snapshot = ctx
        .network
        .verification_records
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    if record_snapshot.revoked || record_snapshot.payment_state != PAYMENT_RESERVED {
        return Err(runtime_error("reviewer is not revocable"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    task.provider_allocation_remaining = checked_add(
        task.provider_allocation_remaining,
        record_snapshot.reward,
        "returned reviewer allocation",
    )?;
    task.updated_sequence = sequence;
    ctx.network.tasks.insert(task_id, task);
    let record = ctx
        .network
        .verification_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    record.revoked = true;
    record.payment_state = PAYMENT_CANCELLED;
    record.updated_sequence = sequence;
    Ok(true)
}
#[method::network(export = eth)]
fn withdraw_verifier_reward(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    producer: Address,
    verifier: Address,
) -> LyquidResult<bool> {
    let key = (task_id.clone(), producer, verifier);
    let record_snapshot = ctx
        .network
        .verification_records
        .get(&key)
        .cloned()
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    let intent = OperationIntent::verification_withdrawal(
        task_id.clone(),
        producer,
        verifier,
        record_snapshot.reward,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    if ctx.caller != verifier || verifier != record_snapshot.verifier {
        return Err(runtime_error(
            "only the assigned independent verifier can withdraw",
        ));
    }
    if record_snapshot.payment_state != PAYMENT_EARNED || record_snapshot.reward == U256::ZERO {
        return Err(runtime_error("verifier has no earned unpaid reward"));
    }
    let reward = record_snapshot.reward;
    *ctx.network.earned_claims = checked_sub(*ctx.network.earned_claims, reward, "earned claims")?;
    *ctx.network.completed_payouts =
        checked_add(*ctx.network.completed_payouts, reward, "verifier payouts")?;
    let sequence = next_sequence(&mut ctx.network)?;
    let record = ctx
        .network
        .verification_records
        .get_mut(&key)
        .ok_or_else(|| runtime_error("verifier assignment not found"))?;
    record.payment_state = PAYMENT_PAID;
    record.updated_sequence = sequence;
    Ok(true)
}

fn allocated_dependency_shares(
    state: &__lyquid::NetworkState,
    dependency_id: &str,
) -> LyquidResult<U256> {
    let mut total = U256::ZERO;
    for share in state.dependency_shares.values() {
        if share.dependency_id == dependency_id {
            total = checked_add(total, share.amount, "dependency shares")?;
        }
    }
    Ok(total)
}

fn dependency_path_exists(state: &__lyquid::NetworkState, from: &str, to: &str) -> bool {
    let mut stack = vec![from.to_string()];
    let mut visited = std::collections::HashSet::new();
    while let Some(current) = stack.pop() {
        if current == to {
            return true;
        }
        if !visited.insert(current.clone()) {
            continue;
        }
        if let Some(task) = state.tasks.get(&current) {
            stack.extend(task.child_ids.iter().cloned());
        }
        for share in state.dependency_shares.values() {
            if share.parent_id == current {
                stack.push(share.dependency_id.clone());
            }
        }
    }
    false
}

#[method::network(export = eth)]
fn add_dependency_share(
    ctx: &mut _,
    operation_id: String,
    parent_id: String,
    dependency_id: String,
    amount: U256,
) -> LyquidResult<bool> {
    let intent =
        OperationIntent::dependency_share(parent_id.clone(), dependency_id.clone(), amount);
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&parent_id, "parent task id")?;
    require_nonempty_id(&dependency_id, "dependency task id")?;
    if amount == U256::ZERO {
        return Err(runtime_error("dependency share must be greater than zero"));
    }
    let parent = ctx
        .network
        .tasks
        .get(&parent_id)
        .cloned()
        .ok_or_else(|| runtime_error("parent task not found"))?;
    let dependency = ctx
        .network
        .tasks
        .get(&dependency_id)
        .cloned()
        .ok_or_else(|| runtime_error("dependency task not found"))?;
    if parent.payer != ctx.caller {
        return Err(runtime_error(
            "only the parent payer can add a dependency share",
        ));
    }
    if parent.execution_state == EXECUTION_CANCELLED
        || dependency.execution_state == EXECUTION_CANCELLED
    {
        return Err(runtime_error(
            "cancelled tasks cannot join a dependency graph",
        ));
    }
    if parent_id == dependency_id || parent.child_ids.iter().any(|child| *child == dependency_id) {
        return Err(runtime_error("dependency edge would create a cycle"));
    }
    if ctx
        .network
        .dependency_shares
        .contains_key(&(parent_id.clone(), dependency_id.clone()))
    {
        return Err(runtime_error("dependency edge already exists"));
    }
    if dependency_path_exists(&ctx.network, &dependency_id, &parent_id) {
        return Err(runtime_error("dependency edge would create a cycle"));
    }
    let allocated = allocated_dependency_shares(&ctx.network, &dependency_id)?;
    let new_allocated = checked_add(allocated, amount, "dependency shares")?;
    if new_allocated > dependency.amount {
        return Err(runtime_error("combined shares exceed dependency cost"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let record = DependencyShareRecord {
        parent_id,
        dependency_id,
        amount,
        created_sequence: sequence,
    };
    ctx.network.dependency_shares.insert(
        (record.parent_id.clone(), record.dependency_id.clone()),
        record,
    );
    Ok(true)
}

#[method::network(export = eth)]
fn create_offer_task(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    maximum_amount: U256,
) -> LyquidResult<bool> {
    let intent = OperationIntent::offer(
        23,
        task_id.clone(),
        Address::ZERO,
        0,
        maximum_amount,
        U256::ZERO,
        B256::ZERO,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    require_nonempty_id(&task_id, "offer task id")?;
    if maximum_amount == U256::ZERO {
        return Err(runtime_error(
            "maximum offer amount must be greater than zero",
        ));
    }
    if ctx.network.tasks.contains_key(&task_id) {
        return Err(runtime_error("task id already exists"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let task = TaskRecord {
        payer: ctx.caller,
        provider: Address::ZERO,
        amount: maximum_amount,
        cancellation_fee: U256::ZERO,
        expected_digest: B256::ZERO,
        terms_version: 1,
        terms_digest: B256::ZERO,
        evidence: B256::ZERO,
        parent_id: String::new(),
        child_ids: Vec::new(),
        remaining_allocation: U256::ZERO,
        earned_claim: U256::ZERO,
        execution_state: EXECUTION_CREATED,
        payment_state: PAYMENT_OPEN,
        required_scope: "work:data".to_string(),
        provider_allocation_remaining: U256::ZERO,
        provider_epoch: 0,
        review_threshold: 1,
        authority_scopes: vec!["work:data".to_string()],
        authority_depth: 0,
        authority_epoch: 0,
        authority_revoked: false,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.tasks.insert(task_id.clone(), task);
    ctx.network.root_task_ids.push(task_id);
    Ok(true)
}

#[method::network(export = eth)]
fn submit_offer(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    terms_version: U256,
    amount: U256,
    cancellation_fee: U256,
    expected_digest: B256,
) -> LyquidResult<bool> {
    if terms_version.is_zero() || terms_version > U256::from(u64::MAX) {
        return Err(runtime_error("terms version is outside uint64 range"));
    }
    let terms_version = terms_version.to::<u64>();
    let intent = OperationIntent::offer(
        24,
        task_id.clone(),
        provider,
        terms_version,
        amount,
        cancellation_fee,
        expected_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("offer task not found"))?;
    if task.payment_state != PAYMENT_OPEN || task.provider != Address::ZERO {
        return Err(runtime_error("offer market is no longer open"));
    }
    if ctx.caller != provider || provider == Address::ZERO || terms_version == 0 {
        return Err(runtime_error("invalid offer identity"));
    }
    let key = (task_id.clone(), provider, terms_version);
    if ctx.network.offers.contains_key(&key) {
        return Err(runtime_error("provider and terms version already offered"));
    }
    let granted = ctx
        .network
        .authority_grants
        .get(&provider)
        .cloned()
        .unwrap_or_default();
    if !granted.iter().any(|scope| *scope == task.required_scope) {
        return Err(runtime_error("provider lacks required offer scope"));
    }
    if amount == U256::ZERO
        || amount > task.amount
        || cancellation_fee > amount
        || expected_digest == B256::ZERO
    {
        return Err(runtime_error("invalid offer terms"));
    }
    let sequence = next_sequence(&mut ctx.network)?;
    let record = OfferRecord {
        provider,
        terms_version,
        amount,
        cancellation_fee,
        expected_digest,
        status: OFFER_SUBMITTED,
        created_sequence: sequence,
        updated_sequence: sequence,
    };
    ctx.network.offers.insert(key, record);
    Ok(true)
}

#[method::network(export = eth)]
fn select_offer(
    ctx: &mut _,
    operation_id: String,
    task_id: String,
    provider: Address,
    terms_version: U256,
) -> LyquidResult<bool> {
    if terms_version.is_zero() || terms_version > U256::from(u64::MAX) {
        return Err(runtime_error("terms version is outside uint64 range"));
    }
    let terms_version = terms_version.to::<u64>();
    let selected_key = (task_id.clone(), provider, terms_version);
    let selected_snapshot = ctx
        .network
        .offers
        .get(&selected_key)
        .cloned()
        .ok_or_else(|| runtime_error("offer not found"))?;
    let intent = OperationIntent::offer(
        25,
        task_id.clone(),
        provider,
        terms_version,
        selected_snapshot.amount,
        selected_snapshot.cancellation_fee,
        selected_snapshot.expected_digest,
    );
    if record_intent(&mut ctx.network, ctx.caller, &operation_id, &intent)? {
        return Ok(true);
    }
    let mut task = ctx
        .network
        .tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| runtime_error("offer task not found"))?;
    if task.payer != ctx.caller {
        return Err(runtime_error("only the payer can select an offer"));
    }
    if task.payment_state != PAYMENT_OPEN || task.provider != Address::ZERO {
        return Err(runtime_error("market already selected an offer"));
    }
    if selected_snapshot.status != OFFER_SUBMITTED {
        return Err(runtime_error("offer is not selectable"));
    }
    let available = balance_mut(&mut ctx.network, &task.payer);
    if *available < selected_snapshot.amount {
        return Err(runtime_error(
            "insufficient available funds for selected offer",
        ));
    }
    *available = checked_sub(*available, selected_snapshot.amount, "payer balance")?;
    *ctx.network.reserved = checked_add(
        *ctx.network.reserved,
        selected_snapshot.amount,
        "selected offer reservation",
    )?;

    let sequence = next_sequence(&mut ctx.network)?;
    task.provider = selected_snapshot.provider;
    task.amount = selected_snapshot.amount;
    task.cancellation_fee = selected_snapshot.cancellation_fee;
    task.expected_digest = selected_snapshot.expected_digest;
    task.remaining_allocation = selected_snapshot.amount;
    task.provider_allocation_remaining = selected_snapshot.amount;
    task.payment_state = PAYMENT_RESERVED;
    task.updated_sequence = sequence;
    ctx.network.tasks.insert(task_id.clone(), task);

    for ((offer_task_id, offer_provider, offer_version), record) in ctx.network.offers.iter_mut() {
        if *offer_task_id != task_id {
            continue;
        }
        record.status = if *offer_provider == provider && *offer_version == terms_version {
            OFFER_SELECTED
        } else {
            OFFER_REJECTED
        };
        record.updated_sequence = sequence;
    }
    Ok(true)
}

#[method::instance(export = eth)]
fn balance_of(ctx: &_, account: Address) -> LyquidResult<U256> {
    Ok(*ctx.network.balances.get(&account).unwrap_or(&U256::ZERO))
}

#[method::instance(export = eth)]
fn get_ledger(ctx: &_) -> LyquidResult<(String, u8, U256, U256, U256, U256, U256, U256, U256)> {
    Ok((
        ctx.network.asset_id.clone(),
        *ctx.network.asset_precision,
        *ctx.network.total_deposits,
        *ctx.network.reserved,
        *ctx.network.earned_claims,
        *ctx.network.completed_payouts,
        *ctx.network.completed_refunds,
        *ctx.network.platform_fees,
        U256::from(*ctx.network.sequence),
    ))
}

fn json_response(value: String) -> http::Response {
    http::Response {
        status: 200,
        headers: vec![http::Header {
            name: "content-type".into(),
            value: b"application/json; charset=utf-8".to_vec(),
        }],
        body: value.into_bytes(),
    }
}

fn state_json(network: &__lyquid::NetworkState, lyquid_id: LyquidID) -> LyquidResult<String> {
    let mut balances_total = U256::ZERO;
    let balances: Vec<_> = network
        .balances
        .iter()
        .map(|(account, amount)| {
            balances_total = checked_add(balances_total, *amount, "balance total")?;
            Ok(serde_json::json!({
                "account": account.to_checksum(None),
                "amount": amount.to_string(),
            }))
        })
        .collect::<Result<_, LyquidError>>()?;

    let tasks: Vec<_> = network
        .tasks
        .iter()
        .map(|(id, task)| {
            serde_json::json!({
                "id": id,
                "payer": task.payer.to_checksum(None),
                "provider": task.provider.to_checksum(None),
                "amount": task.amount.to_string(),
                "cancellationFee": task.cancellation_fee.to_string(),
                "remainingAllocation": task.remaining_allocation.to_string(),
                "earnedClaim": task.earned_claim.to_string(),
                "expectedDigest": format!("{:#x}", task.expected_digest),
                "termsVersion": task.terms_version,
                "termsDigest": format!("{:#x}", task.terms_digest),
                "evidence": format!("{:#x}", task.evidence),
                "parent": task.parent_id,
                "children": task.child_ids,
                "executionState": task.execution_state,
                "paymentState": task.payment_state,
                "requiredScope": task.required_scope,
                "providerEpoch": task.provider_epoch,
                "reviewThreshold": task.review_threshold,
                "authorityScopes": task.authority_scopes,
                "authorityDepth": task.authority_depth,
                "authorityEpoch": task.authority_epoch,
                "authorityRevoked": task.authority_revoked,
                "providerAllocationRemaining": task.provider_allocation_remaining.to_string(),
                "dependencyShares": network.dependency_shares.iter().filter(|((share_parent_id, _), _)| share_parent_id == id).map(|((_, dependency_id), record)| serde_json::json!({
                    "dependencyId": dependency_id,
                    "amount": record.amount.to_string(),
                    "createdAt": record.created_sequence,
                })).collect::<Vec<_>>(),
                "dependentShares": network.dependency_shares.iter().filter(|((_, share_dependency_id), _)| share_dependency_id == id).map(|((parent_id, _), record)| serde_json::json!({
                    "parentId": parent_id,
                    "amount": record.amount.to_string(),
                    "createdAt": record.created_sequence,
                })).collect::<Vec<_>>(),
                "offers": network.offers.iter().filter(|((offer_task_id, _, _), _)| offer_task_id == id).map(|((_, provider, terms_version), record)| serde_json::json!({
                    "provider": provider.to_checksum(None),
                    "termsVersion": terms_version,
                    "amount": record.amount.to_string(),
                    "cancellationFee": record.cancellation_fee.to_string(),
                    "expectedDigest": format!("{:#x}", record.expected_digest),
                    "status": record.status,
                    "createdAt": record.created_sequence,
                    "updatedAt": record.updated_sequence,
                })).collect::<Vec<_>>(),
                "confidentialEvidence": network.confidential_evidence.iter().filter(|((evidence_task_id, _), _)| evidence_task_id == id).map(|((_, producer), record)| serde_json::json!({
                    "producer": producer.to_checksum(None),
                    "digest": format!("{:#x}", record.digest),
                    "sizeBytes": record.size_bytes.to_string(),
                    "accessPolicy": record.access_policy.iter().map(|address| address.to_checksum(None)).collect::<Vec<_>>(),
                    "outcomes": record.outcomes.iter().map(|outcome| serde_json::json!({
                        "adjudicator": outcome.adjudicator.to_checksum(None),
                        "certificate": format!("{:#x}", outcome.certificate),
                        "approved": outcome.approved,
                        "createdAt": outcome.created_sequence,
                    })).collect::<Vec<_>>(),
                    "createdAt": record.created_sequence,
                    "updatedAt": record.updated_sequence,
                })).collect::<Vec<_>>(),
                "externalEffects": network.external_effects.iter().filter(|((effect_task_id, _), _)| effect_task_id == id).map(|((_, provider), record)| serde_json::json!({
                    "provider": provider.to_checksum(None),
                    "nonce": record.nonce.to_string(),
                    "state": record.state,
                    "receipt": format!("{:#x}", record.receipt),
                    "attempts": record.attempts.to_string(),
                    "createdAt": record.created_sequence,
                    "updatedAt": record.updated_sequence,
                })).collect::<Vec<_>>(),
                "verifications": network.verification_records.iter().filter(|((verification_task_id, _, _), _)| verification_task_id == id).map(|((_, producer, _), record)| serde_json::json!({
                    "producer": producer.to_checksum(None),
                    "verifier": record.verifier.to_checksum(None),
                    "effectiveScope": record.effective_scope,
                    "reward": record.reward.to_string(),
                    "approved": record.approved,
                    "authorityEpoch": record.authority_epoch,
                    "revoked": record.revoked,
                    "paymentState": record.payment_state,
                    "createdAt": record.created_sequence,
                    "updatedAt": record.updated_sequence,
                })).collect::<Vec<_>>(),
                "providers": network.provider_records.iter().filter(|((provider_task_id, _), _)| provider_task_id == id).map(|((_, provider), record)| serde_json::json!({
                    "provider": provider.to_checksum(None),
                    "effectiveScope": record.effective_scope,
                    "amount": record.amount.to_string(),
                    "expectedDigest": format!("{:#x}", record.expected_digest),
                    "evidence": format!("{:#x}", record.evidence),
                    "executionState": record.execution_state,
                    "paymentState": record.payment_state,
                    "authorityEpoch": record.authority_epoch,
                    "createdAt": record.created_sequence,
                    "updatedAt": record.updated_sequence,
                })).collect::<Vec<_>>(),
                "createdAt": task.created_sequence,
                "updatedAt": task.updated_sequence,
            })
        })
        .collect();

    let authority_grants: Vec<_> = network
        .authority_grants
        .iter()
        .map(|(provider, scopes)| {
            serde_json::json!({
                "provider": provider.to_checksum(None),
                "scopes": scopes,
            })
        })
        .collect();
    let operations: Vec<_> = network
        .operations
        .iter()
        .map(|((caller, operation_id), intent)| {
            serde_json::json!({
                "caller": caller.to_checksum(None),
                "operationId": operation_id,
                "action": intent.action,
                "taskId": intent.task_id,
                "parentId": intent.parent_id,
                "provider": intent.provider.to_checksum(None),
                "counterparty": intent.counterparty.to_checksum(None),
                "amount": intent.amount.to_string(),
                "cancellationFee": intent.cancellation_fee.to_string(),
                "digest": format!("{:#x}", intent.digest),
                "scopes": intent.scopes,
            })
        })
        .collect();
    let accounted = checked_add(balances_total, *network.reserved, "accounted funds")?;
    let accounted = checked_add(accounted, *network.earned_claims, "accounted funds")?;
    let accounted = checked_add(accounted, *network.completed_payouts, "accounted funds")?;
    let accounted = checked_add(accounted, *network.completed_refunds, "accounted funds")?;
    let accounted = checked_add(accounted, *network.platform_fees, "accounted funds")?;
    let response = serde_json::json!({
        "deployment": {
            "lyquidId": lyquid_id.to_string(),
            "protocolVersion": "cooo-local-v0.3-terms-bound-review",
        },
        "asset": {
            "id": *network.asset_id,
            "precision": *network.asset_precision,
            "synthetic": true,
        },
        "ledger": {
            "totalDeposits": network.total_deposits.to_string(),
            "balancesTotal": balances_total.to_string(),
            "reserved": network.reserved.to_string(),
            "earnedClaims": network.earned_claims.to_string(),
            "completedPayouts": network.completed_payouts.to_string(),
            "completedRefunds": network.completed_refunds.to_string(),
            "platformFees": network.platform_fees.to_string(),
            "sequence": network.sequence,
            "conserved": accounted == *network.total_deposits,
        },
        "balances": balances,
        "authorityGrants": authority_grants,
        "operations": operations,
        "tasks": tasks,
    });
    serde_json::to_string(&response).map_err(|error| runtime_error(error.to_string()))
}

#[method::instance(export = http, method = "GET", path_prefix = "/api/state")]
fn http_state(ctx: &_, _req: http::Request) -> LyquidResult<http::Response> {
    Ok(json_response(state_json(&ctx.network, ctx.lyquid_id)?))
}
