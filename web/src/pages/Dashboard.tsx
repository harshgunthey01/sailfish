import React, { useEffect, useMemo, useState } from "react";
import {
  Grid,
  Column,
  ClickableTile,
  Button,
  InlineLoading,
  Tag,
} from "@carbon/react";
import { AreaChart, DonutChart } from "@carbon/charts-react";
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
  // Carbon charts bake their palette at construction and never re-theme live,
  // so pass the active theme AND remount on toggle (key) to keep colors,
  // gridlines, and tooltips matched to the page in both modes.
  const chartTheme = dark ? "g100" : "g10";
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [byModel, setByModel] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = () =>
    Promise.all([
      api.get<BillingSummary>("/billing/summary"),
      api.get<{ series: any[] }>("/telemetry/series?days=7"),
      api.get<{ by_model: any[] }>("/telemetry/by-model?days=7"),
    ])
      .then(([b, s, m]) => {
        setBilling(b);
        setSeries(s.series);
        setByModel(m.by_model as any[]);
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

  const s = billing?.state;
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
          <div className="sf-muted">Live credit balance is on your DO billing page</div>
        </ClickableTile>
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
    </Grid>
  );
}
