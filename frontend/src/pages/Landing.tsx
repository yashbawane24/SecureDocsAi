import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FileLock2,
  Link2,
  ArrowRight,
  Lock,
  ShieldCheck,
  FileCheck2,
  Eye,
  Crown,
  Building2,
  Briefcase,
  User as UserIcon,
  Check,
  ScanSearch,
} from 'lucide-react';

export const Landing: React.FC = () => {
  const location = useLocation();
  // Ticking countdown timer starting at 09:41 (581 seconds)
  const [timerSec, setTimerSec] = useState(9 * 60 + 41);

  useEffect(() => {
    const id = setInterval(() => {
      setTimerSec((prev) => (prev > 60 ? prev - 1 : 9 * 60 + 41));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 80);
      }
    }
  }, [location.hash]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')} : ${String(s).padStart(2, '0')}`;
  };

  const scrollToSection = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        backgroundColor: 'var(--landing-bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* 1. NAVBAR */}
      <header
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            textDecoration: 'none',
            color: 'var(--ink)',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              backgroundColor: 'var(--navy)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--cyan)',
            }}
          >
            <FileLock2 size={18} strokeWidth={2} />
          </div>
          <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            SecureDocs AI
          </span>
        </Link>

        <nav
          className="landing-nav-links"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
            fontSize: '13.5px',
            fontWeight: 500,
            color: 'var(--ink2)',
          }}
        >
          <a href="#features" onClick={scrollToSection('features')} style={{ color: 'inherit', textDecoration: 'none' }}>
            Features
          </a>
          <a href="#how-it-works" onClick={scrollToSection('features')} style={{ color: 'inherit', textDecoration: 'none' }}>
            How it works
          </a>
          <a href="#roles" onClick={scrollToSection('roles')} style={{ color: 'inherit', textDecoration: 'none' }}>
            Roles
          </a>
          <a href="#security" onClick={scrollToSection('security')} style={{ color: 'inherit', textDecoration: 'none' }}>
            Security
          </a>
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link
            to="/open"
            className="btn btn-secondary btn-pill"
            style={{ height: '38px', padding: '0 16px', fontSize: '13px' }}
          >
            <Link2 size={15} strokeWidth={1.75} />
            <span>Open a shared link</span>
          </Link>
          <a
            href="#roles"
            onClick={scrollToSection('roles')}
            className="btn btn-primary btn-pill"
            style={{ height: '38px', padding: '0 18px', fontSize: '13px' }}
          >
            <span>Sign in</span>
            <ArrowRight size={14} strokeWidth={2} />
          </a>
        </div>
      </header>

      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 28px' }}>
        {/* 2. HERO */}
        <section
          style={{
            backgroundColor: 'var(--graphite)',
            borderRadius: '32px',
            padding: '56px 52px',
            position: 'relative',
            overflow: 'hidden',
            backgroundImage:
              'radial-gradient(circle at 75% 35%, rgba(47, 91, 234, 0.16), transparent 55%), linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px)',
            backgroundSize: '100% 100%, 44px 44px, 44px 44px',
          }}
        >
          <div className="landing-hero-grid">
            {/* Hero Left */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', zIndex: 2 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(47, 91, 234, 0.14)',
                  border: '1px solid rgba(47, 91, 234, 0.32)',
                  color: 'var(--accent)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  marginBottom: '22px',
                }}
              >
                <ScanSearch size={14} strokeWidth={2} />
                <span>Encrypted sharing with AI risk scoring</span>
              </div>

              <h1
                style={{
                  fontSize: 'clamp(36px, 4.2vw, 54px)',
                  fontWeight: 700,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.06,
                  color: '#FFFFFF',
                  marginBottom: '20px',
                }}
              >
                Share sensitive files.
                <br />
                <span style={{ color: 'var(--accent)' }}>Keep control</span> after
                <br />
                you hit send.
              </h1>

              <p
                style={{
                  fontSize: '15.5px',
                  lineHeight: 1.6,
                  color: 'var(--dark-text)',
                  maxWidth: '470px',
                  marginBottom: '28px',
                }}
              >
                Every upload is encrypted and scanned for Aadhaar, PAN, bank details, health data and secrets. The risk score decides how it can be shared, for how long, and by whom.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '34px' }}>
                <a
                  href="#roles"
                  onClick={scrollToSection('roles')}
                  className="btn btn-pill"
                  style={{
                    height: '44px',
                    padding: '0 22px',
                    fontSize: '14px',
                    backgroundColor: '#FFFFFF',
                    color: 'var(--graphite)',
                    border: '1px solid #FFFFFF',
                    fontWeight: 700,
                  }}
                >
                  <span>Choose your sign-in</span>
                  <ArrowRight size={15} strokeWidth={2.2} />
                </a>
                <a
                  href="#features"
                  onClick={scrollToSection('features')}
                  className="btn btn-pill"
                  style={{
                    height: '44px',
                    padding: '0 22px',
                    fontSize: '14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: '#FFFFFF',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                  }}
                >
                  <span>See how it works</span>
                </a>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '22px',
                  flexWrap: 'wrap',
                  fontSize: '12.5px',
                  color: 'var(--dark-muted)',
                  fontWeight: 500,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Lock size={14} color="var(--accent)" /> AES-256 at rest
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={14} color="var(--accent)" /> Separate role sign-in
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <FileCheck2 size={14} color="var(--accent)" /> Every open logged
                </span>
              </div>
            </div>

            {/* Hero Right: Composed HTML/CSS Visual */}
            <div
              style={{
                position: 'relative',
                minHeight: '390px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
              }}
            >
              {/* Main Tilted White Document Card */}
              <div
                style={{
                  width: '320px',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '22px',
                  padding: '22px',
                  transform: 'rotate(-2.2deg) translateX(-34px)',
                  boxShadow: '0 28px 60px rgba(0, 0, 0, 0.45)',
                  position: 'relative',
                  overflow: 'hidden',
                  color: 'var(--ink)',
                }}
              >
                {/* Faint diagonal watermark inside composed doc */}
                <div
                  className="mono"
                  style={{
                    position: 'absolute',
                    top: '46%',
                    left: '-18%',
                    width: '140%',
                    transform: 'rotate(-24deg)',
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'rgba(36, 87, 214, 0.13)',
                    letterSpacing: '0.06em',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                  }}
                >
                  MEERA@NORTHWIND.TEST · 18 OCT · 14:22 UTC
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
                    HR_Employee_Master.pdf
                  </span>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      color: '#B42318',
                      border: '1.5px solid rgba(180, 35, 24, 0.55)',
                      borderRadius: '5px',
                      padding: '2px 6px',
                      letterSpacing: '0.04em',
                    }}
                  >
                    CONFIDENTIAL
                  </span>
                </div>

                {/* Skeleton Lines */}
                <div style={{ height: '7px', width: '78%', backgroundColor: '#E5EAF2', borderRadius: '4px', marginBottom: '9px' }} />
                <div style={{ height: '7px', width: '92%', backgroundColor: '#E5EAF2', borderRadius: '4px', marginBottom: '9px' }} />
                <div style={{ height: '7px', width: '60%', backgroundColor: '#E5EAF2', borderRadius: '4px', marginBottom: '18px' }} />

                {/* Redaction Label Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[
                    { w: '68px', tags: ['[AADHAAR]', '[PAN]'] },
                    { w: '56px', tags: ['[AADHAAR]', '[BANK A/C]'] },
                    { w: '64px', tags: ['[AADHAAR]', '[PAN]'] },
                    { w: '52px', tags: ['[BANK A/C]', '[IFSC]'] },
                  ].map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ height: '8px', width: row.w, backgroundColor: '#DCE3EE', borderRadius: '4px' }} />
                      {row.tags.map((t, tidx) => (
                        <span
                          key={tidx}
                          className="mono"
                          style={{
                            backgroundColor: 'var(--navy)',
                            color: '#FFFFFF',
                            fontSize: '9.5px',
                            fontWeight: 600,
                            padding: '3px 7px',
                            borderRadius: '5px',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>

                <div style={{ height: '7px', width: '84%', backgroundColor: '#E5EAF2', borderRadius: '4px', marginTop: '18px' }} />
              </div>

              {/* Floating Risk Score Card (Top Right) */}
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '4px',
                  width: '215px',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '20px',
                  padding: '16px 18px',
                  boxShadow: '0 22px 48px rgba(0, 0, 0, 0.38)',
                  color: 'var(--ink)',
                }}
              >
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--ink2)', marginBottom: '6px' }}>
                  Risk score
                </div>

                {/* Semicircle Gauge SVG */}
                <div style={{ position: 'relative', width: '150px', height: '84px', margin: '0 auto 8px' }}>
                  <svg viewBox="0 0 160 90" width="150" height="84">
                    <path
                      d="M 16 80 A 64 64 0 0 1 144 80"
                      fill="none"
                      stroke="#E6EBF2"
                      strokeWidth="12"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 16 80 A 64 64 0 0 1 144 80"
                      fill="none"
                      stroke="#B42318"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray="201"
                      strokeDashoffset={201 * (1 - 0.82)}
                    />
                  </svg>
                  <div
                    style={{
                      position: 'absolute',
                      inset: '22px 0 0 0',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
                      82
                    </span>
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: '#B42318',
                        letterSpacing: '0.06em',
                        marginTop: '3px',
                      }}
                    >
                      CRITICAL
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', justifyContent: 'center' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: 'var(--risk-critical-bg)',
                      color: 'var(--risk-critical-fg)',
                    }}
                  >
                    15 Aadhaar
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: 'var(--risk-critical-bg)',
                      color: 'var(--risk-critical-fg)',
                    }}
                  >
                    15 PAN
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: '#EEF2F8',
                      color: 'var(--ink2)',
                    }}
                  >
                    12 Bank a/c
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '999px',
                      backgroundColor: '#EEF2F8',
                      color: 'var(--ink2)',
                    }}
                  >
                    Salaries
                  </span>
                </div>
              </div>

              {/* Floating Timer Card (Bottom Left) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '22px',
                  left: '16px',
                  backgroundColor: '#FFFFFF',
                  borderRadius: '16px',
                  padding: '11px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '11px',
                  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
                  color: 'var(--ink)',
                }}
              >
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--ice)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Eye size={17} strokeWidth={2} />
                </div>
                <div>
                  <div className="mono" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.15 }}>
                    {formatTimer(timerSec)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ink2)', fontWeight: 500 }}>
                    View once · in-app only
                  </div>
                </div>
              </div>

              {/* Floating Safe Copy Card (Bottom Right, White with blue icon) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  right: '0px',
                  backgroundColor: '#FFFFFF',
                  color: 'var(--ink)',
                  borderRadius: '16px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
                  border: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '9px',
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={18} strokeWidth={2} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.2 }}>
                    Safe copy created
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>
                    Risk 82 → 18 · password protected
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. FACTS ROW */}
        <section
          id="security"
          className="landing-facts-grid"
          style={{
            marginTop: '36px',
            borderTop: '1px solid var(--line)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          {[
            {
              stat: 'AES-256-GCM',
              desc: 'Files encrypted at rest, decrypted only in memory',
            },
            {
              stat: '14 detectors',
              desc: 'Indian IDs, cards, bank details, health terms, API keys',
            },
            {
              stat: '0–100',
              desc: 'Explainable risk score with the reason behind every point',
            },
            {
              stat: '1 click',
              desc: 'Revoke any share, internal or external, instantly',
            },
          ].map((item, idx) => (
            <div
              key={item.stat}
              style={{
                padding: '26px 24px',
                borderLeft: idx > 0 ? '1px solid var(--line)' : 'none',
              }}
            >
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  color: 'var(--ink)',
                  marginBottom: '6px',
                }}
              >
                {item.stat}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.45 }}>
                {item.desc}
              </div>
            </div>
          ))}
        </section>

        {/* 4. WHAT IT DOES */}
        <section id="features" style={{ paddingTop: '72px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--accent)', marginBottom: '10px' }}>
            What it does
          </div>
          <div
            className="landing-section-header"
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr',
              gap: '32px',
              alignItems: 'end',
              marginBottom: '32px',
            }}
          >
            <h2
              style={{
                fontSize: 'clamp(32px, 3.5vw, 44px)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.1,
              }}
            >
              Know what's inside a file
              <br />
              before it leaves.
            </h2>
            <p style={{ fontSize: '15px', color: 'var(--ink2)', lineHeight: 1.6 }}>
              SecureDocs AI checks each document, scores the risk, and applies your organisation's rules to every share automatically.
            </p>
          </div>

          <div className="landing-feature-cards-grid">
            {/* Card 1: White card with findings table */}
            <div
              className="sd-card"
              style={{
                padding: '28px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '24px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '18px' }}>
                  A risk score on every upload
                </h3>
                <div
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '14px',
                    overflow: 'hidden',
                  }}
                >
                  {[
                    { label: 'Aadhaar', val: 'XXXX XXXX 4821 · p.2', pct: '98%', fg: 'var(--risk-critical-fg)', bg: 'var(--risk-critical-bg)' },
                    { label: 'PAN', val: 'ABCDE****F · p.2', pct: '96%', fg: 'var(--risk-critical-fg)', bg: 'var(--risk-critical-bg)' },
                    { label: 'Bank account', val: 'XXXXXXXX3387 · p.4', pct: '91%', fg: 'var(--risk-high-fg)', bg: 'var(--risk-high-bg)' },
                    { label: 'Salary', val: '₹ *,**,*** · p.4', pct: '84%', fg: 'var(--risk-medium-fg)', bg: 'var(--risk-medium-bg)' },
                  ].map((r, i) => (
                    <div
                      key={r.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '11px 14px',
                        borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                        fontSize: '13px',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--ink)', minWidth: '96px' }}>{r.label}</span>
                      <span className="mono" style={{ fontSize: '12px', color: 'var(--ink2)', flex: 1 }}>
                        {r.val}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: '6px',
                          color: r.fg,
                          backgroundColor: r.bg,
                        }}
                      >
                        {r.pct}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--ink2)', lineHeight: 1.55 }}>
                NLP and pattern checks find sensitive values, mask them, and explain exactly why the file scored what it did.
              </p>
            </div>

            {/* Card 2: Graphite card — Shares that expire on their own */}
            <div
              style={{
                backgroundColor: 'var(--graphite)',
                border: '1px solid var(--graphite-border)',
                borderRadius: '20px',
                padding: '28px',
                color: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '24px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#FFFFFF', marginBottom: '18px', lineHeight: 1.25 }}>
                  Shares that expire on their own
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      backgroundColor: 'var(--graphite-2)',
                      border: '1px solid var(--graphite-border)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      color: 'var(--dark-text)',
                    }}
                  >
                    <span>View once</span>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '999px',
                        backgroundColor: 'var(--accent)',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: '#FFFFFF',
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                        }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--graphite-2)',
                      border: '1px solid var(--graphite-border)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      color: 'var(--dark-text)',
                    }}
                  >
                    <span>Time limit</span>
                    <span className="mono" style={{ color: 'var(--accent)', fontSize: '12.5px', fontWeight: 600 }}>
                      10 min
                    </span>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--graphite-2)',
                      border: '1px solid var(--graphite-border)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      color: 'var(--dark-text)',
                    }}
                  >
                    <span>View cap</span>
                    <span className="mono" style={{ color: 'var(--accent)', fontSize: '12.5px', fontWeight: 600 }}>
                      1 / 3
                    </span>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'rgba(31, 32, 35, 0.55)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      color: 'var(--dark-muted)',
                    }}
                  >
                    <span>Download original</span>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--dark-muted)', lineHeight: 1.55 }}>
                Time limits, view caps and expiry dates are enforced by the server, not the browser.
              </p>
            </div>

            {/* Card 3: Graphite card — Safe copies for risky files */}
            <div
              style={{
                backgroundColor: 'var(--graphite)',
                border: '1px solid var(--graphite-border)',
                borderRadius: '20px',
                padding: '28px',
                color: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '24px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#FFFFFF', marginBottom: '18px', lineHeight: 1.25 }}>
                  Safe copies for risky files
                </h3>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    gap: '10px',
                    alignItems: 'center',
                    marginBottom: '14px',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--graphite-2)',
                      border: '1px solid var(--graphite-border)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.1 }}>82</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#F87171', marginTop: '2px' }}>Original</div>
                  </div>
                  <span style={{ color: 'var(--dark-muted)', fontWeight: 700 }}>→</span>
                  <div
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      border: '1px solid rgba(47, 91, 234, 0.3)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--accent)', lineHeight: 1.1 }}>18</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', marginTop: '2px' }}>Safe copy</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { k: 'Aadhaar numbers', v: '15 removed' },
                    { k: 'PAN numbers', v: '15 removed' },
                    { k: 'File metadata', v: 'stripped' },
                  ].map((item) => (
                    <div
                      key={item.k}
                      style={{
                        backgroundColor: 'var(--graphite-2)',
                        border: '1px solid var(--graphite-border)',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '12.5px',
                        color: 'var(--dark-text)',
                      }}
                    >
                      <span>{item.k}</span>
                      <span className="mono" style={{ color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600 }}>
                        {item.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--dark-muted)', lineHeight: 1.55 }}>
                Sensitive values are truly removed from the PDF, and the copy can be password-encrypted before it goes out.
              </p>
            </div>
          </div>
        </section>

        {/* 5. PICK YOUR ROLE TO SIGN IN */}
        <section id="roles" style={{ paddingTop: '76px', paddingBottom: '56px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--accent)', marginBottom: '10px' }}>
            Sign in
          </div>
          <div
            className="landing-section-header"
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr',
              gap: '32px',
              alignItems: 'end',
              marginBottom: '32px',
            }}
          >
            <h2
              style={{
                fontSize: 'clamp(32px, 3.5vw, 44px)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.1,
              }}
            >
              Pick your role to sign in.
            </h2>
            <p style={{ fontSize: '15px', color: 'var(--ink2)', lineHeight: 1.6 }}>
              Each portal opens a workspace built for that role, showing only what you're allowed to do.
            </p>
          </div>

          <div className="landing-roles-grid">
            {[
              {
                roleKey: 'admin',
                title: 'Owner & Admin',
                subtitle: 'Runs the organisation',
                Icon: Crown,
                bullets: [
                  'Manage members, roles and departments',
                  'Approve critical-risk shares',
                  'Set risk policy and export audit logs',
                ],
                btnLabel: 'Admin sign-in',
                to: '/login/admin',
              },
              {
                roleKey: 'head',
                title: 'Department Head',
                subtitle: 'Leads one department',
                Icon: Building2,
                bullets: [
                  'See every document in the department',
                  'Share internally and externally',
                  'Approve joiners and review activity',
                ],
                btnLabel: 'Head sign-in',
                to: '/login/head',
              },
              {
                roleKey: 'manager',
                title: 'Manager',
                subtitle: 'Leads a team',
                Icon: Briefcase,
                bullets: [
                  'Upload and scan documents',
                  'Share with direct reports and head',
                  'Track and revoke own shares',
                ],
                btnLabel: 'Manager sign-in',
                to: '/login/manager',
              },
              {
                roleKey: 'employee',
                title: 'Employee',
                subtitle: 'Works with shared files',
                Icon: UserIcon,
                bullets: [
                  'Open documents shared with you',
                  'Upload your own files',
                  'Request a share from your manager',
                ],
                btnLabel: 'Employee sign-in',
                to: '/login/employee',
              },
            ].map((card) => {
              const IconComp = card.Icon;
              return (
                <Link
                  key={card.roleKey}
                  to={card.to}
                  tabIndex={0}
                  className="landing-role-card"
                  data-testid={`role-card-${card.roleKey}`}
                >
                  <div>
                    <div className="role-card-icon">
                      <IconComp size={19} strokeWidth={1.85} />
                    </div>

                    <h3 className="role-card-title">{card.title}</h3>
                    <div className="role-card-subtitle">{card.subtitle}</div>

                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {card.bullets.map((b) => (
                        <li
                          key={b}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '9px',
                            lineHeight: 1.4,
                          }}
                        >
                          <Check
                            size={15}
                            strokeWidth={2.4}
                            className="role-card-check"
                            style={{
                              marginTop: '2px',
                            }}
                          />
                          <span className="role-card-bullet">{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div
                    data-testid={`portal-link-${card.roleKey}`}
                    className="role-card-btn"
                  >
                    <span>{card.btnLabel}</span>
                    <ArrowRight size={14} strokeWidth={2} />
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Bottom Strip: Received a link from another organisation? */}
          <div
            style={{
              marginTop: '20px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '20px',
              padding: '18px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '11px',
                  backgroundColor: '#FFFFFF',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--line)',
                  flexShrink: 0,
                }}
              >
                <Link2 size={18} strokeWidth={1.85} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>
                  Received a link from another organisation?
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--ink2)' }}>
                  Open it with the email it was sent to. We'll send you a one-time code.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Link to="/join" className="btn btn-secondary btn-pill" style={{ height: '38px', fontSize: '13px' }}>
                Join with invite code
              </Link>
              <Link to="/signup" className="btn btn-secondary btn-pill" style={{ height: '38px', fontSize: '13px' }}>
                Create organisation
              </Link>
              <Link to="/open" className="btn btn-primary btn-pill" style={{ height: '38px', fontSize: '13px' }}>
                <span>Open shared link</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* 6. SLIM FOOTER */}
      <footer
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '24px 28px 36px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          fontSize: '12.5px',
          color: 'var(--ink2)',
        }}
      >
        <div>
          <strong style={{ color: 'var(--ink)' }}>SecureDocs AI</strong> · Information Security course project, VIT · Team 16
        </div>
        <div style={{ display: 'flex', gap: '14px' }}>
          <a href="#security" onClick={scrollToSection('security')} style={{ color: 'inherit', textDecoration: 'none' }}>
            Privacy
          </a>
          <span>·</span>
          <a href="#security" onClick={scrollToSection('security')} style={{ color: 'inherit', textDecoration: 'none' }}>
            Security model
          </a>
          <span>·</span>
          <a href="#roles" onClick={scrollToSection('roles')} style={{ color: 'inherit', textDecoration: 'none' }}>
            GitHub
          </a>
        </div>
      </footer>

      <style>{`
        .landing-hero-grid {
          display: grid;
          grid-template-columns: 1.05fr 1fr;
          gap: 36px;
          align-items: center;
        }
        .landing-facts-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
        }
        .landing-feature-cards-grid {
          display: grid;
          grid-template-columns: 1.12fr 1fr 1fr;
          gap: 18px;
        }
        .landing-roles-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
        @media (max-width: 1024px) {
          .landing-hero-grid {
            grid-template-columns: 1fr;
          }
          .landing-facts-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .landing-feature-cards-grid {
            grid-template-columns: 1fr;
          }
          .landing-roles-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .landing-section-header {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
        }
        @media (max-width: 640px) {
          .landing-facts-grid,
          .landing-roles-grid {
            grid-template-columns: 1fr;
          }
          .landing-nav-links {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
