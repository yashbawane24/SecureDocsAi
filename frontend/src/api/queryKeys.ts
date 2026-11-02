import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

export const queryKeys = {
  me: ['auth', 'me'] as const,
  allowedRecipients: ['auth', 'allowed-recipients'] as const,
  orgSettings: ['org', 'settings'] as const,
  dashboardMetrics: ['dashboard', 'metrics'] as const,
  notifications: ['notifications'] as const,
  documents: (riskFilterOrParams?: string | { risk_level?: string; search?: string }) =>
    riskFilterOrParams
      ? (['documents', riskFilterOrParams] as const)
      : (['documents'] as const),
  documentsAll: ['documents'] as const,
  documentDetail: (id: number | string) => ['documents', 'detail', String(id)] as const,
  documentAnalysis: (id: number | string) => ['documents', 'analysis', String(id)] as const,
  documentFindings: (id: number | string) => ['documents', 'analysis', String(id)] as const,
  myShares: ['shares', 'my-shares'] as const,
  sharedWithMe: ['shares', 'shared-with-me'] as const,
  approvals: (statusFilter?: string) =>
    statusFilter && statusFilter !== 'ALL'
      ? (['approvals', { statusFilter }] as const)
      : (['approvals'] as const),
  approvalsAll: ['approvals'] as const,
  members: (filters?: { search?: string; role?: string; department?: string; status?: string }) =>
    filters ? (['members', filters] as const) : (['members'] as const),
  membersAll: ['members'] as const,
  orgTree: ['members', 'tree'] as const,
  invites: ['members', 'invites'] as const,
  roles: ['roles'] as const,
  departments: ['departments'] as const,
  auditLogs: (filters?: {
    action?: string;
    result?: string;
    actor_email?: string;
    date_from?: string;
    date_to?: string;
  }) => (filters ? (['audit', filters] as const) : (['audit'] as const)),
  auditAll: ['audit'] as const,
};
