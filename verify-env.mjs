import 'dotenv/config';
console.log('DB=', !!process.env.DATABASE_URL);
console.log('SOLANA_DEVNET_PUBKEY=', process.env.SOLANA_DEVNET_PUBKEY);
const arrRaw = process.env.SOLANA_SECRET_KEY_ARRAY || '';
const arr = arrRaw.replaceAll('[','').replaceAll(']','').split(',').map(x => x.trim()).filter(Boolean);
console.log('SOLANA_SECRET_KEY_ARRAY length=', arr.length);
console.log('FIRST=', arr[0]);
