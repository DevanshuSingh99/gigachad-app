'use client';

import {
  Card,
  CardBody,
  ScrollShadow,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Tabs,
  Tab,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/AppShell';
import { type AnalyticsRange, useAnalyticsOverview } from '@/lib/analytics';
import { useActiveWorkspace } from '@/lib/session';

/**
 * HeroUI's default-theme primary/secondary — validated as a categorical pair
 * with the dataviz skill's `validate_palette.js` (CVD ΔE 7.8, in the 6-8 floor
 * band, legal because both series here also carry a legend + direct hover
 * labels, not color alone). Literal hex, not a `bg-primary`-style Tailwind
 * class: Recharts strokes/fills are static SVG attributes, so they don't
 * follow a `dark:` variant automatically the way HeroUI's own components do.
 */
const COLOR_PRIMARY = '#006FEE';
const COLOR_SECONDARY = '#7828c8';

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
];

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card shadow="none" className="border-divider border">
      <CardBody className="gap-1">
        <p className="text-default-500 text-xs">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="text-default-400 text-xs">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function AnalyticsScreen() {
  const router = useRouter();
  const { workspace, isAdmin } = useActiveWorkspace();
  const workspaceId = workspace?.workspaceId;
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const overview = useAnalyticsOverview(workspaceId, range);

  // This page is Admin-only, not merely Admin-enhanced (unlike /members,
  // which Agents can view read-only) — an Agent who navigates here directly
  // is redirected rather than shown a partial page. The API's requireAdmin
  // guard is the real enforcement; this is UX only.
  useEffect(() => {
    if (workspace && !isAdmin) router.replace('/inbox');
  }, [workspace, isAdmin, router]);

  if (!workspace || !isAdmin) {
    return null;
  }

  const data = overview.data;

  return (
    <ScrollShadow className="h-full">
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
            <p className="text-default-500 text-sm">
              Response times, resolution, volume, and agent performance.
            </p>
          </div>
          <Tabs
            size="sm"
            aria-label="Date range"
            selectedKey={range}
            onSelectionChange={(key) => setRange(key as AnalyticsRange)}
          >
            {RANGES.map((r) => (
              <Tab key={r.key} title={r.label} />
            ))}
          </Tabs>
        </div>

        {overview.isPending ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-large" />
            ))}
          </div>
        ) : !data ? (
          <p className="text-default-500 text-sm">Could not load analytics.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Conversations" value={String(data.volume.total)} />
              <StatTile
                label="Resolution rate"
                value={formatPercent(data.resolution.resolutionRate)}
                hint={`${data.resolution.resolvedCount} resolved`}
              />
              <StatTile
                label="Avg first response"
                value={formatMinutes(data.responseTime.avgFirstResponseMinutes)}
                hint={
                  data.responseTime.medianFirstResponseMinutes !== null
                    ? `median ${formatMinutes(data.responseTime.medianFirstResponseMinutes)}`
                    : undefined
                }
              />
              <StatTile
                label="Avg resolution time"
                value={formatMinutes(data.resolution.avgResolutionMinutes)}
                hint={
                  data.resolution.medianResolutionMinutes !== null
                    ? `median ${formatMinutes(data.resolution.medianResolutionMinutes)}`
                    : undefined
                }
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card shadow="none" className="border-divider border">
                <CardBody className="gap-3">
                  <div>
                    <p className="text-sm font-medium">Volume trend</p>
                    <p className="text-default-500 text-xs">
                      Conversations vs. messages, {data.volume.byChannel.map((c) => `${c.channel.toLowerCase()} ${c.count}`).join(' · ')}
                    </p>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.volumeTrend}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="conversations"
                          name="Conversations"
                          stroke={COLOR_PRIMARY}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="messages"
                          name="Messages"
                          stroke={COLOR_SECONDARY}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>

              <Card shadow="none" className="border-divider border">
                <CardBody className="gap-3">
                  <div>
                    <p className="text-sm font-medium">Busiest hours</p>
                    <p className="text-default-500 text-xs">Message volume by hour of day, UTC.</p>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.busiestHours}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={1} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                        <Tooltip />
                        <Bar dataKey="count" name="Messages" fill={COLOR_PRIMARY} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card shadow="none" className="border-divider border">
              <CardBody className="gap-3">
                <p className="text-sm font-medium">Agent performance</p>
                {data.agentPerformance.length === 0 ? (
                  <p className="text-default-500 text-sm">No assigned conversations in this range.</p>
                ) : (
                  <Table aria-label="Agent performance" removeWrapper>
                    <TableHeader>
                      <TableColumn>AGENT</TableColumn>
                      <TableColumn>HANDLED</TableColumn>
                      <TableColumn>RESOLVED</TableColumn>
                      <TableColumn>AVG FIRST RESPONSE</TableColumn>
                      <TableColumn>AVG RESOLUTION</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {data.agentPerformance.map((agent) => (
                        <TableRow key={agent.userId}>
                          <TableCell>{agent.name}</TableCell>
                          <TableCell>{agent.conversationsHandled}</TableCell>
                          <TableCell>{agent.resolvedCount}</TableCell>
                          <TableCell>{formatMinutes(agent.avgFirstResponseMinutes)}</TableCell>
                          <TableCell>{formatMinutes(agent.avgResolutionMinutes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </ScrollShadow>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell>
      <AnalyticsScreen />
    </AppShell>
  );
}
