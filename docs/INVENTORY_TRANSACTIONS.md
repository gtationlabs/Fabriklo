# Inventory transactions

## Model

- `stock_balances(variant_id, warehouse_id)`: `on_hand`, `reserved`, `damaged`, `reorder_point`. CHECKs: all ≥ 0 and `reserved ≤ on_hand`. Available = `on_hand − reserved`.
- `stock_movements`: append-only ledger (UPDATE/DELETE raise an error, even for the owner role). Every row records deltas **and** the resulting balances, the reason, actor, reference and an optional unique idempotency key.
- `inventory_reservations`: `active → committed | released | expired`, with `expires_at` and a unique idempotency key.

## The one primitive

`private.apply_stock_movement(variant, warehouse, type, Δon_hand, Δreserved, reason, ref_type, ref_id, idempotency_key)`

1. If the idempotency key already exists → return the existing movement (replay-safe).
2. Ensure the balance row exists, then `SELECT … FOR UPDATE` (row lock).
3. Reject if the result would make `on_hand < 0`, `reserved < 0` or `reserved > on_hand`.
4. Update the balance and insert the ledger row in the same transaction.

Nothing else writes `stock_balances`. Clients have no write grants on any inventory table.

## Operations

| Operation | Function | Effect |
| --- | --- | --- |
| Receive / adjust / damage / return | `public.admin_adjust_stock` (needs `inventory.adjust` + aal2; reason ≥ 3 chars; idempotency key; above threshold needs `inventory.approve_large`) | Δon_hand |
| Reserve at checkout | `private.reserve_stock` | Picks the warehouse with most availability, locks it, Δreserved = +q |
| Commit on fulfilment/payment | `private.close_reservation(id, 'committed')` | Δon_hand = −q, Δreserved = −q |
| Release / expire | `private.close_reservation(id, 'released' \| 'expired')` | Δreserved = −q |
| Expiry worker | `public.release_expired_reservations(limit)` (service role) | `FOR UPDATE SKIP LOCKED`; each reservation closes exactly once |

Large-adjustment threshold and reservation minutes live in `private.inventory_settings` (defaults 200 units, 20 minutes).

## Verified by tests (`tests/db/inventory-concurrency.test.ts`)

- 25 parallel reservations for the last unit → exactly 1 succeeds, 24 get `stock_unavailable`; balance ends at on_hand 1 / reserved 1.
- Re-using a reservation idempotency key returns the same reservation without double-reserving.
- 5 parallel expiry workers release 2 expired reservations exactly once in total.
- Manual adjustments: replayed key applies once; negative result rejected; oversized adjustment rejected without approval permission; audited with reason.

## Still to build (order milestone)

`create_order` RPC that quotes from the DB, reserves every line under one transaction with the client's idempotency key, writes immutable order line snapshots, and the scheduled worker (pg_cron or a deployed consumer) that calls `release_expired_reservations`.
