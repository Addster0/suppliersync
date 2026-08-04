#!/usr/bin/env node
/**
 * Diagnostic: invoke extract-contract with a tiny PDF (no secrets printed).
 * Usage: node scripts/test-contract-extract.mjs [user_jwt]
 * Optional: TEST_ORG_ID=<uuid> for authenticated extract test.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) throw new Error("Missing .env.local");
  const env = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function minimalContractPdfBase64() {
  return readFileSync(join(root, "scripts/fixtures/sample-contract.pdf")).toString("base64");
}

async function post(url, apiKey, bearer, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const env = loadEnv();
const url = `${env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/extract-contract`;
const apiKey = env.VITE_SUPABASE_ANON_KEY;
const userJwt = process.argv[2]?.trim();

console.log("1) Status probe (anon)...");
const status = await post(url, apiKey, apiKey, { mode: "status" });
console.log(`   HTTP ${status.status}:`, JSON.stringify(status.json));

console.log("\n2) Extract without user JWT (expect 401)...");
const noAuth = await post(url, apiKey, apiKey, {
  mode: "extract",
  organizationId: "00000000-0000-0000-0000-000000000001",
  fileName: "sample-contract.pdf",
  fileBase64: minimalContractPdfBase64(),
});
console.log(`   HTTP ${noAuth.status}:`, JSON.stringify(noAuth.json));

if (userJwt) {
  console.log("\n3) Extract with user JWT...");
  const orgId = process.env.TEST_ORG_ID?.trim();
  if (!orgId) {
    console.log("   Skip — set TEST_ORG_ID env var to your workspace UUID.");
  } else {
    const extract = await post(url, apiKey, userJwt, {
      mode: "extract",
      organizationId: orgId,
      fileName: "sample-contract.pdf",
      fileBase64: minimalContractPdfBase64(),
    });
    console.log(`   HTTP ${extract.status}:`, JSON.stringify(extract.json, null, 2));
  }
} else {
  console.log("\n3) Skipped — pass a user JWT as argv[1] for full extract test.");
}
