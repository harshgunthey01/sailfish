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
} from "@carbon/react";
import { api } from "../api";

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
  const [droplets, setDroplets] = useState<Droplet[]>([]);
  const [regions, setRegions] = useState<RegionSpend[]>([]);
  const [totals, setTotals] = useState({ attributed: 0, unattributed: 0, total: 0, mtd: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    </Grid>
  );
}
