-- Migration: add delivered_amount column to intents table
-- Stores the actual amount delivered by the solver (may differ from quoted amount
-- when solver balance is limited or partial delivery occurs).
-- Safe to run multiple times (IF NOT EXISTS).
ALTER TABLE intents ADD COLUMN IF NOT EXISTS delivered_amount TEXT;
