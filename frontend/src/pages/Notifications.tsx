import React from 'react';
import { Bell, Check, CheckCheck, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, NotificationItem } from '../api/client';
import { queryKeys } from '../api/queryKeys';

interface NotificationsResponse {
  unread_count: number;
  notifications: NotificationItem[];
}

export const NotificationsPage: React.FC = () => {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: queryKeys.notifications,
    queryFn: () => api.getNotifications(),
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unread_count ?? 0;

  // Optimistic Mark Single Read with Rollback (A5)
  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.markNotificationRead(id),
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: queryKeys.notifications });
      const prev = qc.getQueryData<NotificationsResponse>(queryKeys.notifications);
      if (prev) {
        const target = prev.notifications.find((n) => n.id === id);
        const wasUnread = target && !target.is_read;
        qc.setQueryData<NotificationsResponse>(queryKeys.notifications, {
          unread_count: wasUnread ? Math.max(0, prev.unread_count - 1) : prev.unread_count,
          notifications: prev.notifications.map((n) =>
            n.id === id ? { ...n, is_read: true } : n
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.notifications, ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  // Optimistic Mark All Read with Rollback (A5)
  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.notifications });
      const prev = qc.getQueryData<NotificationsResponse>(queryKeys.notifications);
      if (prev) {
        qc.setQueryData<NotificationsResponse>(queryKeys.notifications, {
          unread_count: 0,
          notifications: prev.notifications.map((n) => ({ ...n, is_read: true })),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.notifications, ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '820px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Notifications</h1>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            Activity alerts, scan reports, and share status updates.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: queryKeys.notifications })}
            className="btn btn-secondary"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {unreadCount > 0 && (
            <button
              data-testid="page-mark-all-read-btn"
              onClick={() => markAllReadMutation.mutate()}
              className="btn btn-primary"
            >
              <CheckCheck size={14} /> Mark all as read ({unreadCount})
            </button>
          )}
        </div>
      </div>

      <div className="craft-card" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
            <span className="mono" style={{ fontSize: '13px' }}>Loading alerts...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
            <Bell size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ fontSize: '14px' }}>No notifications for your account.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {notifications.map((n) => (
              <div
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: n.is_read ? 'transparent' : 'var(--accent-soft)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '16px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)', marginBottom: '4px' }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {n.message}
                  </div>
                  <div className="mono" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>

                {!n.is_read && (
                  <button
                    data-testid={`mark-read-btn-${n.id}`}
                    onClick={() => markReadMutation.mutate(n.id)}
                    className="btn btn-secondary btn-sm"
                    title="Mark as read"
                  >
                    <Check size={13} /> Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
