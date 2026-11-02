import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, RefreshCw, Trash2, Key, Copy, Check, Clock, AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export const DemoInbox: React.FC = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['demo-inbox-messages'],
    queryFn: async () => {
      return api.getDemoInboxMessages();
    },
    refetchInterval: 2500,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      return api.clearDemoInbox();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demo-inbox-messages'] });
      setSelectedMessage(null);
    },
  });

  const messages = data?.messages || [];

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Demo Inbox</h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
                backgroundColor: 'rgba(30, 107, 82, 0.1)',
                color: 'var(--accent)',
              }}
            >
              DEV MODE
            </span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
            In-app email simulator for verification codes and notifications sent to external recipients.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" onClick={() => refetch()} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Refresh
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)' }}
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedMessage ? '1fr 1fr' : '1fr', gap: '16px' }}>
        <div className="craft-card" style={{ padding: '0', overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading messages...
            </div>
          ) : isError ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
              <AlertCircle size={36} style={{ margin: '0 auto 12px', color: 'var(--danger)' }} />
              <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text)' }}>Unable to load Demo Inbox</div>
              <div style={{ fontSize: '13px', marginTop: '4px', maxWidth: '380px', margin: '4px auto 0' }}>
                {(error as any)?.message || 'Make sure you are signed in with an authorized account (Owner, Admin, Department Head, or Manager).'}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}>
              <Mail size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div style={{ fontWeight: 600, fontSize: '15px' }}>No messages in demo inbox</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                When external shares request verification codes, they will appear here in real-time.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {messages.map((m: any) => (
                <div
                  key={m.id}
                  onClick={() => setSelectedMessage(m)}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    backgroundColor: selectedMessage?.id === m.id ? 'var(--surface-hover)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text)' }}>
                        To: {m.to}
                      </span>
                    </div>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {m.time ? new Date(m.time).toLocaleTimeString() : ''}
                    </span>
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>
                    {m.subject}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                      {m.snippet}
                    </span>

                    {m.code && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#FEF3F2',
                          border: '1px solid #FECDCA',
                          color: '#B42318',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: '13px',
                        }}
                      >
                        <Key size={12} />
                        <span>{m.code}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyCode(m.code);
                          }}
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px', height: 'auto', color: '#B42318' }}
                          title="Copy Code"
                        >
                          {copiedCode === m.code ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedMessage && (
          <div className="craft-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{selectedMessage.subject}</h3>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                  To: <strong>{selectedMessage.to}</strong> · {new Date(selectedMessage.time).toLocaleString()}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedMessage(null)}>
                Close
              </button>
            </div>

            {selectedMessage.code && (
              <div
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  backgroundColor: '#FEF3F2',
                  border: '1px solid #FECDCA',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: '#B42318', fontWeight: 600 }}>Verification Code</div>
                  <div className="mono" style={{ fontSize: '24px', fontWeight: 700, color: '#B42318', letterSpacing: '4px' }}>
                    {selectedMessage.code}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleCopyCode(selectedMessage.code)}
                >
                  {copiedCode === selectedMessage.code ? <Check size={13} /> : <Copy size={13} />}
                  {copiedCode === selectedMessage.code ? 'Copied' : 'Copy code'}
                </button>
              </div>
            )}

            <div
              style={{
                flex: 1,
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
                backgroundColor: '#FFFFFF',
                color: '#0B1220',
                maxHeight: '400px',
                overflowY: 'auto',
                fontSize: '13px',
              }}
              dangerouslySetInnerHTML={{ __html: selectedMessage.html || selectedMessage.text }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

