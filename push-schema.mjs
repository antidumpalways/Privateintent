import { default as pg } from "pg";
import { readFileSync } from "fs";

const { Pool } = pg;
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_BUz7mW4GePXO@ep-weathered-glade-apn3hkht.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require",
});

const sql = readFileSync("./lib/db/src/migrations/0000_base_schema.sql", "utf8");
try {
  await pool.query(sql);
  console.log("Schema pushed OK");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}