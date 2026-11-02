import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Bell,
  Sun,
  Moon,
  Check,
  CheckCheck,
  Menu,
  ChevronRight,
  FileText,
  User as UserIcon,
  X,
  LogOut,
  Shield,
} from 'lucide-react';
import { api, NotificationItem, DocumentItem, User } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from '../context/AuthContext';

interface TopbarProps {
  onMobileToggle?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onMobileToggle }) => {
  const { user, logout, theme, toggleTheme } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Command palette state
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultsDocs, setSearchResultsDocs] = useState<DocumentItem[]>([]);
  const [searchResultsUsers, setSearchResultsUsers] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const { data: notifData } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.getNotifications(),
    enabled: Boolean(user),
  });

  const notifications = notifData?.notifications || [];
  const unreadCount = notifData?.unread_count || 0;

  // Optimistic Mark Read Mutation (PART A5)
  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.markNotificationRead(id),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications });
      const prev = queryClient.getQueryData<{ notifications: NotificationItem[]; unread_count: number }>(queryKeys.notifications);
      if (prev) {
        const updated = prev.notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n));
        queryClient.setQueryData(queryKeys.notifications, {
          notifications: updated,
          unread_count: updated.filter((n) => !n.is_read).length,
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.notifications, ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    },
  });

  // Optimistic Mark All Read Mutation (PART A5)
  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications });
      const prev = queryClient.getQueryData<{ notifications: NotificationItem[]; unread_count: number }>(queryKeys.notifications);
      if (prev) {
        queryClient.setQueryData(queryKeys.notifications, {
          notifications: prev.notifications.map((n) => ({ ...n, is_read: true })),
          unread_count: 0,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.notifications, ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
    },
  });

  // Handle Ctrl/Cmd+K
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
      setTimeout(() => commandInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
      setSearchResultsDocs([]);
      setSearchResultsUsers([]);
    }
  }, [isCommandOpen]);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifDropdown(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            docs.value.filter(
              (d) =>
                d.title.toLowerCase().includes(q) ||
                d.original_filename.toLowerCase().includes(q)
            ).slice(0, 5)
          );
        }
        if (members.status === 'fulfilled') {
          setSearchResultsUsers(members.value.slice(0, 5));
        }
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Breadcrumb mapping
  const path = location.pathname;
  let pageTitle = 'Dashboard';
  let parentLabel = 'Overview';

  if (path.startsWith('/documents/')) {
    pageTitle = 'Document Overview';
    parentLabel = 'Documents';
  } else if (path === '/documents') {
    pageTitle = 'My documents';
    parentLabel = 'Documents';
  } else if (path === '/shared-with-me') {
    pageTitle = 'Shared with me';
    parentLabel = 'Documents';
  } else if (path === '/shared-by-me' || path === '/shared-links') {
    pageTitle = 'Shared links';
    parentLabel = 'Documents';
  } else if (path === '/approvals') {
    pageTitle = 'Approvals';
    parentLabel = 'Documents';
  } else if (path === '/notifications') {
    pageTitle = 'Notifications';
    parentLabel = 'Activity';
  } else if (path === '/audit-log') {
    pageTitle = 'Audit log';
    parentLabel = 'Activity';
  } else if (path === '/members') {
    pageTitle = 'Members';
    parentLabel = 'Organization';
  } else if (path === '/invitations') {
    pageTitle = 'Invitations & requests';
    parentLabel = 'Organization';
  } else if (path === '/departments') {
    pageTitle = 'Departments';
    parentLabel = 'Organization';
  } else if (path === '/roles') {
    pageTitle = 'Roles & permissions';
    parentLabel = 'Organization';
  } else if (path === '/settings') {
    pageTitle = 'Organization Settings';
    parentLabel = 'Organization';
  } else if (path === '/profile') {
    pageTitle = 'Profile';
    parentLabel = 'Account';
  } else if (path === '/security') {
    pageTitle = 'Security';
    parentLabel = 'Account';
  }

  return (
    <>
      <header
        style={{
          height: '56px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        {/* Left: Mobile hamburger & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onMobileToggle && (
            <button
              onClick={onMobileToggle}
              className="btn btn-ghost"
              style={{ padding: '6px', display: 'flex', alignItems: 'center' }}
              title="Toggle navigation"
            >
              <Menu size={18} strokeWidth={1.75} />
            </button>
          )}

          {path === '/dashboard' ? (
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.01em' }}>
              Dashboard
            </h1>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
              <span style={{ color: 'var(--muted)' }}>{parentLabel}</span>
              <ChevronRight size={13} style={{ color: 'var(--muted)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{pageTitle}</span>
            </div>
          )}
        </div>

        {/* Center/Right: Global Search, Theme, Notifications, Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => setIsCommandOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-btn)',
              padding: '5px 12px',
              fontSize: '12px',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              minWidth: '220px',
              height: '32px',
              transition: 'border-color 150ms ease-out',
            }}
          >
            <Search size={14} strokeWidth={1.75} />
            <span style={{ flex: 1, textAlign: 'left' }}>Search documents & people...</span>
            <kbd
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                padding: '2px 5px',
                borderRadius: '3px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--rule)',
                color: 'var(--ink-2)',
              }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            className="btn btn-ghost"
            style={{ width: '32px', height: '32px', padding: 0, color: 'var(--ink-2)' }}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
          </button>

          {/* Notifications Bell */}
          <div ref={notifRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              className="btn btn-ghost"
              data-testid="topbar-notifications-bell"
              style={{
                width: '32px',
                height: '32px',
                padding: 0,
                position: 'relative',
                color: 'var(--ink-2)',
              }}
              aria-label="View notifications"
            >
              <Bell size={16} strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span
                  data-testid="topbar-bell-badge"
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    backgroundColor: 'var(--status-danger)',
                    color: '#FFFFFF',
                    fontSize: '10px',
                    fontWeight: 700,
                    borderRadius: '999px',
                    padding: '0 4px',
                    lineHeight: '14px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifDropdown && (
              <div
                className="craft-card"
                style={{
                  position: 'absolute',
                  top: '40px',
                  right: 0,
                  width: '360px',
                  zIndex: 100,
                  boxShadow: 'var(--shadow-flyout)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--rule)',
                    backgroundColor: 'var(--paper)',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink)' }}>
                    Notifications ({unreadCount} unread)
                  </span>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllReadMutation.mutate()}
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--accent)', fontSize: '11px', height: '24px' }}
                    >
                      <CheckCheck size={13} /> Mark all read
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ink-2)', fontSize: '13px' }}>
                      No notifications recorded.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid var(--rule-subtle)',
                          backgroundColor: n.is_read ? 'transparent' : 'var(--accent-soft)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                            {n.title}
                          </span>
                          {!n.is_read && (
                            <button
                              onClick={() => markReadMutation.mutate(n.id)}
                              title="Mark as read"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ink-2)',
                                cursor: 'pointer',
                                padding: '2px',
                              }}
                            >
                              <Check size={14} />
                            </button>
                          )}
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--ink-2)', lineHeight: 1.4 }}>
                          {n.message}
                        </p>
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--ink-2)' }}>
                          {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Menu Avatar */}
          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: '#2457D6',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                border: '1px solid rgba(0,0,0,0.1)',
              }}
              title={user?.full_name}
            >
              {user ? user.full_name.slice(0, 2).toUpperCase() : 'U'}
            </button>

            {showUserDropdown && (
              <div
                className="craft-card"
                style={{
                  position: 'absolute',
                  top: '40px',
                  right: 0,
                  width: '220px',
                  zIndex: 100,
                  boxShadow: 'var(--shadow-flyout)',
                  overflow: 'hidden',
                  padding: '6px 0',
                }}
              >
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--rule)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                    {user?.full_name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ink-2)' }}>
                    {user?.email}
                  </div>
                </div>

                <Link
                  to="/profile"
                  onClick={() => setShowUserDropdown(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    color: 'var(--ink)',
                    textDecoration: 'none',
                  }}
                  className="btn-ghost"
                >
                  <UserIcon size={14} /> Profile
                </Link>

                <Link
                  to="/security"
                  onClick={() => setShowUserDropdown(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    color: 'var(--ink)',
                    textDecoration: 'none',
                  }}
                  className="btn-ghost"
                >
                  <Shield size={14} /> Security
                </Link>

                <div style={{ height: '1px', backgroundColor: 'var(--rule)', margin: '4px 0' }} />

                <button
                  onClick={logout}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    color: 'var(--status-danger)',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  className="btn-ghost"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isCommandOpen && (
        <div className="modal-overlay" onClick={() => setIsCommandOpen(false)}>
          <div
            className="craft-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '560px',
              maxWidth: '92vw',
              boxShadow: 'var(--shadow-flyout)',
              overflow: 'hidden',
              animation: 'fadeIn 150ms ease-out',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <Search size={16} strokeWidth={1.75} style={{ color: 'var(--ink-2)' }} />
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
                onClick={() => setIsCommandOpen(false)}
                className="btn btn-ghost"
                style={{ width: '24px', height: '24px', padding: 0 }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '8px 0' }}>
              {isSearching && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-2)', fontSize: '13px' }}>
                  Searching...
                </div>
              )}

              {!isSearching && searchResultsDocs.length === 0 && searchResultsUsers.length === 0 && searchQuery.trim().length >= 2 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-2)', fontSize: '13px' }}>
                  No matching documents or people found.
                </div>
              )}

              {searchResultsDocs.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', padding: '6px 16px', fontWeight: 600 }}>
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
                        padding: '8px 16px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                      className="craft-table tr:hover"
                    >
                      <FileText size={16} style={{ color: 'var(--accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{doc.title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--ink-2)' }}>{doc.original_filename}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchResultsUsers.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-2)', padding: '6px 16px', fontWeight: 600 }}>
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
                        padding: '8px 16px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: (person.avatar_color && person.avatar_color.toUpperCase() !== '#1E6B52') ? person.avatar_color : '#2457D6',
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 600,
                        }}
                      >
                        {person.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{person.full_name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--ink-2)' }}>
                          {person.role} • {person.department || 'No dept'} • {person.email}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--paper)',
                borderTop: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: 'var(--ink-2)',
              }}
            >
              <span>Navigation commands</span>
              <span>ESC to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
