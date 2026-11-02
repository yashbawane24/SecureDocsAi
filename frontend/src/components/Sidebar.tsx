import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutGrid,
  Folder,
  Bell,
  FileText,
  Building2,
  Settings,
  User as UserIcon,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
  Search,
  MoreVertical,
  FileLock2,
  X,
  Shield,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, DocumentItem, User } from '../api/client';
import { queryKeys } from '../api/queryKeys';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

type BadgeTone = 'neutral' | 'danger';

interface NavChild {
  key: string;
  label: string;
  to: string;
  isActive: boolean;
  badge?: number;
  badgeTone?: BadgeTone;
  testId?: string;
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ElementType;
  children: NavChild[];
}

const COLLAPSE_KEY = 'sd.sidebar.collapsed';
const GROUPS_KEY = 'sd.sidebar.groups';

const Badge: React.FC<{ value: number; tone?: BadgeTone; testId?: string; floating?: boolean }> = ({
  value,
  tone = 'neutral',
  testId,
  floating,
}) => (
  <span
    data-testid={testId}
    className={`sb-badge ${tone === 'danger' ? 'sb-badge-danger' : ''} ${floating ? 'sb-badge-floating' : ''}`}
  >
    {value > 99 ? '99+' : value}
  </span>
);

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const { user, logout, hasPermission, theme, toggleTheme } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  // Command palette state (triggered by Search box or Cmd+K)
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultsDocs, setSearchResultsDocs] = useState<DocumentItem[]>([]);
  const [searchResultsUsers, setSearchResultsUsers] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const { data: sharedWithMe = [] } = useQuery({
    queryKey: queryKeys.sharedWithMe,
    queryFn: () => api.listSharedWithMe(),
    enabled: Boolean(user),
  });

  const { data: notifData } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.getNotifications(),
    enabled: Boolean(user),
  });

  const { data: metrics } = useQuery({
    queryKey: queryKeys.dashboardMetrics,
    queryFn: () => api.getDashboardMetrics(),
    enabled: Boolean(user),
  });

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: queryKeys.approvals('PENDING'),
    queryFn: () => api.listApprovals('PENDING'),
    enabled: Boolean(user),
  });

  const unopenedCount = sharedWithMe.filter(
    (s) => !s.first_opened_at && !s.is_revoked && !s.is_used && s.status === 'ACTIVE'
  ).length;
  const unreadNotifications = notifData?.unread_count || 0;
  const pendingJoinCount = metrics?.pending_members || 0;
  const pendingApprovalCount = pendingApprovals.length;

  // The collapsed rail only applies on desktop; the mobile drawer is always expanded.
  const isRail = collapsed && !mobileOpen;

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    document.documentElement.classList.toggle('sidebar-is-collapsed', collapsed);
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  // Handle Ctrl/Cmd+K for search command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isCommandOpen) {
        setIsCommandOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandOpen]);

  useEffect(() => {
    if (isCommandOpen) {
      setTimeout(() => commandInputRef.current?.focus(), 40);
    } else {
      setSearchQuery('');
      setSearchResultsDocs([]);
      setSearchResultsUsers([]);
    }
  }, [isCommandOpen]);

  // Global search execution
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResultsDocs([]);
      setSearchResultsUsers([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const [docs, members] = await Promise.allSettled([
          api.listDocuments(),
          api.listMembers({ search: searchQuery.trim() }),
        ]);

        if (docs.status === 'fulfilled') {
          const q = searchQuery.toLowerCase();
          setSearchResultsDocs(
            docs.value
              .filter(
                (d) =>
                  d.title.toLowerCase().includes(q) ||
                  d.original_filename.toLowerCase().includes(q)
              )
              .slice(0, 5)
          );
        }
        if (members.status === 'fulfilled') {
          setSearchResultsUsers(members.value.slice(0, 5));
        }
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const orgName = user.organization_name || user.organization?.name || 'Northwind Health';

  const userInitials = user.full_name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isOwnerOrAdmin = user.role === 'Owner' || user.role === 'Admin';

  const canSeeApprovals =
    isOwnerOrAdmin ||
    user.role === 'Department Head' ||
    user.role === 'Manager' ||
    hasPermission('shares.approve');

  const path = location.pathname;
  const search = location.search;
  const isUploadRoute = path === '/documents' && search.includes('upload=true');
  const isRiskAnalysisRoute = path === '/documents' && search.includes('view=risk');

  // ---------- Navigation model (same pages, permissions and badges as before) ----------
  const documentsChildren: NavChild[] = [
    { key: 'docs', label: 'My documents', to: '/documents', isActive: path === '/documents' && !isUploadRoute && !isRiskAnalysisRoute },
    { key: 'upload', label: 'Upload', to: '/documents?upload=true', isActive: isUploadRoute },
    {
      key: 'swm',
      label: 'Shared with me',
      to: '/shared-with-me',
      isActive: path.startsWith('/shared-with-me'),
      badge: unopenedCount,
      testId: 'sidebar-badge-shared-with-me',
    },
    { key: 'sbm', label: 'Shared by me', to: '/shared-by-me', isActive: path.startsWith('/shared-by-me') },
    { key: 'risk', label: 'Risk analysis', to: '/documents?view=risk', isActive: isRiskAnalysisRoute },
  ];
  if (canSeeApprovals) {
    documentsChildren.push({
      key: 'approvals',
      label: 'Approvals',
      to: '/approvals',
      isActive: path.startsWith('/approvals'),
      badge: pendingApprovalCount,
      badgeTone: 'danger',
      testId: 'sidebar-badge-approvals',
    });
  }

  const activityChildren: NavChild[] = [];
  if (hasPermission('audit.view') || isOwnerOrAdmin) {
    activityChildren.push({ key: 'audit', label: 'Audit log', to: '/audit-log', isActive: path.startsWith('/audit-log') });
  }
  if (isOwnerOrAdmin || user.role === 'Department Head' || user.role === 'Manager') {
    activityChildren.push({
      key: 'demo-inbox',
      label: 'Demo inbox',
      to: '/demo-inbox',
      isActive: path.startsWith('/demo-inbox'),
      testId: 'sidebar-nav-demo-inbox',
    });
  }

  const orgChildren: NavChild[] = [];
  if (
    hasPermission('members.manage') ||
    hasPermission('members.invite') ||
    hasPermission('members.approve') ||
    isOwnerOrAdmin ||
    user.role === 'Department Head'
  ) {
    orgChildren.push({ key: 'members', label: 'Members', to: '/members', isActive: path.startsWith('/members') });
  }
  if (hasPermission('members.invite') || hasPermission('members.approve') || isOwnerOrAdmin) {
    orgChildren.push({
      key: 'invites',
      label: 'Invitations & requests',
      to: '/invitations',
      isActive: path.startsWith('/invitations'),
      badge: pendingJoinCount,
      badgeTone: 'danger',
      testId: 'sidebar-badge-invitations',
    });
  }
  if (hasPermission('departments.manage') || isOwnerOrAdmin) {
    orgChildren.push({ key: 'depts', label: 'Departments', to: '/departments', isActive: path.startsWith('/departments') });
  }
  if (hasPermission('roles.manage') || isOwnerOrAdmin) {
    orgChildren.push({ key: 'roles', label: 'Roles & permissions', to: '/roles', isActive: path.startsWith('/roles') });
  }
  if (hasPermission('org.settings') || isOwnerOrAdmin) {
    orgChildren.push({ key: 'settings', label: 'Settings', to: '/settings', isActive: path.startsWith('/settings') });
  }

  const groups: NavGroup[] = [
    { key: 'documents', label: 'Documents', icon: Folder, children: documentsChildren },
    { key: 'activity', label: 'Activity', icon: Activity, children: activityChildren },
    { key: 'organisation', label: 'Organisation', icon: Building2, children: orgChildren },
  ].filter((g) => g.children.length > 0);

  // Like the reference: only the section containing the current page starts open.
  // Manual open/close choices are remembered.
  const isGroupOpen = (g: NavGroup) => openGroups[g.key] ?? g.children.some((c) => c.isActive);
  const toggleGroup = (g: NavGroup) => setOpenGroups((prev) => ({ ...prev, [g.key]: !isGroupOpen(g) }));

  const isDashboardActive = path === '/dashboard' || path === '/';

  const bottomItems = [
    {
      key: 'notifications',
      label: 'Notifications',
      to: '/notifications',
      icon: Bell,
      isActive: path.startsWith('/notifications'),
      badge: unreadNotifications,
      testId: 'sidebar-badge-notifications',
    },
    { key: 'security', label: 'Security', to: '/security', icon: Shield, isActive: path.startsWith('/security') },
    { key: 'profile', label: 'Profile', to: '/profile', icon: UserIcon, isActive: path.startsWith('/profile') },
  ];

  const go = () => onMobileClose?.();

  // ---------- Render helpers ----------
  const renderTopItem = (
    key: string,
    label: string,
    to: string,
    Icon: React.ElementType,
    active: boolean,
    badge?: number,
    badgeTone?: BadgeTone,
    testId?: string
  ) => (
    <NavLink
      key={key}
      to={to}
      end
      onClick={go}
      title={isRail ? label : undefined}
      className={`sb-item ${active ? 'is-active' : ''}`}
    >
      <span className="sb-item-icon">
        <Icon size={19} strokeWidth={1.75} />
        {isRail && badge ? <Badge value={badge} tone={badgeTone} floating /> : null}
      </span>
      {!isRail && <span className="sb-item-label">{label}</span>}
      {!isRail && badge ? <Badge value={badge} tone={badgeTone} testId={testId} /> : null}
    </NavLink>
  );

  const renderGroup = (g: NavGroup) => {
    const Icon = g.icon;
    const hasActiveChild = g.children.some((c) => c.isActive);
    const groupBadge = g.children.reduce((sum, c) => sum + (c.badge || 0), 0);
    const open = isGroupOpen(g);

    if (isRail) {
      // Rail: the group icon jumps to the first page in the group.
      return (
        <NavLink
          key={g.key}
          to={g.children[0].to}
          onClick={go}
          title={g.label}
          className={`sb-item ${hasActiveChild ? 'is-active' : ''}`}
        >
          <span className="sb-item-icon">
            <Icon size={19} strokeWidth={1.75} />
            {groupBadge > 0 && (
              <Badge
                value={groupBadge}
                tone={g.children.some((c) => c.badgeTone === 'danger' && c.badge) ? 'danger' : 'neutral'}
                floating
              />
            )}
          </span>
        </NavLink>
      );
    }

    return (
      <div key={g.key} className="sb-group">
        <button
          type="button"
          onClick={() => toggleGroup(g)}
          aria-expanded={open}
          className={`sb-item sb-group-trigger ${hasActiveChild && !open ? 'is-active' : ''} ${open ? 'is-open' : ''}`}
        >
          <span className="sb-item-icon">
            <Icon size={19} strokeWidth={1.75} />
          </span>
          <span className="sb-item-label">{g.label}</span>
          {!open && groupBadge > 0 && <Badge value={groupBadge} />}
          <ChevronDown size={16} strokeWidth={1.75} className="sb-chevron" />
        </button>

        <div className={`sb-sub ${open ? 'is-open' : ''}`}>
          <div className="sb-sub-inner">
            {g.children.map((c) => (
              <NavLink
                key={c.key}
                to={c.to}
                end
                onClick={go}
                tabIndex={open ? 0 : -1}
                className={`sb-subitem ${c.isActive ? 'is-active' : ''}`}
              >
                <span className="sb-item-label">{c.label}</span>
                {c.badge ? <Badge value={c.badge} tone={c.badgeTone} testId={c.testId} /> : null}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(21, 22, 24, 0.55)',
            backdropFilter: 'blur(2px)',
            zIndex: 90,
          }}
        />
      )}

      <aside className={`app-sidebar sb-root ${mobileOpen ? 'sidebar-open' : ''} ${isRail ? 'is-rail' : ''}`}>
        {/* Brand + collapse toggle */}
        <div className="sb-brand">
          <div className="sb-logo">
            <FileLock2 size={18} strokeWidth={2} />
          </div>
          {!isRail && (
            <div className="sb-brand-text">
              <div className="sb-brand-name">SecureDocs AI</div>
              <div className="sb-brand-org" title={orgName}>{orgName}</div>
            </div>
          )}
          {!isRail && !mobileOpen && (
            <button
              type="button"
              className="sb-icon-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={17} strokeWidth={1.75} />
            </button>
          )}
          {mobileOpen && (
            <button type="button" className="sb-icon-btn" onClick={onMobileClose} aria-label="Close menu">
              <X size={17} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {isRail && (
          <button
            type="button"
            className="sb-icon-btn sb-expand-btn"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={17} strokeWidth={1.75} />
          </button>
        )}

        {/* Search */}
        <button
          type="button"
          onClick={() => setIsCommandOpen(true)}
          className="sb-search"
          title={isRail ? 'Search (⌘K)' : undefined}
        >
          <Search size={17} strokeWidth={1.75} />
          {!isRail && (
            <>
              <span className="sb-search-text">Search</span>
              <kbd className="mono sb-kbd">⌘K</kbd>
            </>
          )}
        </button>

        {/* Main navigation (only this area scrolls) */}
        <nav className="sidebar-nav-scroll sb-nav">
          {renderTopItem('dashboard', 'Dashboard', '/dashboard', LayoutGrid, isDashboardActive)}
          {groups.map(renderGroup)}
        </nav>

        {/* Bottom section */}
        <div className="sb-bottom">
          <div className="sb-divider" />
          {bottomItems.map((b) =>
            renderTopItem(b.key, b.label, b.to, b.icon, b.isActive, b.badge, 'neutral', b.testId)
          )}
          {isOwnerOrAdmin && !orgChildren.some((c) => c.key === 'settings') &&
            renderTopItem('settings-bottom', 'Settings', '/settings', Settings, path === '/settings')}

          {/* User card */}
          <div ref={userMenuRef} className="sb-user-wrap">
            <button
              type="button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              data-testid="sidebar-user-menu-btn"
              className="sb-user"
              title={isRail ? `${user.full_name} · ${user.email}` : undefined}
            >
              <div className="sb-avatar">{userInitials}</div>
              {!isRail && (
                <>
                  <div className="sb-user-text">
                    <div className="sb-user-name">{user.full_name}</div>
                    <div className="sb-user-email">{user.email}</div>
                  </div>
                  <MoreVertical size={16} strokeWidth={1.75} className="sb-user-more" />
                </>
              )}
            </button>

            {userMenuOpen && (
              <div className={`sb-menu ${isRail ? 'sb-menu-rail' : ''}`}>
                <div className="sb-menu-head">
                  <div className="sb-user-name">{user.full_name}</div>
                  <div className="sb-user-email">
                    {user.role} · {orgName}
                  </div>
                </div>
                <button
                  type="button"
                  className="sb-menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/profile');
                    go();
                  }}
                >
                  <UserIcon size={15} /> <span>Profile</span>
                </button>
                <button
                  type="button"
                  className="sb-menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/security');
                    go();
                  }}
                >
                  <Shield size={15} /> <span>Security</span>
                </button>
                <button type="button" className="sb-menu-item" onClick={() => toggleTheme()}>
                  {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                  <span style={{ flex: 1 }}>Theme</span>
                  <span className="sb-menu-meta">{theme === 'dark' ? 'Dark' : 'Light'}</span>
                </button>
                <div className="sb-menu-sep" />
                <button
                  type="button"
                  className="sb-menu-item sb-menu-danger"
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                    navigate('/');
                  }}
                >
                  <LogOut size={15} /> <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Command Palette Modal (⌘K) */}
      {isCommandOpen && (
        <div className="modal-overlay" onClick={() => setIsCommandOpen(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '560px',
              maxWidth: '92vw',
              padding: 0,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '14px 18px',
                borderBottom: '1px solid var(--line)',
              }}
            >
              <Search size={18} strokeWidth={1.75} color="var(--ink2)" />
              <input
                ref={commandInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search documents by title, people by name or email..."
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '14px',
                  color: 'var(--ink)',
                }}
              />
              <button
                type="button"
                onClick={() => setIsCommandOpen(false)}
                className="btn btn-ghost btn-sm"
                style={{ width: '28px', height: '28px', padding: 0 }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '10px 0' }}>
              {isSearching && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13px' }}>
                  Searching...
                </div>
              )}

              {!isSearching &&
                searchResultsDocs.length === 0 &&
                searchResultsUsers.length === 0 &&
                searchQuery.trim().length < 2 && (
                  <div style={{ padding: '18px 20px', color: 'var(--ink2)', fontSize: '13px' }}>
                    Type at least 2 characters to search documents and organisation members.
                  </div>
                )}

              {!isSearching &&
                searchResultsDocs.length === 0 &&
                searchResultsUsers.length === 0 &&
                searchQuery.trim().length >= 2 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink2)', fontSize: '13px' }}>
                    No matching documents or people found.
                  </div>
                )}

              {searchResultsDocs.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--ink3)',
                      padding: '6px 18px',
                      fontWeight: 700,
                    }}
                  >
                    Documents
                  </div>
                  {searchResultsDocs.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => {
                        setIsCommandOpen(false);
                        navigate(`/documents/${doc.id}`);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 18px',
                        cursor: 'pointer',
                        fontSize: '13.5px',
                      }}
                    >
                      <FileText size={16} color="var(--accent)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{doc.title}</div>
                        <div className="mono" style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                          {doc.original_filename}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchResultsUsers.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--ink3)',
                      padding: '6px 18px',
                      fontWeight: 700,
                    }}
                  >
                    People
                  </div>
                  {searchResultsUsers.map((person) => (
                    <div
                      key={person.id}
                      onClick={() => {
                        setIsCommandOpen(false);
                        navigate(`/members?search=${encodeURIComponent(person.full_name)}`);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 18px',
                        cursor: 'pointer',
                        fontSize: '13.5px',
                      }}
                    >
                      <div
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          backgroundColor: '#2457D6',
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10.5px',
                          fontWeight: 700,
                        }}
                      >
                        {person.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{person.full_name}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--ink2)' }}>
                          {person.role} · <span className="mono">{person.email}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '10px 18px',
                backgroundColor: 'var(--panel)',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11.5px',
                color: 'var(--ink2)',
              }}
            >
              <span>Quick workspace search</span>
              <span className="mono">ESC to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
