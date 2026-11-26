// Administrator dashboard showing server-side API endpoint statistics and registered user consumption.
import { useEffect, useState } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import type { EndpointStat, PortalDashboard } from '../shared/portal.js';
import { InboxApi } from './InboxApi.js';

type DescribeError = (error: unknown) => string;

const formatTimestamp = (value: string) => new Date(value).toLocaleString();

export function AdminDashboard({ describeError }: { describeError: DescribeError }) {
  const [data, setData] = useState<PortalDashboard>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    InboxApi.request<PortalDashboard>('/admin/dashboard', 'GET', undefined, controller.signal)
      .then(dashboard => {
        if (!controller.signal.aborted) setData(dashboard);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(describeError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, describeError]);

  const refresh = () => setAttempt(count => count + 1);

  return <section className="portal-card portal-dashboard" aria-labelledby="admin-dashboard-heading">
    <div className="portal-dashboard-header">
      <div>
        <h1 id="admin-dashboard-heading">{labels.adminDashboard}</h1>
        <p className="portal-muted portal-dashboard-subtitle">{labels.dashboardSubtitle}</p>
      </div>
      <button type="button" className="portal-secondary" disabled={loading} onClick={refresh}>
        {loading && data ? labels.refreshing : labels.refresh}
      </button>
    </div>

    {error && <p className="portal-error" role="alert">{error}{' '}
      <button type="button" className="portal-secondary" onClick={refresh}>{en.retry}</button>
    </p>}

    {data ? <>
      <EndpointStatisticsSection endpoints={data.endpoints} />
      <hr className="portal-divider" />
      <RegisteredUsersSection users={data.users} />
    </> : !error && <p className="portal-muted">{en.loading}</p>}
  </section>;
}

function EndpointStatisticsSection({ endpoints }: { endpoints: EndpointStat[] }) {
  const totalRequests = endpoints.reduce((sum, item) => sum + item.requests, 0);
  const maxRequests = endpoints.reduce((max, item) => Math.max(max, item.requests), 0);

  return <section aria-labelledby="endpoint-stats-heading">
    <div className="portal-section-header">
      <h2 id="endpoint-stats-heading">{labels.endpointStats}</h2>
      <span className="portal-total-pill">{labels.totalRequestsSummary(totalRequests)}</span>
    </div>
    {endpoints.length ? <div className="portal-table-wrap"><table>
      <thead><tr>
        <th>{labels.method}</th>
        <th>{labels.endpoint}</th>
        <th className="portal-share-col">{labels.trafficShare}</th>
        <th className="portal-numeric">{labels.totalRequests}</th>
      </tr></thead>
      <tbody>{endpoints.map(stat => {
        const sharePercent = maxRequests > 0 ? Math.round((stat.requests / maxRequests) * 100) : 0;
        return <tr key={`${stat.method} ${stat.endpoint}`}>
          <td><span className={`portal-method ${stat.method.toLowerCase()}`}>{stat.method}</span></td>
          <td className="portal-endpoint"><code>{stat.endpoint}</code></td>
          <td className="portal-share-col">
            <div className="portal-share-track" aria-hidden="true">
              <div className="portal-share-fill" style={{ width: `${sharePercent}%` }} />
            </div>
          </td>
          <td className="portal-numeric">{stat.requests}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="portal-muted">{labels.emptyEndpointStats}</p>}
  </section>;
}

function RegisteredUsersSection({ users }: { users: PortalDashboard['users'] }) {
  return <section aria-labelledby="registered-users-heading">
    <h2 id="registered-users-heading">{labels.accounts}</h2>
    <div className="portal-table-wrap"><table>
      <thead><tr>
        <th>{labels.email}</th>
        <th>{labels.role}</th>
        <th>{labels.joined}</th>
        <th className="portal-numeric">{labels.requestCount}</th>
      </tr></thead>
      <tbody>{users.map(user => <tr key={user.id}>
        <td>{user.email}</td>
        <td>{user.role === 'admin' ? labels.admin : labels.user}</td>
        <td>{formatTimestamp(user.createdAt)}</td>
        <td className="portal-numeric">{user.requests}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
