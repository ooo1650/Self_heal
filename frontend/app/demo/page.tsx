'use client';
/**
 * /demo — Self-Healing Infrastructure Demo Screen
 *
 * Standalone kiosk page. No login required.
 * Designed for both wide demo screens and narrow phone viewports.
 *
 * Features:
 *  - Health-check polling every 1.5s → detects crash/recovery automatically
 *  - Per-attack cooldown timers driven by server 429 seconds_remaining
 *  - "Recovery in progress" global lock while backend is down
 *  - Activity log (last 20 entries, newest on top)
 *  - Build timestamp in footer (injected by next.config.ts at build time)
 *  - All API calls use NEXT_PUBLIC_API_URL — no hardcoded localhost
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Cpu, MemoryStick, SquareTerminal, CheckCircle2, WifiOff, RefreshCw, Clock } from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────
const API    = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TOKEN  = process.env.NEXT_PUBLIC_ATTACK_TOKEN ?? '';
const BUILD  = process.env.NEXT_PUBLIC_BUILD_TIME ?? 'dev';
const POLL_MS = 1500;   // health poll interval
const HEALTH_TIMEOUT_MS = 2000;  // consider backend down if no response in this time

// ── Types ──────────────────────────────────────────────────────────────────────
type BackendStatus = 'up' | 'down' | 'recovering';
type AttackKey     = 'crash' | 'oom' | 'cpu';

interface LogEntry {
  id:   number;
  time: string;     // HH:MM:SS
  msg:  string;
}

interface AttackDef {
  key:         AttackKey;
  label:       string;
  endpoint:    string;
  description: string;
  icon:        React.ReactNode;
  accentBg:    string;   // Tailwind bg class for the card accent stripe
  accentText:  string;   // Tailwind text class for icon/heading
  btnColor:    string;   // Tailwind classes for the trigger button
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

let _logId = 0;
function mkLog(msg: string): LogEntry {
  return { id: ++_logId, time: ts(), msg };
}

// ── Attack definitions ─────────────────────────────────────────────────────────
const ATTACKS: AttackDef[] = [
  {
    key:        'crash',
    label:      'Crash',
    endpoint:   '/attack/crash',
    description: 'Calls process.exit(1). Container dies instantly. Docker restarts it within seconds.',
    icon:        <SquareTerminal size={28} />,
    accentBg:   'bg-red-500',
    accentText:  'text-red-600',
    btnColor:    'bg-red-600 hover:bg-red-700 active:bg-red-800',
  },
  {
    key:        'oom',
    label:      'Memory (OOM)',
    endpoint:   '/attack/oom',
    description: 'Allocates 2 MB/s of real RAM. Docker OOM-kills the container at the 128 MB limit (~45 s).',
    icon:        <MemoryStick size={28} />,
    accentBg:   'bg-orange-500',
    accentText:  'text-orange-600',
    btnColor:    'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
  },
  {
    key:        'cpu',
    label:      'CPU Stress',
    endpoint:   '/attack/cpu',
    description: 'Worker threads peg the CPU limit for 60 s, then stop cleanly. No restart — just throttle.',
    icon:        <Cpu size={28} />,
    accentBg:   'bg-blue-500',
    accentText:  'text-blue-600',
    btnColor:    'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
  },
];

// ── Component ──────────────────────────────────────────────────────────────────
export default function DemoPage() {
  // Backend health
  const [status,        setStatus]        = useState<BackendStatus>('up');
  const [recoveryStart, setRecoveryStart] = useState<number | null>(null);

  // Per-attack cooldown counters (seconds remaining, 0 = no cooldown)
  const [cooldowns, setCooldowns] = useState<Record<AttackKey, number>>({
    crash: 0, oom: 0, cpu: 0,
  });

  // Which attack is currently in-flight (at most one at a time)
  const [activeAttack, setActiveAttack] = useState<AttackKey | null>(null);

  // Activity log
  const [log, setLog] = useState<LogEntry[]>([
    mkLog('Demo ready — backend is reachable'),
  ]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [mkLog(msg), ...prev].slice(0, 20));
  }, []);

  // Refs to avoid stale closures in polling loop
  const statusRef        = useRef<BackendStatus>('up');
  const recoveryRef      = useRef<number | null>(null);
  const activeAttackRef  = useRef<AttackKey | null>(null);
  const activeAttackSince = useRef<number | null>(null);
  statusRef.current       = status;
  recoveryRef.current     = recoveryStart;
  activeAttackRef.current = activeAttack;

  // Track when an attack started so we can auto-clear if stuck
  useEffect(() => {
    if (activeAttack !== null) {
      activeAttackSince.current = Date.now();
    } else {
      activeAttackSince.current = null;
    }
  }, [activeAttack]);

  // ── Cooldown ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setCooldowns(prev => {
        const next = { ...prev };
        let changed = false;
        (Object.keys(next) as AttackKey[]).forEach(k => {
          if (next[k] > 0) { next[k]--; changed = true; }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Health poll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

      try {
        const res = await fetch(`${API}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          if (statusRef.current === 'down' || statusRef.current === 'recovering') {
            // ── Recovery detected ──────────────────────────────────────────
            const elapsed = recoveryRef.current
              ? ((Date.now() - recoveryRef.current) / 1000).toFixed(1)
              : '?';
            addLog(`✅ Recovered in ${elapsed}s — backend is back up`);
            setStatus('up');
            setRecoveryStart(null);
            setActiveAttack(null);
          } else if (activeAttackRef.current !== null && activeAttackRef.current !== 'cpu') {
            // Backend is healthy + a crash/OOM attack is marked active.
            // Either: (a) the backend went down and came back without us catching the
            // transition (rapid restart), or (b) the attack flag is stuck.
            // In either case: clear it. For CPU we manage the timer separately.
            const heldMs = activeAttackSince.current
              ? Date.now() - activeAttackSince.current
              : 99999;
            if (heldMs > 3000) {
              // Only clear if it's been active for >3s (avoid clearing on the instant
              // first poll right after trigger)
              setActiveAttack(null);
            }
          }
        } else {
          // 503 or similar — backend process alive but unhealthy
          if (statusRef.current === 'up') {
            addLog('⚠️  Health check returned error — monitoring...');
            setStatus('recovering');
            if (!recoveryRef.current) setRecoveryStart(Date.now());
          }
        }
      } catch {
        clearTimeout(timeout);
        // Network error / timeout — backend is unreachable
        if (statusRef.current === 'up') {
          addLog('🔴 Backend unreachable — waiting for Docker restart...');
          setStatus('down');
          setRecoveryStart(Date.now());
        } else if (statusRef.current === 'down') {
          setStatus('recovering'); // second failed poll → show "Reconnecting"
        }
      }
    };

    const id = setInterval(poll, POLL_MS);
    poll(); // immediate first poll
    return () => { cancelled = true; clearInterval(id); };
  }, [addLog]);

  // ── Trigger attack ──────────────────────────────────────────────────────────
  const trigger = useCallback(async (attack: AttackDef) => {
    if (activeAttack || status !== 'up' || cooldowns[attack.key] > 0) return;

    setActiveAttack(attack.key);
    addLog(`⚡ Attack triggered: ${attack.label}`);

    try {
      const res = await fetch(`${API}${attack.endpoint}`, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'X-Attack-Token': TOKEN,
        },
      });

      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const secs = (body as any).seconds_remaining ?? 30;
        setCooldowns(prev => ({ ...prev, [attack.key]: secs }));
        addLog(`⏱  Cooldown active — wait ${secs}s before triggering ${attack.label} again`);
        setActiveAttack(null);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addLog(`✗ ${attack.label} failed: ${(body as any).error ?? res.status}`);
        setActiveAttack(null);
        return;
      }

      const body = await res.json().catch(() => ({}));
      addLog(`→ ${attack.label}: ${(body as any).message ?? 'started'}`);

      // CPU doesn't kill the container — clear the active attack after duration
      if (attack.key === 'cpu') {
        setTimeout(() => {
          setActiveAttack(null);
          addLog('↩ CPU stress ended — no restart');
        }, 62_000);
      }
      // crash/oom: activeAttack cleared when health poll detects recovery

    } catch {
      // Connection dropped immediately — backend crashed before responding (expected for crash attack)
      addLog(`→ ${attack.label}: container exiting (connection lost — expected)`);
      // health poll will detect down→up and call setActiveAttack(null)
    }
  }, [activeAttack, status, cooldowns, addLog]);

  // ── Derived state ────────────────────────────────────────────────────────────
  // Buttons are disabled when: backend is down/recovering, OR another attack is already active
  const allDisabled = status !== 'up' || activeAttack !== null;

  const recoveryElapsed = recoveryStart
    ? Math.floor((Date.now() - recoveryStart) / 1000)
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-yellow-400 flex items-center justify-center">
            <Zap size={18} className="text-gray-950" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide">Self-Healing Infrastructure</h1>
            <p className="text-xs text-gray-500">Live Demo</p>
          </div>
        </div>

        {/* Backend status pill */}
        <StatusPill status={status} elapsed={recoveryElapsed} />
      </header>

      {/* ── Recovery banner ─────────────────────────────────────────────────── */}
      {status !== 'up' && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 sm:px-8 py-3 flex items-center gap-3">
          <RefreshCw size={16} className="text-yellow-400 animate-spin shrink-0" />
          <span className="text-sm font-semibold text-yellow-300">
            {status === 'down'
              ? `Backend is down — Docker is restarting the container… (${recoveryElapsed}s)`
              : `Reconnecting to backend… (${recoveryElapsed}s)`}
          </span>
        </div>
      )}

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0 overflow-hidden">

        {/* Left — attack cards */}
        <section className="p-4 sm:p-8 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-6">
            Attack Endpoints
          </p>

          {/* "Attack in progress" message — only shown when another attack is active and backend is still up */}
          {activeAttack && status === 'up' && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 flex items-center gap-3 mb-2">
              <RefreshCw size={16} className="text-yellow-400 animate-spin shrink-0" />
              <span className="text-sm text-yellow-300 font-semibold">
                {activeAttack === 'cpu'
                  ? 'CPU stress in progress — wait for it to complete before triggering another attack'
                  : 'Attack sent — waiting for container to restart…'
                }
              </span>
            </div>
          )}

          {ATTACKS.map(a => (
            <AttackCard
              key={a.key}
              attack={a}
              disabled={allDisabled || cooldowns[a.key] > 0}
              cooldown={cooldowns[a.key]}
              isActive={activeAttack === a.key}
              onTrigger={() => trigger(a)}
            />
          ))}
        </section>

        {/* Right — activity log */}
        <aside className="border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
            <Clock size={14} className="text-gray-500" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Activity Log</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono">
            {log.map(entry => (
              <div key={entry.id} className="flex gap-3 text-[11px] leading-relaxed">
                <span className="text-gray-600 shrink-0 tabular-nums">{entry.time}</span>
                <span className="text-gray-300 break-words min-w-0">{entry.msg}</span>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {/* ── Footer — build info ─────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 px-4 sm:px-8 py-3 flex items-center justify-between text-[10px] text-gray-600">
        <span>IMS Platform · Self-Healing Demo</span>
        <span className="font-mono">
          Built {BUILD === 'dev' ? 'dev build' : new Date(BUILD).toLocaleString()}
        </span>
      </footer>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusPill({ status, elapsed }: { status: BackendStatus; elapsed: number }) {
  if (status === 'up') {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs font-semibold text-green-400">Backend healthy</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5">
      <WifiOff size={12} className="text-yellow-400" />
      <span className="text-xs font-semibold text-yellow-400">
        {status === 'down' ? 'Down' : 'Reconnecting'} · {elapsed}s
      </span>
    </div>
  );
}

function AttackCard({
  attack,
  disabled,
  cooldown,
  isActive,
  onTrigger,
}: {
  attack:    AttackDef;
  disabled:  boolean;
  cooldown:  number;
  isActive:  boolean;
  onTrigger: () => void;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 overflow-hidden transition-opacity ${disabled ? 'opacity-60' : 'opacity-100'}`}>
      <div className="flex">
        {/* Accent stripe */}
        <div className={`w-1.5 shrink-0 ${attack.accentBg}`} />

        <div className="flex-1 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">

            {/* Icon + text */}
            <div className="flex items-start gap-4 flex-1">
              <div className={`shrink-0 ${attack.accentText}`}>{attack.icon}</div>
              <div>
                <h2 className="text-base font-bold text-white">{attack.label}</h2>
                <p className="text-sm text-gray-400 mt-0.5 leading-relaxed max-w-md">
                  {attack.description}
                </p>
              </div>
            </div>

            {/* Trigger button */}
            <button
              onClick={onTrigger}
              disabled={disabled}
              className={`
                min-w-[120px] min-h-[44px] px-5 py-3 rounded-xl text-sm font-bold text-white
                transition-all shrink-0 flex items-center justify-center gap-2
                disabled:cursor-not-allowed
                ${disabled
                  ? 'bg-white/10 text-gray-500'
                  : attack.btnColor
                }
              `}
            >
              {isActive ? (
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={13} className="animate-spin" />
                  In progress
                </span>
              ) : cooldown > 0 ? (
                <>
                  <Clock size={14} />
                  <span>{cooldown}s</span>
                </>
              ) : disabled ? (
                <span className="flex items-center gap-1.5">
                  <RefreshCw size={13} className="animate-spin" />
                  Wait...
                </span>
              ) : (
                <>
                  <Zap size={14} />
                  Trigger
                </>
              )}
            </button>
          </div>

          {/* Cooldown message */}
          {cooldown > 0 && (
            <p className="mt-3 text-xs text-yellow-400 font-semibold">
              ⏱ Please wait {cooldown}s before triggering {attack.label} again
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
