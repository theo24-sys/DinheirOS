# Security Specification for FinanceOS

## Data Invariants
1. A Wallet cannot have `usedFrequency` greater than `maxFrequency + rolloverBonus`.
2. `rolloverBonus` is capped at 1.
3. Transactions are immutable once created.
4. Only the owner (morggytechnologies@gmail.com) can read/write data.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Frequency Hijack**: Attempt to decrement `usedFrequency` from client.
2. **Rollover Poisoning**: Setting `rolloverBonus` to 999.
3. **Lock Bypass**: Attempting to set `locked: false` on a wallet that should be locked.
4. **Identity Spoofing**: Logged in as User B, trying to read User A's wallets.
5. **Ledger Deletion**: Authenticated user trying to delete transaction history.
6. **Balance Injection**: Manually increasing `allocation`.
7. **Daily Gate Skip**: Setting `lastWithdrawalDate` to a date in the past to bypass the one-per-day rule.
8. **Negative Cost**: Triggering a withdrawal with negative amount (if amount was client-provided).
9. **Zero-Frequency Access**: Requesting access when `usedFrequency` is already at max.
10. **System Field Update**: Modifying `updatedAt` to a future timestamp.
11. **Orphaned Transaction**: Creating a transaction for a wallet ID that doesn't exist.
12. **Admin Privilege Escalation**: Attempting to write to a hypothetical `admins` collection.

## Tests
- Verification that all "Dirty Dozen" payloads return `PERMISSION_DENIED` unless authorized by the system logic.
