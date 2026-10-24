import type { LinkTarget, SiteId } from '../shared/types';

export interface SiteInfo {
  id: SiteId;
  home: string;
  hosts: string[];
}

export const SITES: Record<SiteId, SiteInfo> = {
  haunt: { id: 'haunt', home: 'https://haunt.gg/dashboard', hosts: ['haunt.gg'] },
  tools: { id: 'tools', home: 'https://app.haunt-tools.site/', hosts: ['app.haunt-tools.site'] },
};

const AUTH_PAGES: Array<{ host: RegExp; path?: RegExp }> = [
  { host: /^(www\.|ptb\.|canary\.)?discord\.com$/, path: /^\/(oauth2|login|register|api\/(v\d+\/)?oauth2)(\/|$|\?)/ },
  { host: /^(www\.)?github\.com$/, path: /^\/(login|session|sessions)(\/|$)/ },
  { host: /^accounts\.google\.[a-z.]+$/ },
  { host: /^(appleid|idmsa)\.apple\.com$/ },
];

const HAUNT_AUTH_PATH = /(oauth|authorize|consent|login|signin|sign-in|auth)/i;

export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isWebUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return !!url && (url.protocol === 'https:' || url.protocol === 'http:');
}

export function siteOf(raw: string): SiteId | null {
  const url = parseUrl(raw);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  const host = url.hostname.toLowerCase();
  for (const site of Object.values(SITES)) {
    if (site.hosts.some((h) => host === h || host.endsWith('.' + h))) return site.id;
  }
  return null;
}

export function isAuthPage(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url || url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return AUTH_PAGES.some((rule) => rule.host.test(host) && (!rule.path || rule.path.test(url.pathname + url.search)));
}

function isHauntAuthPage(raw: string): boolean {
  const url = parseUrl(raw);
  return !!url && siteOf(raw) === 'haunt' && HAUNT_AUTH_PATH.test(url.pathname);
}

export type Decision =
  | { kind: 'allow' }
  | { kind: 'block' }
  | { kind: 'site'; site: SiteId; url: string }
  | { kind: 'popup'; url: string }
  | { kind: 'auth-popup' }
  | { kind: 'external'; url: string };

function nonWeb(raw: string): Decision {
  const url = parseUrl(raw);
  return url && url.protocol === 'mailto:' ? { kind: 'external', url: raw } : { kind: 'block' };
}

export function decideNavigation(from: SiteId, raw: string, links: LinkTarget): Decision {
  if (!isWebUrl(raw)) return nonWeb(raw);
  const target = siteOf(raw);
  if (target === from) return { kind: 'allow' };
  if (isAuthPage(raw)) return { kind: 'allow' };
  if (from === 'tools' && isHauntAuthPage(raw)) return { kind: 'allow' };
  if (target) return { kind: 'site', site: target, url: raw };
  return links === 'browser' ? { kind: 'external', url: raw } : { kind: 'popup', url: raw };
}

export function decideWindowOpen(from: SiteId, raw: string, features: string, links: LinkTarget): Decision {
  if (!isWebUrl(raw)) return nonWeb(raw);
  const target = siteOf(raw);
  const sized = /(width|height)\s*=/.test(features);
  if (from === 'tools' && sized && isHauntAuthPage(raw)) return { kind: 'auth-popup' };
  if (from === 'haunt' && target === 'haunt' && !sized && !isHauntAuthPage(raw)) return { kind: 'popup', url: raw };
  if (target) return { kind: 'site', site: target, url: raw };
  if (isAuthPage(raw) || sized) return { kind: 'auth-popup' };
  return links === 'browser' ? { kind: 'external', url: raw } : { kind: 'popup', url: raw };
}

export function decidePopupNavigation(kind: 'link' | 'auth', raw: string, home: SiteId | null = null): Decision {
  if (!isWebUrl(raw)) return nonWeb(raw);
  if (kind === 'auth') return { kind: 'allow' };
  const target = siteOf(raw);
  if (target && target === home) return { kind: 'allow' };
  if (target && !isHauntAuthPage(raw)) return { kind: 'site', site: target, url: raw };
  return { kind: 'allow' };
}
