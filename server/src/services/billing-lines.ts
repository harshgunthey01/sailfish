import type { BillingDataPoint } from "../do/client.js";

/**
 * Shared Billing Insights line parsing (MONITORING.md §A).
 * Used by the sync writer (billing_daily) — same rules as the one-off
 * backfill script, promoted here so both stay consistent.
 */

export type Bucket = "ai" | "ai_credit" | "tax" | "credit" | "core";

const AI_USAGE_PREFIX = "1-AI-";
const AI_CREDIT_PREFIX = "1-DO-AI";
const TAX_SKU_PREFIX = "1-DO-ADJMT-00TAX";

export function bucketOf(p: BillingDataPoint): Bucket {
  const sku = (p.sku ?? "").toUpperCase();
  const amount = parseFloat(p.total_amount) || 0;
  if (sku.startsWith(TAX_SKU_PREFIX)) return "tax";
  if (sku.startsWith(AI_CREDIT_PREFIX)) return amount < 0 ? "credit" : "ai_credit";
  if (sku.startsWith(AI_USAGE_PREFIX)) return amount < 0 ? "credit" : "ai";
  if (amount < 0) return "credit";
  return "core";
}

/** Friendly model id for AI lines; bucket name for everything else. */
export function modelKeyOf(p: BillingDataPoint, bucket: Bucket): string {
  if (bucket === "ai_credit") return "ai_credit_purchase";
  if (bucket !== "ai") return bucket;
  const d = (p.description ?? "").toLowerCase();
  if (d.includes("v4.1") && d.includes("flash")) return "deepseek-v4.1-flash";
  if (d.includes("deepseek4 flash") || d.includes("deepseek-4")) return "deepseek-4-flash";
  if (d.includes("qwen3.8-max")) return "qwen3.8-max";
  if (d.includes("glm5.3 flash")) return "glm-5.3-flash";
  if (d.includes("glm 5.3")) return "glm-5.3";
  if (d.includes("gpt-oss-120b")) return "openai-gpt-oss-120b";
  return "other-ai";
}

/** Token counts from "(N @ $P/thousand)" descriptions; outputs → completion. */
export function tokensOf(p: BillingDataPoint): { pt: number; ct: number } {
  const m = /\(([\d,]+)\s*@/.exec(p.description ?? "");
  const n = m?.[1] ? parseInt(m[1].replace(/,/g, ""), 10) || 0 : 0;
  const d = (p.description ?? "").toLowerCase();
  if (d.includes("output")) return { pt: 0, ct: n };
  return { pt: n, ct: 0 };
}

/** $/1M rate annotations; outputs → output leg, cache reads → cache leg. */
export function ratesOf(p: BillingDataPoint): { input?: number; output?: number; cache?: number } {
  const m = /@ \$([\d.]+)\/thousand/.exec(p.description ?? "");
  if (!m?.[1]) return {};
  const per1m = Math.round(parseFloat(m[1]) * 1000 * 1e6) / 1e6;
  if (!Number.isFinite(per1m) || per1m <= 0) return {};
  const d = (p.description ?? "").toLowerCase();
  if (d.includes("cache") && d.includes("read")) return { cache: per1m };
  if (d.includes("output")) return { output: per1m };
  return { input: per1m };
}

/** True for cache lines that are NOT reads (e.g. future creation/write SKUs). */
export function isCacheOther(p: BillingDataPoint): boolean {
  const dd = (p.description ?? "").toLowerCase();
  return dd.includes("cache") && !dd.includes("read");
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
