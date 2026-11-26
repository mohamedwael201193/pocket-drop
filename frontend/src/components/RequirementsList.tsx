import { useState } from 'react';
import { ExternalLink } from './icons';
import { Mono, SourceBadge, cx } from './ui';
import { SOURCE_URL, txUrl } from '../lib/config';
import type { Requirement } from '../data/requirements';

export interface HealthSnapshot {
  relay?: { mode: string; classicalPathOpen: boolean };
  window: { live?: boolean; allowedTargets?: string[] };
}

const blob = (p: string) => `${SOURCE_URL}/blob/main/${p}`;

export const TEST_COLLAPSE_THRESHOLD = 4;
export const TEST_PREVIEW_COUNT = 3;

export function splitRequirement(text: string): { title: string; summary?: string } {
  const dot = text.indexOf('. ');
  if (dot > 0 && dot < 60) {
    return { title: text.slice(0, dot), summary: text.slice(dot + 2) };
  }
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const head = text.slice(0, colon);
    if (!head.startsWith('http') && !/^v\d+(\.\d+)?$/i.test(head)) {
      return { title: head, summary: text.slice(colon + 2) };
    }
  }
  const semi = text.indexOf('; ');
  if (semi > 15) {
    return { title: text.slice(0, semi), summary: text.slice(semi + 2) };
  }
  return { title: text };
}

export function isRefusedTx(label: string): boolean {
  return /\b(reverted|refused)\b/i.test(label);
}

function RequirementCard({ req, index, health }: { req: Requirement; index: number; health?: HealthSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const { title, summary } = splitRequirement(req.requirement);
  const collapsible = req.tests.length > TEST_COLLAPSE_THRESHOLD;
  const visibleTests = collapsible && !expanded ? req.tests.slice(0, TEST_PREVIEW_COUNT) : req.tests;

  return (
    <article
      data-testid={`req-${req.id}`}
      data-req-card=""
      className="min-w-0 rounded-xl border border-zinc-200 bg-stoneBg/55 p-4 transition-colors hover:border-zinc-300"
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full bg-zinc-900 px-2 font-mono text-xs font-medium text-stone-100"
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-zinc-900 [overflow-wrap:anywhere]">{title}</h3>
          {summary && <p className="mt-1 text-xs leading-relaxed text-zinc-600 [overflow-wrap:anywhere]">{summary}</p>}
        </div>
      </header>

      <div className="mt-3.5 space-y-3 border-t border-zinc-200/80 pt-3.5">
        <div className="grid gap-4 md:grid-cols-12">
          <div className="min-w-0 md:col-span-5">
            <div className="mb-1.5 font-mono text-xs font-medium uppercase tracking-wider text-zinc-500">
              Code
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {req.code.map((c) => (
                <li key={c.path} className="max-w-full">
                  <a
                    href={blob(c.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs leading-snug text-zinc-800 underline decoration-zinc-300 underline-offset-2 transition-colors hover:border-zinc-400 hover:text-zinc-950 hover:decoration-zinc-700 [overflow-wrap:anywhere]"
                  >
                    <span className="min-w-0 break-words">{c.label}</span>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 md:col-span-7">
            <div className="mb-1.5 font-mono text-xs font-medium uppercase tracking-wider text-zinc-500">
              Live on Diana
            </div>
            <ul className="space-y-2 text-xs leading-relaxed">
              {req.liveHealth && (
                <li
                  data-testid="req-window-live"
                  className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-2.5 py-1.5 text-zinc-800 [overflow-wrap:anywhere]"
                >
                  <SourceBadge kind="LIVE" />
                  <span className="min-w-0">
                    {health ? (
                      <>
                        {health.relay ? (
                          <>
                            relays {health.relay.mode}, ECDSA-only path{' '}
                            {health.relay.classicalPathOpen ? 'open' : 'closed'};{' '}
                          </>
                        ) : null}
                        window {health.window.live ? 'live' : 'closed'}, allowed targets{' '}
                        {(health.window.allowedTargets ?? []).length
                          ? (health.window.allowedTargets ?? [])
                              .map((a) => <Mono key={a}>{a.slice(0, 8)}…</Mono>)
                              .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])
                          : '–'}
                      </>
                    ) : (
                      'reading /api/health…'
                    )}
                  </span>
                </li>
              )}

              {req.live.map((t) => {
                const refused = isRefusedTx(t.label);
                return (
                  <li key={t.label} className="flex items-start gap-2 text-zinc-800">
                    <span
                      aria-hidden
                      className={cx(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        refused ? 'bg-red-500' : t.hash ? 'bg-emerald-600' : 'bg-zinc-400',
                      )}
                    />
                    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {refused && (
                        <span className="mr-1.5 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-xs font-medium text-red-800">
                          refused
                        </span>
                      )}
                      {t.hash ? (
                        <a
                          href={txUrl(t.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline items-baseline text-zinc-900 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-black hover:decoration-zinc-700"
                        >
                          <span>{t.label}</span>
                          <ExternalLink className="ml-1 inline-block h-3 w-3 align-text-bottom text-zinc-500" aria-hidden />
                        </a>
                      ) : (
                        <>
                          <span>{t.label}</span>
                          {t.note && (
                            <span className="text-zinc-500">
                              {' ('}
                              {/^https?:\/\//.test(t.note) ? (
                                <a
                                  href={t.note}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="break-all text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-black hover:decoration-zinc-700"
                                >
                                  {t.note}
                                </a>
                              ) : (
                                t.note
                              )}
                              {')'}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="min-w-0 border-t border-zinc-200/70 pt-3">
          <div className="mb-1.5 font-mono text-xs font-medium uppercase tracking-wider text-zinc-500">
            Tests ({req.tests.length})
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {visibleTests.map((testName) => (
              <li key={testName} className="max-w-full">
                <code className="block max-w-full whitespace-normal break-words rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-mono text-xs leading-relaxed text-zinc-800 [overflow-wrap:anywhere]">
                  {testName}
                </code>
              </li>
            ))}
          </ul>
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              data-testid={`req-${req.id}-toggle-tests`}
              className="mt-2 inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-500 hover:bg-stoneCard hover:text-zinc-950"
            >
              {expanded ? 'Show fewer' : `Show all ${req.tests.length} tests`}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function RequirementsList({
  requirements,
  health,
}: {
  requirements: Requirement[];
  health?: HealthSnapshot;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5" data-testid="req-table">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold leading-snug text-zinc-900">
          Every track requirement: code, live transaction, test
        </h2>
        <SourceBadge
          kind="RECORDED"
          title="Hashes from contracts-v4/deployments/diana.json and frontend/evidence; reverify.mjs re-checks each one"
        />
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">
        Each hash opens the explorer. Items marked <span className="font-mono text-red-800">refused</span> are attacks the chain rejected. Test names are Foundry tests in <code className="font-mono">contracts-v4/test</code> unless marked.
      </p>
      <div className="mt-4 space-y-3">
        {requirements.map((r, i) => (
          <RequirementCard key={r.id} req={r} index={i} health={health} />
        ))}
      </div>
    </section>
  );
}
