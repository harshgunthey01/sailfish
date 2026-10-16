import React, { useEffect, useMemo, useState } from "react";
import {
  Grid,
  Column,
  ClickableTile,
  Button,
  InlineLoading,
  InlineNotification,
  Tag,
  ProgressBar,
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
} from "@carbon/react";
import { AreaChart, DonutChart } from "@carbon/charts-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAppTheme } from "../theme";

interface BillingSummary {
  state: {
    compute_balance: number;
    core_compute_mtd?: number;
    ai_usage_mtd?: number;
    tax_mtd?: number;
    account_balance?: number;
    prepaid_amount?: number;
    inference_balance: number;
    is_blocked: number;
    last_synced: string;
  };
  payments?: Array<{ description?: string; amount?: string; date?: string; type?: string }>;
  history: Array<{ ts: string; compute_balance: number; inference_balance: number }>;
}

export default function Dashboard() {
  const { dark } = useAppTheme();
  const navigate = useNavigate();
  // Carbon charts bake their palette at construction and never re-theme live,
  // so pass the active theme AND remount on toggle (key) to keep colors,
  // gridlines, and tooltips matched to the page in both modes.
  const chartTheme = dark ? "g100" : "g10";
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [byModel, setByModel] = useState<any[]>([]);
  const [daily, setDaily] = useState<any[]>([]);
  const [forecast, setForecast] = useState<{
    daily_rate_usd: number;
    projected_month_end_usd: number;
    days_in_month: number;
    month: string;
    credit_remaining_usd: number | null;
    credit_as_of: string | null;
    days_of_credit_left: number | null;
    basis: string;
  } | null>(null);
  const [credit, setCredit] = useState<{ remaining: number | null; as_of: string | null }>({
    remaining: null,
    as_of: null,
  });
  const [cache, setCache] = useState<{
    overall: { hit_ratio: number | null; cache_tokens: number; est_savings_usd: number };
    by_model: Array<{
      model_key: string;
      cache_tokens: number;
      input_tokens: number;
      hit_ratio: number | null;
      est_savings_usd: number | null;
      rates: string;
    }>;
  } | null>(null);
  const [health, setHealth] = useState<{
    last_ts: string | null;
    last_ok: boolean | null;
    consecutive_failures: number;
    failures_24h: number;
  } | null>(null);
  const [incidents, setIncidents] = useState<
    Array<{ id: string; name: string; status: string; shortlink: string }>
  >([]);
  const [budgets, setBudgets] = useState<
    Array<{
      id: string;
      name: string;
      scope: string;
      amount_usd: number;
      is_active: boolean;
      spend_usd: number;
      pct: number;
      projected_eom_usd: number;
      on_pace_to_exceed: boolean;
    }>
  >([]);
  const [syncing, setSyncing] = useState(false);

  const load = () =>
    Promise.all([
      api.get<BillingSummary>("/billing/summary"),
      api.get<{ series: any[] }>("/telemetry/series?days=7"),
      api.get<{ by_model: any[] }>("/telemetry/by-model?days=7"),
      api.get<{ days: any[] }>("/billing/daily?days=30"),
      api.get<{ remaining: number | null; as_of: string | null }>("/setup/credit"),
      api.get<{
        daily_rate_usd: number;
        projected_month_end_usd: number;
        days_in_month: number;
        month: string;
        credit_remaining_usd: number | null;
        credit_as_of: string | null;
        days_of_credit_left: number | null;
        basis: string;
      }>("/billing/forecast"),
      api.get<{
        overall: { hit_ratio: number | null; cache_tokens: number; est_savings_usd: number };
        by_model: Array<{
          model_key: string;
          cache_tokens: number;
          input_tokens: number;
          hit_ratio: number | null;
          est_savings_usd: number | null;
          rates: string;
        }>;
      }>("/billing/cache?days=30"),
      api.get<{ budgets: any[] }>("/notifications/budgets"),
      api.get<{
        last_ts: string | null;
        last_ok: boolean | null;
        consecutive_failures: number;
        failures_24h: number;
      }>("/billing/health"),
      api.get<{
        incidents: Array<{ id: string; name: string; status: string; shortlink: string }>;
      }>("/billing/status"),
    ])
      .then(([b, s, m, d, c, f, ch, bg, h, st]) => {
        setBilling(b);
        setSeries(s.series);
        setByModel(m.by_model as any[]);
        setDaily(d.days);
        setCredit(c);
        setForecast(f);
        setCache(ch);
        setBudgets(bg.budgets);
        setHealth(h);
        setIncidents(st.incidents);
      })
      .catch(() => {});

  useEffect(() => {
    load();
    const h = setInterval(load, 60_000);
    return () => clearInterval(h);
  }, []);

  const areaData = useMemo(
    () =>
      series.map((r) => ({
        group: r.model_id,
        date: new Date(r.hour_ts).getTime(),
        value: r.prompt_tokens + r.completion_tokens,
      })),
    [series]
  );

  const donutData = useMemo(
    () =>
      (byModel as any[]).map((r: any) => ({
        group: r.model_id,
        // 6-decimal precision: real sub-cent costs (e.g. $0.000033) must not round to 0
        value: Math.round((r.cost ?? 0) * 1e6) / 1e6,
      })),
    [byModel]
  );

  // Stacked daily spend by model (billing_daily). Non-model buckets (tax,
  // credits, one-off purchases) are excluded so model trends stay readable.
  const dailyData = useMemo(
    () =>
      (daily as any[])
        .filter((r: any) => !["tax", "credit", "ai_credit_purchase"].includes(r.model_key))
        .map((r: any) => ({
          group: r.model_key,
          date: new Date(r.day + "T00:00:00Z").getTime(),
          value: Math.round((r.amount ?? 0) * 1e6) / 1e6,
        })),
    [daily]
  );

  const s = billing?.state;
  const activeBudgets = budgets.filter((b) => b.is_active);
  const showBudget = activeBudgets.length
    ? activeBudgets.reduce((a, b) => (b.pct >= a.pct ? b : a))
    : null;
  const payments = billing?.payments ?? [];
  const paidIn = payments
    .filter((p) => p.type === "Payment")
    .reduce((sum, p) => sum + Math.abs(parseFloat(p.amount ?? "0") || 0), 0);
  const latestPayment = payments[0];

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Dashboard</h3>
          <Button
            kind="ghost"
            size="sm"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await api.post("/billing/sync").catch(() => {});
              await load();
              setSyncing(false);
            }}
          >
            {syncing ? <InlineLoading /> : "Sync now"}
          </Button>
        </div>
      </Column>

      {incidents.length > 0 && (
        <Column sm={4} md={8} lg={16}>
          {incidents.map((i) => (
            <InlineNotification
              key={i.id}
              kind="warning"
              title="DigitalOcean incident"
              subtitle={`${i.name} (${i.status})${i.shortlink ? ` — ${i.shortlink}` : ""}`}
              lowContrast
              style={{ marginBottom: "0.5rem" }}
            />
          ))}
        </Column>
      )}

      <Column sm={4} md={4} lg={4}>
        <ClickableTile onClick={load}>
          <div className="sf-muted">Core Compute (month-to-date)</div>
          <div className="sf-stat-number">
            ${s && s.core_compute_mtd != null ? s.core_compute_mtd.toFixed(2) : s ? s.compute_balance.toFixed(2) : "—"}
          </div>
          <div className="sf-muted">
            last synced {s ? new Date(s.last_synced).toLocaleString() : "never"}
          </div>
        </ClickableTile>
      </Column>

      <Column sm={4} md={4} lg={4}>
        <ClickableTile onClick={load}>
          <div className="sf-muted">GenAI Usage (month-to-date)</div>
          <div className="sf-stat-number">
            ${s && s.ai_usage_mtd != null ? s.ai_usage_mtd.toFixed(2) : "—"}
          </div>
          {s && s.tax_mtd != null && s.tax_mtd > 0 && (
            <div className="sf-muted">incl. tax ${s.tax_mtd.toFixed(2)}</div>
          )}
        </ClickableTile>
      </Column>

      <Column sm={4} md={4} lg={4}>
        <ClickableTile onClick={load}>
          <div className="sf-muted">Prepaid Inference (remaining)</div>
          <div className="sf-stat-number">
            ${s ? s.inference_balance.toFixed(2) : "—"}
          </div>
          {s && s.prepaid_amount != null && s.prepaid_amount > 0 ? (
            <div className="sf-muted">of ${s.prepaid_amount.toFixed(2)} prepaid</div>
          ) : (
            <div className="sf-muted">no prepaid plan</div>
          )}
          {s?.is_blocked === 1 && <Tag type="red">threshold breached</Tag>}
        </ClickableTile>
      </Column>

      <Column sm={4} md={4} lg={4}>
        <ClickableTile onClick={load}>
          <div className="sf-muted">Account Payments</div>
          <div className="sf-stat-number">
            {payments.length > 0 ? `$${paidIn.toFixed(2)}` : "—"}
          </div>
          {latestPayment ? (
            <div className="sf-muted">
              {latestPayment.description} ·{" "}
              {latestPayment.date ? new Date(latestPayment.date).toLocaleDateString() : ""}
            </div>
          ) : (
            <div className="sf-muted">no payments recorded</div>
          )}
          {credit.remaining != null ? (
            <div className="sf-muted">
              AI credit left: ${credit.remaining.toFixed(2)} (DO page{credit.as_of ? `, ${credit.as_of}` : ""})
            </div>
          ) : (
            <div className="sf-muted">Live credit balance is on your DO billing page</div>
          )}
        </ClickableTile>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {forecast ? (
          <p className="sf-muted" style={{ margin: "0.25rem 0 0" }}>
            ≈ ${forecast.daily_rate_usd.toFixed(2)}/day → ${forecast.projected_month_end_usd.toFixed(2)} by{" "}
            {forecast.month}-{String(forecast.days_in_month).padStart(2, "0")}
            {forecast.days_of_credit_left != null && forecast.credit_as_of
              ? ` · ~${forecast.days_of_credit_left} days of credit left (as of ${forecast.credit_as_of})`
              : " · set AI credit in Settings for days-left"}
          </p>
        ) : null}
        {showBudget && (
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}
          >
            <div style={{ flex: 1, maxWidth: "320px" }}>
              <ProgressBar
                label=""
                hideLabel
                value={Math.min(showBudget.pct, 100)}
                max={100}
                status={showBudget.pct >= 100 ? "error" : "active"}
              />
            </div>
            <button
              onClick={() => navigate("/settings")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--cds-link-primary, #0f62fe)",
                fontSize: "0.85rem",
              }}
            >
              {showBudget.name}: {showBudget.pct.toFixed(0)}% of ${showBudget.amount_usd}
              {showBudget.on_pace_to_exceed ? " · over pace" : ""}
            </button>
          </div>
        )}
        {health && (
          <p className="sf-muted" style={{ margin: "0.5rem 0 0" }}>
            Sync {health.last_ok === false ? "FAILED" : "OK"}
            {health.last_ts ? ` ${new Date(health.last_ts + "Z").toLocaleString()}` : ""} ·{" "}
            {health.failures_24h} failure(s) (24h)
            {health.consecutive_failures > 1 ? ` · ${health.consecutive_failures} in a row` : ""}
          </p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1rem 0 0.5rem" }}>Token burn rate (7 days)</h5>
        {areaData.length > 0 ? (
          <AreaChart
            key={`area-${chartTheme}`}
            data={areaData}
            options={{
              theme: chartTheme,
              axes: {
                left: { mapsTo: "value" },
                bottom: { scaleType: "time", mapsTo: "date" },
              },
              height: "260px",
              curve: "curveMonotoneX",
            } as any}
          />
        ) : (
          <p className="sf-muted">
            No telemetry yet. Push usage objects to{" "}
            <code>POST /api/v1/telemetry/ingest</code>.
          </p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1rem 0 0.5rem" }}>Cost distribution by model (7 days)</h5>
        {donutData.length > 0 ? (
          <DonutChart
            key={`donut-${chartTheme}`}
            data={donutData}
            options={{ theme: chartTheme, height: "260px" } as any}
          />
        ) : (
          <p className="sf-muted">No spend recorded yet.</p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1rem 0 0.5rem" }}>Cache effectiveness (30 days)</h5>
        {cache && cache.by_model.length > 0 ? (
          <>
            <p style={{ marginBottom: "0.75rem" }}>
              <span className="sf-stat-number">
                {cache.overall.hit_ratio != null
                  ? `${(cache.overall.hit_ratio * 100).toFixed(1)}%`
                  : "—"}
              </span>{" "}
              <span className="sf-muted">
                of input tokens served from cache · ≈ ${cache.overall.est_savings_usd.toFixed(2)} saved
                vs full input price
              </span>
            </p>
            <StructuredListWrapper>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>Model</StructuredListCell>
                  <StructuredListCell head>Hit %</StructuredListCell>
                  <StructuredListCell head>Cache tokens</StructuredListCell>
                  <StructuredListCell head>Saved</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {cache.by_model.map((r) => (
                  <StructuredListRow key={r.model_key}>
                    <StructuredListCell>{r.model_key}</StructuredListCell>
                    <StructuredListCell>
                      {r.hit_ratio != null ? `${(r.hit_ratio * 100).toFixed(1)}%` : (
                        <span className="sf-muted">no cache data</span>
                      )}
                    </StructuredListCell>
                    <StructuredListCell>{r.cache_tokens.toLocaleString()}</StructuredListCell>
                    <StructuredListCell>
                      {r.est_savings_usd != null ? (
                        `$${r.est_savings_usd.toFixed(2)}`
                      ) : (
                        <span className="sf-muted">rate unknown</span>
                      )}
                    </StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>
          </>
        ) : (
          <p className="sf-muted">No cache data yet.</p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1rem 0 0.5rem" }}>Spend by model over time (30 days)</h5>
        {dailyData.length > 0 ? (
          <AreaChart
            key={`daily-${chartTheme}`}
            data={dailyData}
            options={{
              theme: chartTheme,
              axes: {
                left: { mapsTo: "value", stacked: true },
                bottom: { scaleType: "time", mapsTo: "date" },
              },
              height: "260px",
              curve: "curveMonotoneX",
            } as any}
          />
        ) : (
          <p className="sf-muted">
            No daily billing history yet — it accumulates with each sync (backfilled from
            DigitalOcean insights).
          </p>
        )}
      </Column>
    </Grid>
  );
}
