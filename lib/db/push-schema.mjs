import { pool } from "./src/index.js";
import { readFileSync } from "fs";

const sql = readFileSync("./src/migrations/0000_base_schema.sql", "utf8");
try {
  await pool.query(sql);
  console.log("Schema pushed OK");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}