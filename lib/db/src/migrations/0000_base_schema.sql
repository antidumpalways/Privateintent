--
-- PostgreSQL database dump
--

\restrict 8x0zPRItzuOn5mtrUZheR7LRVTy2pKLRZYDlKd9vkc9lFIdQlNRsq1Hk3JreVVT

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: agent_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_status AS ENUM (
    'running',
    'paused',
    'stopped'
);


--
-- Name: audit_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_action AS ENUM (
    'approved',
    'blocked',
    'flagged',
    'agent_action'
);


--
-- Name: dwallet_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dwallet_mode AS ENUM (
    'protect',
    'automate'
);


--
-- Name: intent_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.intent_status AS ENUM (
    'pending',
    'encrypted',
    'bidding',
    'accepted',
    'executing',
    'delivered',
    'settled',
    'failed',
    'refunded',
    'release_failed',
    'delivery_failed'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_jobs (
    id integer NOT NULL,
    wallet_address text NOT NULL,
    status public.agent_status DEFAULT 'stopped'::public.agent_status NOT NULL,
    target_allocations jsonb,
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    log jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_jobs_id_seq OWNED BY public.agent_jobs.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    wallet_address text NOT NULL,
    tx_hash text,
    tx_type text DEFAULT 'transfer'::text NOT NULL,
    contract_address text DEFAULT ''::text NOT NULL,
    amount_usd real DEFAULT 0 NOT NULL,
    risk_score integer DEFAULT 0 NOT NULL,
    action public.audit_action DEFAULT 'approved'::public.audit_action NOT NULL,
    reason text,
    ika_co_signed boolean DEFAULT false NOT NULL,
    ika_mpc_mode text,
    encrypted_payload text,
    encrypt_on_chain_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: dwallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dwallets (
    id integer NOT NULL,
    wallet_address text NOT NULL,
    dwallet_id text NOT NULL,
    dwallet_public_key text,
    mode public.dwallet_mode DEFAULT 'protect'::public.dwallet_mode NOT NULL,
    viewing_key text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dwallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dwallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dwallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dwallets_id_seq OWNED BY public.dwallets.id;


--
-- Name: intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intents (
    id integer NOT NULL,
    phantom_pubkey text NOT NULL,
    dwallet_id text,
    from_chain text NOT NULL,
    to_chain text NOT NULL,
    from_token text NOT NULL,
    to_token text NOT NULL,
    amount text NOT NULL,
    destination_address text,
    encrypted_intent_id text,
    encrypted_intent_hash text,
    status public.intent_status DEFAULT 'pending'::public.intent_status NOT NULL,
    winning_solver_id text,
    solver_bids jsonb,
    source_tx_id text,
    delivery_tx_id text,
    delivery_error text,
    proof_hash text,
    onchain_intent_id text,
    delivered_amount text,
    escrow_pda text,
    deadline timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    release_after timestamp without time zone
);


--
-- Name: intents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.intents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: intents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.intents_id_seq OWNED BY public.intents.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: native_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.native_wallets (
    id integer NOT NULL,
    chain text NOT NULL,
    curve text NOT NULL,
    public_key_hex text,
    eth_address text,
    btc_address text,
    sol_address text,
    attestation_hex text,
    network_sig_hex text,
    network_pubkey_hex text,
    mode text DEFAULT 'devnet'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    phantom_pubkey text
);


--
-- Name: native_wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.native_wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: native_wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.native_wallets_id_seq OWNED BY public.native_wallets.id;


--
-- Name: policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policies (
    id integer NOT NULL,
    wallet_address text NOT NULL,
    max_spend_per_tx_usd real DEFAULT 1000 NOT NULL,
    max_daily_spend_usd real DEFAULT 5000 NOT NULL,
    block_new_contracts boolean DEFAULT true NOT NULL,
    max_sell_tax_percent real DEFAULT 10 NOT NULL,
    whitelisted_protocols jsonb DEFAULT '[]'::jsonb NOT NULL,
    target_allocations jsonb,
    encrypted_ref text DEFAULT ''::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.policies_id_seq OWNED BY public.policies.id;


--
-- Name: vault_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_balances (
    id integer NOT NULL,
    address text NOT NULL,
    sol text DEFAULT '0'::text NOT NULL,
    eth text DEFAULT '0'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: vault_balances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vault_balances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vault_balances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vault_balances_id_seq OWNED BY public.vault_balances.id;


--
-- Name: vault_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vault_history (
    id integer NOT NULL,
    address text NOT NULL,
    type text NOT NULL,
    token text NOT NULL,
    amount text NOT NULL,
    stealth_address text,
    ts timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: vault_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vault_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vault_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vault_history_id_seq OWNED BY public.vault_history.id;


--
-- Name: agent_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs ALTER COLUMN id SET DEFAULT nextval('public.agent_jobs_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: dwallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dwallets ALTER COLUMN id SET DEFAULT nextval('public.dwallets_id_seq'::regclass);


--
-- Name: intents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intents ALTER COLUMN id SET DEFAULT nextval('public.intents_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: native_wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.native_wallets ALTER COLUMN id SET DEFAULT nextval('public.native_wallets_id_seq'::regclass);


--
-- Name: policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies ALTER COLUMN id SET DEFAULT nextval('public.policies_id_seq'::regclass);


--
-- Name: vault_balances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_balances ALTER COLUMN id SET DEFAULT nextval('public.vault_balances_id_seq'::regclass);


--
-- Name: vault_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_history ALTER COLUMN id SET DEFAULT nextval('public.vault_history_id_seq'::regclass);


--
-- Data for Name: agent_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agent_jobs (id, wallet_address, status, target_allocations, last_run_at, next_run_at, log, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, wallet_address, tx_hash, tx_type, contract_address, amount_usd, risk_score, action, reason, ika_co_signed, ika_mpc_mode, encrypted_payload, encrypt_on_chain_id, created_at) FROM stdin;
\.


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversations (id, title, created_at) FROM stdin;
\.


--
-- Data for Name: dwallets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dwallets (id, wallet_address, dwallet_id, dwallet_public_key, mode, viewing_key, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: intents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.intents (id, phantom_pubkey, dwallet_id, from_chain, to_chain, from_token, to_token, amount, destination_address, encrypted_intent_id, encrypted_intent_hash, status, winning_solver_id, solver_bids, source_tx_id, delivery_tx_id, proof_hash, escrow_pda, deadline, created_at, updated_at, release_after) FROM stdin;
9       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    \N      SOL     SOL     SOL     SOL     0.5     F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    encrypt:b81f83199bd1e70eb8c2f300c31f048c5fefaeb231fdf09384b95fc792200c61        3129528d410981aa5fd0c692bf98f0350ea262c149425a93f2d46822d06357bd        bidding \N      [{"toChain": "SOL", "toToken": "SOL", "solverId": "solver-ai", "expiresAt": 1778352347490, "feeAmount": "0.000650", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Solana Devnet", "nativeSign": "Ika Curve25519 EddsaSha512", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "0.499351", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 13, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.05% fee (0.13% vs 0.18%), offering higher output of 0.499351 vs their 0.499101. SOL→SOL route has zero slippage risk, so minimum viable fee applies. Staying well above 0.1% floor while being most competitive bid in the pool."}, {"sla": "Best-effort, 60-120s", "toChain": "SOL", "toToken": "SOL", "solverId": "solver-alpha", "expiresAt": 1778352342544, "feeAmount": "0.000899", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.18, "solverName": "Aggressive Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Solana Devnet", "nativeSign": "Ika Curve25519 EddsaSha512", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "0.499101", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 20, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"sla": "Guaranteed <30s ETH, <15s SOL", "toChain": "SOL", "toToken": "SOL", "solverId": "solver-beta", "expiresAt": 1778352342544, "feeAmount": "0.001497", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.299, "solverName": "Instant Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Solana Devnet", "nativeSign": "Ika Curve25519 EddsaSha512", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "0.498503", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 9, "solverDescription": "Delivery tercepat di semua chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"sla": "Guaranteed 25s ETH, 15s SOL", "toChain": "SOL", "toToken": "SOL", "solverId": "solver-gamma", "expiresAt": 1778352342544, "feeAmount": "0.002305", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.461, "solverName": "Premium Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Solana Devnet", "nativeSign": "Ika Curve25519 EddsaSha512", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "0.497695", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 19, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}] \N      \N      \N      \N      2026-05-09 18:45:47.491 2026-05-09 18:43:47.508179      2026-05-09 18:43:47.508179      \N
4       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    sec:7+c25:8     SOL     ETH     SOL     ETH     0.1     0x53C706D9366D9B022d210C32fe753AF95960c17B      encrypt:bb164cfd52ac88313afe60654d7358efe6acf5bbc74df9fd74af985475a23bc3        3c508c78a68609a5d597fa6b9622786df00b41f466f5aef7e845464964b8fc5d        settled custom-ae42ff65 [{"toChain": "ETH", "toToken": "ETH", "solverId": "custom-ae42ff65", "expiresAt": 1778169566761, "feeAmount": "0.000100", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002498", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xf794e4BDb5C31f8cB2607A199b6B1fc34f5C222a", "reputationScore": 83, "erc7683Compliant": true, "estimatedSeconds": 49, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:6xZM93y4… ETH:0xf794e4…"}, {"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778169571647, "feeAmount": "0.000130", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002497", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 32, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.051% — targeting the lowest competitive fee at 0.13% to win the bid. Market conversion is straightforward SOL→ETH with low volatility. Output calculated as 0.1 SOL × 0.025 ETH/SOL × (1 - 0.0013) = 0.002497 ETH, beating all competitor bids while staying above the 0.1% minimum profitability threshold."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778169566761, "feeAmount": "0.000179", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Delta Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002496", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 86, "erc7683Compliant": true, "estimatedSeconds": 47, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778169566760, "feeAmount": "0.000181", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.181, "solverName": "Aggressive Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002495", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 42, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"sla": "Guaranteed <30s EVM, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778169566760, "feeAmount": "0.000301", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.301, "solverName": "Instant Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002492", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 21, "solverDescription": "Delivery tercepat di semua EVM chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778169566761, "feeAmount": "0.000350", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.35, "solverName": "Epsilon Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002491", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 91, "erc7683Compliant": true, "estimatedSeconds": 42, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}, {"sla": "Guaranteed 25s EVM, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778169566760, "feeAmount": "0.000460", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.46, "solverName": "Premium Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002489", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 27, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}]      4nHpVUMWXpAo932A67GJyH5B8XHrCx45SNz9puPuc3tQcevgz53gcvdG8UiB6MGH6JyXJKBK8gfCnjfh5UYjqThK        0xbc9b545c65526b7a0a29290eac969d4af603c05e182425175693443a358a0bc4|https://sepolia.etherscan.io/tx/0xbc9b545c65526b7a0a29290eac969d4af603c05e182425175693443a358a0bc4   5f7dfa0f170ce23d8c20535bd653e52cc1a347094db801e80e91a3b1abb6d791        6xZM93y4ZvRGUHqs4c6uDRfhixkUcp3rDgirfwF4eLhR    2026-05-07 15:59:31.647 2026-05-07 15:57:31.657632      2026-05-07 15:58:07.078 \N
6       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    sec:7+c25:8     SOL     ETH     SOL     ETH     0.1     0x37042d7f2693acf7a319de6d5dad239d4a3777b0      encrypt:848c082d23eff4f4d7dcc1b990b9c4d12b5a8220b2714066f108a9475f06ca01        a4892548b78db8fb54312928cff8ab4a87c7ac53f0d9d1fecdc813642c1b0314        settled custom-a632fa6d [{"toChain": "ETH", "toToken": "ETH", "solverId": "custom-a632fa6d", "expiresAt": 1778205914869, "feeAmount": "0.000099", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.099, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002498", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 87, "erc7683Compliant": true, "estimatedSeconds": 53, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:B16bjFmu… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778205918146, "feeAmount": "0.000130", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002497", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 29, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.049% — targeting the lowest fee at 0.13% to win the bid while remaining above the 0.1% profitability floor. Market rate: 0.1 SOL = 0.0025 ETH, applying 0.13% fee yields 0.0025 * (1 - 0.0013) = 0.0024967, rounded to 0.002497 ETH. Low volatility environment makes tight pricing safe."}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778205914869, "feeAmount": "0.000179", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Aggressive Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002496", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 51, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778205914869, "feeAmount": "0.000180", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.18, "solverName": "Delta Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002495", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 75, "erc7683Compliant": true, "estimatedSeconds": 53, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"sla": "Guaranteed <30s EVM, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778205914869, "feeAmount": "0.000301", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.301, "solverName": "Instant Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002492", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 19, "solverDescription": "Delivery tercepat di semua EVM chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778205914869, "feeAmount": "0.000349", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.349, "solverName": "Epsilon Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002491", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 76, "erc7683Compliant": true, "estimatedSeconds": 35, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}, {"sla": "Guaranteed 25s EVM, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778205914869, "feeAmount": "0.000458", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.458, "solverName": "Premium Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002489", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 34, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}]      4bQQgESxGkbS1DivotYUXxaB5r841bA7FEvc6xFy97Y45Yc4cxTkmLuNWvmvQBn6MSyA99eZpBnWEzrcpvM5FvDk        0xbd6d2c4546ae0361ddfe7073023d7a808561578e9b4d0107ab9966500810c557|https://sepolia.etherscan.io/tx/0xbd6d2c4546ae0361ddfe7073023d7a808561578e9b4d0107ab9966500810c557   cd6c81b914a8d3358c76ab58c1f4aa4532bde2bc1ea4eee83f7fc0b2cc07da8c        B16bjFmuNyqckan36x45a4Toni4yvhZTiwUXx91X7vYw    2026-05-08 02:05:18.146 2026-05-08 02:03:18.148704      2026-05-08 02:03:42.218 \N
7       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    \N      SOL     ETH     PYUSD   PYUSD   100     \N      encrypt:4ad11959b8e347ec894cdfef184ce500b51771dbfcc1c1fd97611820e5d9b1ae        44ff8a02e8cb804a3dcae8d67a82ab1633a09880019fec384059e8ac1c821594        bidding \N      [{"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-f57a1ee4", "expiresAt": 1778350466971, "feeAmount": "0.099172", "fromChain": "SOL", "fromToken": "PYUSD", "feePercent": 0.099, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "100.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "99.900828", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 79, "erc7683Compliant": true, "estimatedSeconds": 39, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:5mNNGZa1… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-delta", "expiresAt": 1778350466971, "feeAmount": "0.181441", "fromChain": "SOL", "fromToken": "PYUSD", "feePercent": 0.181, "solverName": "Delta Solver", "inputAmount": "100.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "99.818559", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 71, "erc7683Compliant": true, "estimatedSeconds": 43, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-epsilon", "expiresAt": 1778350466971, "feeAmount": "0.349734", "fromChain": "SOL", "fromToken": "PYUSD", "feePercent": 0.35, "solverName": "Epsilon Solver", "inputAmount": "100.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "99.650266", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 78, "erc7683Compliant": true, "estimatedSeconds": 39, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}, {"sla": "Guaranteed 15-30s cross-chain", "toChain": "ETH", "toToken": "PYUSD", "solverId": "solver-pyusd", "expiresAt": 1778350466971, "feeAmount": "0.149982", "fromChain": "SOL", "fromToken": "PYUSD", "feePercent": 0.15, "solverName": "PYUSD Bridge Solver (PayPal)", "inputAmount": "100.000000", "chainDetails": {"network": "Cross-chain", "nativeSign": "Ika Curve25519 + Secp256k1", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "99.600393", "solverStrategy": "pyusd", "reputationScore": 98, "erc7683Compliant": true, "estimatedSeconds": 24, "solverDescription": "Specialist PayPal USD cross-chain solver. Handles PYUSD(SOL)↔PYUSD(ETH), PYUSD↔SOL, PYUSD↔ETH. Contracts: CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM (SOL devnet) · 0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9 (ETH Sepolia). Ultra-low 0.15% fee on stablecoin bridge routes."}]        \N      \N      \N      \N      2026-05-09 18:14:26.971 2026-05-09 18:12:26.982627      2026-05-09 18:12:26.982627      \N
5       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    sec:7+c25:8     SOL     ETH     SOL     ETH     0.1     0x37042d7f2693acf7a319de6d5dad239d4a3777b0      encrypt:e0fcc57a176f3437dd03a522060b60e0eadfb2db8da44a8e1eea221ed1e19b5b        762f01dc51f2be0645d8820be719e759d813591de8982766b1d85f847cf23712        settled solver-ai       [{"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778204755098, "feeAmount": "0.000130", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002497", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 29, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.049% — targeting the lowest competitive fee at 0.13% to win the bid while remaining above the 0.1% minimum profitability threshold. Market conversion is straightforward at 0.025 ETH per SOL, low volatility conditions make tight pricing safe. Output: 0.1 SOL * 0.025 = 0.0025 ETH base, minus 0.13% fee = 0.0025 * (1 - 0.0013) = 0.0024968 ≈ 0.002497 ETH."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-ea7e5fef", "expiresAt": 1778204751253, "feeAmount": "0.000100", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002497", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 77, "erc7683Compliant": true, "estimatedSeconds": 52, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:B16bjFmu… ETH:0xFe4957…"}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778204751252, "feeAmount": "0.000179", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Aggressive Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002496", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 48, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778204751253, "feeAmount": "0.000179", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Delta Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002496", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 84, "erc7683Compliant": true, "estimatedSeconds": 38, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"sla": "Guaranteed <30s EVM, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778204751252, "feeAmount": "0.000301", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.301, "solverName": "Instant Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002492", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 17, "solverDescription": "Delivery tercepat di semua EVM chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778204751253, "feeAmount": "0.000353", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.353, "solverName": "Epsilon Solver", "inputAmount": "0.100000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002491", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 88, "erc7683Compliant": true, "estimatedSeconds": 37, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}, {"sla": "Guaranteed 25s EVM, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778204751252, "feeAmount": "0.000460", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.46, "solverName": "Premium Solver", "inputAmount": "0.100000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.002488", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 32, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}] 4x14ij2Mia3pCXv4Y8ygySGdn9L3e1BoBYPSk5CAYKHtPRky2azyj7SVhPuQJ1QgtURFXSkaZh1i7LvodPqfR77m        sim_eth_0x1fbebc2338acae282e9cb17c380ae2329ea3814ce2c01a79c584796fe6fabe9b      207c299c0880e548781a387b0299df7907d6950e2176ba57e17ee259b15dca49        B16bjFmuNyqckan36x45a4Toni4yvhZTiwUXx91X7vYw    2026-05-08 01:45:55.098 2026-05-08 01:43:55.108887      2026-05-08 01:44:10.412 \N
8       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    \N      SOL     ETH     SOL     PYUSD   1       \N      encrypt:15bc4ceb8d8b7c84102cc2a324dceb52a0acf15e94aac4d7cc109e2a7fc8bc43        9adbc3fab249fe2ed6dd349779fafac7a68ed83ebd89969de5065d6da1e23b17        bidding \N      [{"sla": "Guaranteed 15-30s cross-chain", "toChain": "ETH", "toToken": "PYUSD", "solverId": "solver-pyusd", "expiresAt": 1778350469181, "feeAmount": "0.001495", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.15, "solverName": "PYUSD Bridge Solver (PayPal)", "inputAmount": "1.000000", "chainDetails": {"network": "Cross-chain", "nativeSign": "Ika Curve25519 + Secp256k1", "explorerUrl": "https://explorer.solana.com/?cluster=devnet"}, "outputAmount": "93.080605", "solverStrategy": "pyusd", "reputationScore": 98, "erc7683Compliant": true, "estimatedSeconds": 26, "solverDescription": "Specialist PayPal USD cross-chain solver. Handles PYUSD(SOL)↔PYUSD(ETH), PYUSD↔SOL, PYUSD↔ETH. Contracts: CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM (SOL devnet) · 0xCaC524BcA292aaade2DF8A05cC58F0a65B1B3bB9 (ETH Sepolia). Ultra-low 0.15% fee on stablecoin bridge routes."}, {"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-f57a1ee4", "expiresAt": 1778350469181, "feeAmount": "0.000999", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "1.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.999001", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 83, "erc7683Compliant": true, "estimatedSeconds": 45, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:5mNNGZa1… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-delta", "expiresAt": 1778350469181, "feeAmount": "0.001815", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.181, "solverName": "Delta Solver", "inputAmount": "1.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.998185", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 74, "erc7683Compliant": true, "estimatedSeconds": 42, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"toChain": "ETH", "toToken": "PYUSD", "solverId": "custom-epsilon", "expiresAt": 1778350469181, "feeAmount": "0.003506", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.351, "solverName": "Epsilon Solver", "inputAmount": "1.000000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.996494", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 80, "erc7683Compliant": true, "estimatedSeconds": 43, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}]    \N      \N      \N      \N      2026-05-09 18:14:29.181 2026-05-09 18:12:29.182682      2026-05-09 18:12:29.182682      \N
10      F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    sec:7+c25:8     SOL     ETH     SOL     ETH     0.5     0x37042d7f2693acf7a319de6d5dad239d4a3777b0      encrypt:9396ed99dc16343e4ea8f72c8a82373059e01c8246f1ee49ab0d5c0877c67e2e        c83862d0608a299478d301e055d4ff17a306fda20fb4ecbdbe25e1176dd5cb95        settled solver-ai       [{"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778457151001, "feeAmount": "0.000650", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020309", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 27, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.05% on fee (0.13% vs 0.18%), offering higher output of 0.020309 ETH vs their 0.020296. Market conversion of 0.5 SOL = 0.020333 ETH baseline, applying 0.13% fee yields competitive output while maintaining profitability above 0.1% minimum threshold."}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778457147998, "feeAmount": "0.000901", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.18, "solverName": "Aggressive Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020296", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 42, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"sla": "Guaranteed <30s ETH, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778457147998, "feeAmount": "0.001505", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.301, "solverName": "Instant Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020272", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 18, "solverDescription": "Delivery tercepat di semua chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"sla": "Guaranteed 25s ETH, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778457147998, "feeAmount": "0.002289", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.458, "solverName": "Premium Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020240", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 31, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-119359ac", "expiresAt": 1778457147998, "feeAmount": "0.000501", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012487", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 71, "erc7683Compliant": true, "estimatedSeconds": 41, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:9siBhwYQ… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778457147998, "feeAmount": "0.000896", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Delta Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012478", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 89, "erc7683Compliant": true, "estimatedSeconds": 52, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778457147998, "feeAmount": "0.001761", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.352, "solverName": "Epsilon Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012456", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 77, "erc7683Compliant": true, "estimatedSeconds": 48, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}]      3h3GgRQNFtYezfmEq6saXZzShoNCvDit9g7fmrEmdoxM1v3S1MDCDZqeceoCXCmQyzkzSfExwx1nhsmztiRFRru3        0x2b1030b89d5667a001f88f921e8ca908a582397a41bdebb6ad869efbf78b0efa|https://sepolia.etherscan.io/tx/0x2b1030b89d5667a001f88f921e8ca908a582397a41bdebb6ad869efbf78b0efa   3c1b4fd82e8714a0e3a413d39de62a17945be1df4851864cb28a7b08bb2f01be        9siBhwYQjPxFYbP8iqmDyjQztciFP6qPmzW97LXZrKqP    2026-05-10 23:52:31.001 2026-05-10 23:50:31.011425      2026-05-10 23:50:55.811 \N
11      F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    \N      SOL     ETH     SOL     ETH     0.5     0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA      encrypt:c158aa6c2cb0d616b90e7e25cb4418d0459f4fffc6e47a94a81a52ca7c3b12b2        b10ac18f827a36d0fb4377897d6693caf57d3353dcb128ca4c46e70f8b171c47        bidding \N      [{"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778530232447, "feeAmount": "0.000600", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.12, "solverName": "AI Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020943", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 27, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.059% — targeting the lowest fee at 0.12% to win the bid while remaining above the 0.1% minimum profitability threshold. Market conditions are stable, making tight pricing safe."}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778530228715, "feeAmount": "0.000896", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Aggressive Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020930", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 49, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"sla": "Guaranteed <30s ETH, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778530228715, "feeAmount": "0.001495", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.299, "solverName": "Instant Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020905", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 17, "solverDescription": "Delivery tercepat di semua chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"sla": "Guaranteed 25s ETH, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778530228715, "feeAmount": "0.002299", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.46, "solverName": "Premium Solver", "inputAmount": "0.500000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.020871", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 32, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-d65c3070", "expiresAt": 1778530228717, "feeAmount": "0.000502", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012487", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 74, "erc7683Compliant": true, "estimatedSeconds": 48, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:4Gh4n483… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778530228717, "feeAmount": "0.000897", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Delta Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012478", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 81, "erc7683Compliant": true, "estimatedSeconds": 51, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778530228717, "feeAmount": "0.001750", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.35, "solverName": "Epsilon Solver", "inputAmount": "0.500000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012456", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 82, "erc7683Compliant": true, "estimatedSeconds": 43, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}]      \N      \N      \N      \N      2026-05-11 20:10:32.447 2026-05-11 20:08:32.449459      2026-05-11 20:08:32.449459      \N
12      F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85    \N      SOL     ETH     SOL     ETH     0.3     0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA      encrypt:e08158c15f50023dcf41443308a697ceaa83afbab065100fcd810f0b4b0ac9c1        291c3da2a2cd8c6ae1e7b4bf35d811a33f0fe2a8dfb5b0fcf358f15ec6033841        settled solver-ai       [{"toChain": "ETH", "toToken": "ETH", "solverId": "solver-ai", "expiresAt": 1778530481442, "feeAmount": "0.000390", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.13, "solverName": "AI Solver", "inputAmount": "0.300000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012563", "solverStrategy": "ai", "reputationScore": 96, "erc7683Compliant": true, "estimatedSeconds": 29, "solverDescription": "Autonomous Claude-powered solver. Strategy: Underbid Aggressive Solver by 0.05% — at 0.13% fee vs their 0.18%, offering higher output of 0.012563 ETH to win the bid while maintaining profitability above the 0.1% minimum threshold. Market conversion of 0.3 SOL = ~0.012582 ETH gross, leaving margin for fees and execution costs."}, {"sla": "Best-effort, 60-120s", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-alpha", "expiresAt": 1778530475385, "feeAmount": "0.000540", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.18, "solverName": "Aggressive Solver", "inputAmount": "0.300000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012559", "solverStrategy": "aggressive", "reputationScore": 97, "erc7683Compliant": true, "estimatedSeconds": 49, "solverDescription": "Selalu underbid kompetitor. Fee terendah di market, harga output terbaik. Cocok untuk swap besar yang memprioritaskan nilai."}, {"sla": "Guaranteed <30s ETH, <15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-beta", "expiresAt": 1778530475385, "feeAmount": "0.000903", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.301, "solverName": "Instant Solver", "inputAmount": "0.300000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012544", "solverStrategy": "instant", "reputationScore": 95, "erc7683Compliant": true, "estimatedSeconds": 12, "solverDescription": "Delivery tercepat di semua chains. Pre-funded liquidity pools untuk instant settlement. Fee medium, kecepatan premium."}, {"sla": "Guaranteed 25s ETH, 15s SOL", "toChain": "ETH", "toToken": "ETH", "solverId": "solver-gamma", "expiresAt": 1778530475385, "feeAmount": "0.001377", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.459, "solverName": "Premium Solver", "inputAmount": "0.300000", "chainDetails": {"network": "Ethereum Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.012524", "solverStrategy": "premium", "reputationScore": 99, "erc7683Compliant": true, "estimatedSeconds": 28, "solverDescription": "Coverage terluas + guaranteed 25s SLA. Success rate 99.8%. Cocok untuk intent kritikal."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-77c60d68", "expiresAt": 1778530475386, "feeAmount": "0.000299", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.1, "solverName": "🟢 Live Solver (Private Intent)", "inputAmount": "0.300000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.007493", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "0xFe4957467b528e6E4F2712DCD3C2D4BaB2CDb6AA", "reputationScore": 79, "erc7683Compliant": true, "estimatedSeconds": 40, "solverDescription": "Real testnet solver — actual on-chain execution. SOL:4Gh4n483… ETH:0xFe4957…"}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-delta", "expiresAt": 1778530475386, "feeAmount": "0.000537", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.179, "solverName": "Delta Solver", "inputAmount": "0.300000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.007487", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "DeLTAxyz123456789abcdefghijklmnop", "reputationScore": 79, "erc7683Compliant": true, "estimatedSeconds": 42, "solverDescription": "Community-run solver specializing in SOL↔ETH routes. Low fee, fast settlement."}, {"toChain": "ETH", "toToken": "ETH", "solverId": "custom-epsilon", "expiresAt": 1778530475386, "feeAmount": "0.001041", "fromChain": "SOL", "fromToken": "SOL", "feePercent": 0.347, "solverName": "Epsilon Solver", "inputAmount": "0.300000", "chainDetails": {"network": "ETH Sepolia", "nativeSign": "Ika Secp256k1 EcdsaKeccak256", "explorerUrl": "https://sepolia.etherscan.io"}, "outputAmount": "0.007474", "isCustomSolver": true, "solverStrategy": "custom", "operatorAddress": "EPSiLoNxyz987654321zyxwvutsrqponm", "reputationScore": 89, "erc7683Compliant": true, "estimatedSeconds": 51, "solverDescription": "Institutional solver with deep ETH liquidity. Guaranteed 25s ETH delivery SLA."}]  \N      0x5743b075591f0ddd10aa5cbc514c43da2a704267ad524acdde4842cc4706e8ee|https://sepolia.etherscan.io/tx/0x5743b075591f0ddd10aa5cbc514c43da2a704267ad524acdde4842cc4706e8ee   d040737f1fda9435f350c88f52631ec50889fa2c4cdd054326ae678eebab78b4        4Gh4n483VTuqV7yqEvjG3wGs71VQ48TwMBmqZf5kqcdh    2026-05-11 20:14:41.442 2026-05-11 20:12:41.452071      2026-05-11 20:12:52.121 \N
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.messages (id, conversation_id, role, content, created_at) FROM stdin;
\.


--
-- Data for Name: native_wallets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.native_wallets (id, chain, curve, public_key_hex, eth_address, btc_address, sol_address, attestation_hex, network_sig_hex, network_pubkey_hex, mode, created_at, phantom_pubkey) FROM stdin;
7       ethereum+bitcoin        secp256k1       03e28c18e39f9f6c053d3ac063e22737aa89b89b82bc4f2f4fc6f39c3ae3ef6e24      0x53C706D9366D9B022d210C32fe753AF95960c17B      tb1qmd9pasvc9vahc2ugf7pyj2uj5vq2d53gq0fzna      \N      00b035b00077e4a175797ba0aeac63891c021a09d0f8362c4df4632c28cebe942320791ffdc1b0c5fe7e418a1d0dd0fc1c823b9a40f0411b46b6c20f5d2c05d40373002103e28c18e39f9f6c053d3ac063e22737aa89b89b82bc4f2f4fc6f39c3ae3ef6e242103e28c18e39f9f6c053d3ac063e22737aa89b89b82bc4f2f4fc6f39c3ae3ef6e240000      ffcb755b0da4321a5fa7b0d68ed0d5e598d8014995d32655dc6f53e71525d257b0d4c62102ba446740a40bf2facaaf3d99223f1d900c57daa6a2906d36fc2103        ae574cfa320624c36e26428c81e65b24214b02a09373ae2a28714fd1d7a9c475        devnet  2026-05-07 13:57:19.593006      F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85
8       solana  curve25519      1b3ecc76a02d7c1005cec57df778efba72d620a2fc10f3c003b3143d30279336        \N      \N      2qMYkAivjdZRy6vY4RjhJ46EeeihygKCYJnCkF68gPoB    00812542cb7c17880bfcd927eb169da6f570b517026dc549423e770b7d5c701c9120791ffdc1b0c5fe7e418a1d0dd0fc1c823b9a40f0411b46b6c20f5d2c05d4037302201b3ecc76a02d7c1005cec57df778efba72d620a2fc10f3c003b3143d30279336201b3ecc76a02d7c1005cec57df778efba72d620a2fc10f3c003b3143d302793360000  817b18e692dfbb60628b7f32ca4612514a28bb4411d2d9304115b4d3216b4248a4fab1632fa1213acc9de34dc30c5844594847a556f6db150750df76a240ab05        ae574cfa320624c36e26428c81e65b24214b02a09373ae2a28714fd1d7a9c475        devnet  2026-05-07 13:57:19.60224       F4z99M2aYKo7yC8dRxSNhmM6Exfk7TTcdsQUaLaUcT85
\.


--
-- Data for Name: policies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.policies (id, wallet_address, max_spend_per_tx_usd, max_daily_spend_usd, block_new_contracts, max_sell_tax_percent, whitelisted_protocols, target_allocations, encrypted_ref, updated_at) FROM stdin;
\.


--
-- Data for Name: vault_balances; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vault_balances (id, address, sol, eth, updated_at) FROM stdin;
1       DsNnXFU5x39NMx9Urz8SESiC1nHF4QCTFRbskfVmQhUe    1.500000000     0.000000000     2026-05-09 07:10:24.543
\.


--
-- Data for Name: vault_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.vault_history (id, address, type, token, amount, stealth_address, ts) FROM stdin;
1       DsNnXFU5x39NMx9Urz8SESiC1nHF4QCTFRbskfVmQhUe    deposit SOL     1.500000000     \N      2026-05-09 07:05:45.015319
2       DsNnXFU5x39NMx9Urz8SESiC1nHF4QCTFRbskfVmQhUe    withdraw        SOL     0.500000000     8SiWFnT9GJuC9rSqjGGoMPceZchKMgreqG6WLrdQZkH     2026-05-09 07:05:54.939348
3       DsNnXFU5x39NMx9Urz8SESiC1nHF4QCTFRbskfVmQhUe    deposit SOL     0.500000000     \N      2026-05-09 07:10:24.576586
\.


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_jobs_id_seq', 1, false);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 1, false);


--
-- Name: conversations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversations_id_seq', 1, false);


--
-- Name: dwallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dwallets_id_seq', 1, false);


--
-- Name: intents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.intents_id_seq', 12, true);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.messages_id_seq', 1, false);


--
-- Name: native_wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.native_wallets_id_seq', 8, true);


--
-- Name: policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.policies_id_seq', 1, false);


--
-- Name: vault_balances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vault_balances_id_seq', 3, true);


--
-- Name: vault_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vault_history_id_seq', 3, true);


--
-- Name: agent_jobs agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: agent_jobs agent_jobs_wallet_address_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_wallet_address_unique UNIQUE (wallet_address);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: dwallets dwallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dwallets
    ADD CONSTRAINT dwallets_pkey PRIMARY KEY (id);


--
-- Name: dwallets dwallets_wallet_address_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dwallets
    ADD CONSTRAINT dwallets_wallet_address_unique UNIQUE (wallet_address);


--
-- Name: intents intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intents
    ADD CONSTRAINT intents_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: native_wallets native_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.native_wallets
    ADD CONSTRAINT native_wallets_pkey PRIMARY KEY (id);


--
-- Name: policies policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_pkey PRIMARY KEY (id);


--
-- Name: policies policies_wallet_address_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_wallet_address_unique UNIQUE (wallet_address);


--
-- Name: vault_balances vault_balances_address_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_balances
    ADD CONSTRAINT vault_balances_address_unique UNIQUE (address);


--
-- Name: vault_balances vault_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_balances
    ADD CONSTRAINT vault_balances_pkey PRIMARY KEY (id);


--
-- Name: vault_history vault_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_history
    ADD CONSTRAINT vault_history_pkey PRIMARY KEY (id);


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 8x0zPRItzuOn5mtrUZheR7LRVTy2pKLRZYDlKd9vkc9lFIdQlNRsq1Hk3JreVVT

