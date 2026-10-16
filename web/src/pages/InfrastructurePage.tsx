import React, { useEffect, useState } from "react";
import {
  Grid,
  Column,
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  Tag,
  InlineNotification,
  InlineLoading,
  Dropdown,
  Button,
  NumberInput,
} from "@carbon/react";
import { AreaChart } from "@carbon/charts-react";
import { api } from "../api";
import { useAppTheme } from "../theme";

interface Droplet {
  id: number;
  name: string;
  status?: string;
  region?: string;
  size?: string;
  created_at?: string;
  tags?: string[];
}

interface RegionSpend {
  region: string;
  amount_usd: number;
  droplets: string[];
  attributed: boolean;
}

export default function InfrastructurePage() {
  const { dark } = useAppTheme();
  const chartTheme = dark ? "g100" : "g10";
  const [droplets, setDroplets] = useState<Droplet[]>([]);
  const [invDatabases, setInvDatabases] = useState<any[]>([]);
  const [inv, setInv] = useState<Record<string, any[]>>({});
  const [waste, setWaste] = useState<{
    detached_volumes: any[];
    old_snapshots: any[];
    unattached_ips: any[];
  } | null>(null);
  const [regions, setRegions] = useState<RegionSpend[]>([]);
  const [totals, setTotals] = useState({ attributed: 0, unattributed: 0, total: 0, mtd: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- host metrics (MONITORING.md Phase 3/B1; needs a droplet to show data) ----
  // Names are the exact DO monitoring paths (spec-verified; no plain `memory`).
  const METRICS = [
    "cpu",
    "load_1",
    "load_5",
    "load_15",
    "memory_available",
    "memory_free",
    "memory_total",
    "memory_cached",
    "filesystem_free",
    "filesystem_size",
  ];
  const [metricHost, setMetricHost] = useState("");
  const [metric, setMetric] = useState("cpu");
  const [metricHours, setMetricHours] = useState(24);
  const [metricPoints, setMetricPoints] = useState<any[]>([]);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    if (!metricHost) return;
    setMetricLoading(true);
    setMetricError(null);
    try {
      const r = await api.get<{ data: any }>(
        `/infrastructure/metrics?host_id=${encodeURIComponent(metricHost)}&metric=${encodeURIComponent(metric)}&hours=${metricHours}`
      );
      const series: any[] = [];
      const results = r.data?.data?.result ?? r.data?.result ?? [];
      for (const s of results) {
        for (const [ts, val] of s.values ?? []) {
          const n = parseFloat(val);
          if (Number.isFinite(n)) {
            series.push({
              group: s.metric?.mode ?? s.metric?.device ?? metric,
              date: new Date(Number(ts) * 1000).getTime(),
              value: Math.round(n * 10000) / 10000,
            });
          }
        }
      }
      setMetricPoints(series);
      if (!series.length) setMetricError("No datapoints returned for this window.");
    } catch (e: any) {
      setMetricError(e?.body?.error ?? e?.message ?? "Metrics fetch failed");
    } finally {
      setMetricLoading(false);
    }
  };

  useEffect(() => {
    api
      .get<{
        droplets: Droplet[];
        regions: RegionSpend[];
        attributed_usd: number;
        unattributed_usd: number;
        total_usd: number;
        core_compute_mtd: number;
      }>("/infrastructure/summary")
      .then((r) => {
        setDroplets(r.droplets);
        setRegions(r.regions);
        setTotals({
          attributed: r.attributed_usd,
          unattributed: r.unattributed_usd,
          total: r.total_usd,
          mtd: r.core_compute_mtd,
        });
        setError(null);
      })
      .catch((e: any) =>
        setError(e?.body?.error ?? e?.message ?? "Failed to load infrastructure")
      )
      .finally(() => setLoading(false));
    api
      .get<{
        databases: any[];
        microvms: any[];
        kubernetes: any[];
        apps: any[];
        volumes: any[];
        snapshots: any[];
        load_balancers: any[];
        reserved_ips: any[];
        functions: any[];
        cdn: any[];
        domains: any[];
        agents: any[];
        waste: { detached_volumes: any[]; old_snapshots: any[]; unattached_ips: any[] };
      }>("/infrastructure/inventory")
      .then((r) => {
        setInvDatabases(r.databases);
        setInv({
          microvms: r.microvms,
          kubernetes: r.kubernetes,
          apps: r.apps,
          volumes: r.volumes,
          snapshots: r.snapshots,
          load_balancers: r.load_balancers,
          reserved_ips: r.reserved_ips,
          functions: r.functions,
          cdn: r.cdn,
          domains: r.domains,
          agents: r.agents,
        });
        setWaste(r.waste);
      })
      .catch(() => {});
  }, []);

  return (
    <Grid narrow className="sf-content">
      <Column sm={4} md={8} lg={16}>
        <h3>Infrastructure</h3>
        <p className="sf-muted" style={{ marginBottom: "1rem" }}>
          Core-compute droplet inventory with month-to-date cost attribution. Regional
          spend is assigned to a droplet only when it is the sole droplet there —
          everything else stays shared. Read-only: no power actions.
        </p>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not load infrastructure"
            subtitle={error}
            lowContrast
            style={{ marginBottom: "1rem" }}
          />
        )}
        {loading && <InlineLoading description="Loading…" />}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "0.5rem 0" }}>
          Droplets{" "}
          <Tag type={droplets.length ? "blue" : "cool-gray"}>{droplets.length}</Tag>
        </h5>
        {droplets.length > 0 ? (
          <StructuredListWrapper>
            <StructuredListHead>
              <StructuredListRow head>
                <StructuredListCell head>Name</StructuredListCell>
                <StructuredListCell head>Status</StructuredListCell>
                <StructuredListCell head>Region</StructuredListCell>
                <StructuredListCell head>Size</StructuredListCell>
                <StructuredListCell head>Created</StructuredListCell>
              </StructuredListRow>
            </StructuredListHead>
            <StructuredListBody>
              {droplets.map((d) => (
                <StructuredListRow key={d.id}>
                  <StructuredListCell>{d.name}</StructuredListCell>
                  <StructuredListCell>
                    <Tag type={d.status === "active" ? "green" : "gray"}>{d.status ?? "—"}</Tag>
                  </StructuredListCell>
                  <StructuredListCell>{d.region ?? "—"}</StructuredListCell>
                  <StructuredListCell>{d.size ?? "—"}</StructuredListCell>
                  <StructuredListCell>
                    {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                  </StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
        ) : (
          !loading && (
            <p className="sf-muted">
              No droplets on this account — core-compute spend stays $0.00 until you
              create one.
            </p>
          )
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>
          Databases <Tag type={invDatabases.length ? "blue" : "cool-gray"}>{invDatabases.length}</Tag>
        </h5>
        {invDatabases.length > 0 ? (
          <StructuredListWrapper>
            <StructuredListHead>
              <StructuredListRow head>
                <StructuredListCell head>Name</StructuredListCell>
                <StructuredListCell head>Engine</StructuredListCell>
                <StructuredListCell head>Size</StructuredListCell>
                <StructuredListCell head>Region</StructuredListCell>
                <StructuredListCell head>Status</StructuredListCell>
              </StructuredListRow>
            </StructuredListHead>
            <StructuredListBody>
              {invDatabases.map((d: any) => (
                <StructuredListRow key={d.id ?? d.name}>
                  <StructuredListCell>{d.name}</StructuredListCell>
                  <StructuredListCell>
                    {d.engine}
                    {d.version ? ` ${d.version}` : ""}
                  </StructuredListCell>
                  <StructuredListCell>{d.size ?? "—"}</StructuredListCell>
                  <StructuredListCell>{d.region ?? "—"}</StructuredListCell>
                  <StructuredListCell>
                    <Tag type={d.status === "online" ? "green" : "gray"}>{d.status ?? "—"}</Tag>
                  </StructuredListCell>
                </StructuredListRow>
              ))}
            </StructuredListBody>
          </StructuredListWrapper>
        ) : (
          !loading && <p className="sf-muted">No managed databases.</p>
        )}
        <p className="sf-muted" style={{ marginTop: "0.5rem" }}>
          Note: DigitalOcean exposes usage metrics for MySQL clusters only — Postgres,
          Redis, and Kafka clusters show inventory without metric charts.
        </p>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Idle waste</h5>
        {!waste ? (
          <p className="sf-muted">Checking…</p>
        ) : waste.detached_volumes.length + waste.old_snapshots.length + waste.unattached_ips.length === 0 ? (
          <p className="sf-muted">
            <Tag type="green">all clear</Tag> No detached volumes, no snapshots older
            than 90 days, no unattached IPs.
          </p>
        ) : (
          <>
            {waste.detached_volumes.map((v: any) => (
              <p key={v.id} className="sf-muted">
                <Tag type="red">volume</Tag> {v.name} ({v.size_gb} GB, {v.region}) —
                detached, still billed.
              </p>
            ))}
            {waste.old_snapshots.map((s: any) => (
              <p key={s.id} className="sf-muted">
                <Tag type="red">snapshot</Tag> {s.name} ({s.resource_type},{" "}
                {s.created_at ? new Date(s.created_at).toLocaleDateString() : "?"}) — older
                than 90 days.
              </p>
            ))}
            {waste.unattached_ips.map((r: any) => (
              <p key={r.ip} className="sf-muted">
                <Tag type="red">IP</Tag> {r.ip} ({r.region}) — unattached, still billed.
              </p>
            ))}
          </>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Core spend by region (month-to-date)</h5>
        {regions.length > 0 ? (
          <>
            <StructuredListWrapper>
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>Region</StructuredListCell>
                  <StructuredListCell head>Amount</StructuredListCell>
                  <StructuredListCell head>Attribution</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {regions.map((r) => (
                  <StructuredListRow key={r.region}>
                    <StructuredListCell>{r.region}</StructuredListCell>
                    <StructuredListCell>${r.amount_usd.toFixed(2)}</StructuredListCell>
                    <StructuredListCell>
                      {r.attributed ? (
                        <Tag type="green">{r.droplets[0]}</Tag>
                      ) : (
                        <span className="sf-muted">
                          shared{r.droplets.length ? ` (${r.droplets.join(", ")})` : ""}
                        </span>
                      )}
                    </StructuredListCell>
                  </StructuredListRow>
                ))}
              </StructuredListBody>
            </StructuredListWrapper>
            <p className="sf-muted" style={{ marginTop: "0.5rem" }}>
              Attributed ${totals.attributed.toFixed(2)} · shared $
              {totals.unattributed.toFixed(2)} · total ${totals.total.toFixed(2)} (tile: $
              {totals.mtd.toFixed(2)})
            </p>
          </>
        ) : (
          !loading && <p className="sf-muted">No core-compute spend this month.</p>
        )}
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Other products</h5>
        {[
          { key: "microvms", label: "MicroVMs", detail: (x: any) => `${x.status ?? ""} ${x.region ?? ""}`.trim() },
          { key: "kubernetes", label: "Kubernetes", detail: (x: any) => `${x.status ?? ""} · ${x.size ?? ""}`.trim() },
          { key: "apps", label: "App Platform", detail: (x: any) => x.status ?? "" },
          { key: "volumes", label: "Volumes", detail: (x: any) => `${x.size_gb ?? "?"} GB · ${(x.attached_to ?? []).length ? "attached" : "detached"}` },
          { key: "snapshots", label: "Snapshots", detail: (x: any) => `${x.resource_type ?? ""}`.trim() },
          { key: "load_balancers", label: "Load balancers", detail: (x: any) => `${x.status ?? ""} ${x.region ?? ""}`.trim() },
          { key: "reserved_ips", label: "Reserved IPs", detail: (x: any) => (x.attached_to ? `→ ${x.attached_to}` : "unattached") },
          { key: "functions", label: "Functions", detail: (x: any) => x.region ?? "" },
          { key: "cdn", label: "CDN endpoints", detail: (x: any) => x.status ?? "" },
          { key: "domains", label: "Domains", detail: () => "" },
          {
            key: "agents",
            label: "GenAI agents",
            detail: (x: any) => (x.usage ? "usage tracked" : "no usage data"),
          },
        ].map((p) => {
          const items = inv[p.key] ?? [];
          if (!items.length) return null;
          return (
            <div key={p.key} style={{ marginBottom: "0.75rem" }}>
              <strong>{p.label}</strong>{" "}
              <Tag type="blue">{items.length}</Tag>
              {items.slice(0, 20).map((x: any) => (
                <div key={x.id ?? x.ip ?? x.name} className="sf-muted">
                  {x.name ?? x.ip}
                  {p.detail(x) ? ` — ${p.detail(x)}` : ""}
                </div>
              ))}
            </div>
          );
        })}
        {!loading &&
          ["microvms", "kubernetes", "apps", "volumes", "snapshots", "load_balancers", "reserved_ips", "functions", "cdn", "domains", "agents"].every(
            (k) => (inv[k] ?? []).length === 0
          ) && (
            <p className="sf-muted">
              Nothing else on this account. Spaces has no bucket-inventory API —
              its usage appears as billing lines only.
            </p>
          )}
        <p className="sf-muted" style={{ marginTop: "0.5rem" }}>
          Spaces has no bucket-inventory endpoint; its spend shows under billing only.
        </p>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <h5 style={{ margin: "1.5rem 0 0.5rem" }}>Host metrics</h5>
        {droplets.length === 0 && !loading ? (
          <p className="sf-muted">No droplets — nothing to monitor yet.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
              <Dropdown
                id="metric-host"
                titleText="Droplet"
                label="droplet"
                items={droplets.map((d) => String(d.id))}
                itemToString={(id: string) => droplets.find((d) => String(d.id) === id)?.name ?? id}
                selectedItem={metricHost}
                onChange={({ selectedItem }: any) => setMetricHost(selectedItem)}
              />
              <Dropdown
                id="metric-name"
                titleText="Metric"
                label="metric"
                items={METRICS}
                selectedItem={metric}
                onChange={({ selectedItem }: any) => setMetric(selectedItem)}
              />
              <NumberInput
                id="metric-hours"
                label="Hours"
                min={1}
                max={168}
                value={metricHours}
                onChange={(e: any) => setMetricHours(Number(e.target.value))}
              />
              <Button kind="primary" disabled={metricLoading || !metricHost} onClick={fetchMetrics}>
                {metricLoading ? <InlineLoading /> : "Load metrics"}
              </Button>
            </div>
            {metricError && (
              <InlineNotification
                kind="error"
                title="Metrics failed"
                subtitle={metricError}
                lowContrast
                style={{ marginTop: "0.75rem" }}
              />
            )}
            {metricPoints.length > 0 && (
              <AreaChart
                key={`host-${chartTheme}`}
                data={metricPoints}
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
            )}
          </>
        )}
      </Column>
    </Grid>
  );
}
