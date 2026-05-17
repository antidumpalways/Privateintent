-- Migration: add delivery_failed enum value and delivery_error column to intents table
-- delivery_failed: on-chain delivery tx failed; error message persisted in delivery_error column.
-- Safe to run multiple times (IF NOT EXISTS / idempotent).
ALTER TYPE intent_status ADD VALUE IF NOT EXISTS 'delivery_failed';
ALTER TABLE intents ADD COLUMN IF NOT EXISTS delivery_error TEXT;
