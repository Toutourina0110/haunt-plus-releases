import type { TabId } from './types';

export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  fg: string;
  muted: string;
  accent: string;
  onAccent: string;
}

const SITES: Record<TabId, { dark: Omit<Palette, 'fg' | 'muted'>; light: Omit<Palette, 'fg' | 'muted'> }> = {
  haunt: {
    dark: {
      bg: '#0C0A0B',
      surface: '#151113',
      raised: '#1D181B',
      line: '#2A2327',
      accent: '#F27DB3',
      onAccent: '#1A0A12',
    },
    light: {
      bg: '#FBF8FA',
      surface: '#FFFFFF',
      raised: '#F3EDF0',
      line: '#E6DCE1',
      accent: '#B8336F',
      onAccent: '#FFFFFF',
    },
  },
  tools: {
    dark: {
      bg: '#0D0D10',
      surface: '#141419',
      raised: '#1C1C23',
      line: '#26262F',
      accent: '#8079C9',
      onAccent: '#0C0A1F',
    },
    light: {
      bg: '#F6F6F9',
      surface: '#FFFFFF',
      raised: '#ECECF2',
      line: '#DCDDE6',
      accent: '#5F57B8',
      onAccent: '#FFFFFF',
    },
  },
  images: {
    dark: {
      bg: '#060606',
      surface: '#0E0E0E',
      raised: '#151515',
      line: '#1C1C1C',
      accent: '#8079C9',
      onAccent: '#0C0A1F',
    },
    light: {
      bg: '#FFFFFF',
      surface: '#F5F5F5',
      raised: '#EEEEEE',
      line: '#E5E5E5',
      accent: '#5F57B8',
      onAccent: '#FFFFFF',
    },
  },
};

const TEXT = {
  dark: { fg: '#EDE8EC', muted: '#9A939A' },
  light: { fg: '#1C181B', muted: '#625B63' },
};

export function palette(site: TabId, dark: boolean): Palette {
  const tone = dark ? 'dark' : 'light';
  return { ...SITES[site][tone], ...TEXT[tone] };
}
