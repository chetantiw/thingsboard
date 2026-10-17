// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0

export type AppearanceLayout = 'classic' | 'control';
export type AppearanceTheme = 'indigo' | 'arctic' | 'midnight' | 'carbon';
export type AppearanceDensity = 'comfortable' | 'compact';
export type AppearanceStartPage = 'home' | 'overview';

export interface Appearance {
  layout: AppearanceLayout;
  theme: AppearanceTheme;
  density: AppearanceDensity;
  followSystem: boolean;
  startPage: AppearanceStartPage;
}

export interface AppearanceThemeInfo {
  id: AppearanceTheme;
  name: string;
  dark: boolean;
  // Colors used to draw the theme preview swatch.
  bg: string;
  rail: string;
  surface: string;
  accent: string;
}

export const appearanceThemes: AppearanceThemeInfo[] = [
  { id: 'indigo', name: 'Indigo Day', dark: false, bg: '#F4F5FA', rail: '#1B1961', surface: '#FFFFFF', accent: '#13B5C9' },
  { id: 'arctic', name: 'Arctic', dark: false, bg: '#E8F1F4', rail: '#0F3D4A', surface: '#FFFFFF', accent: '#0E7490' },
  { id: 'midnight', name: 'Midnight', dark: true, bg: '#0B0A1F', rail: '#13113A', surface: '#15133A', accent: '#22D3EE' },
  { id: 'carbon', name: 'Carbon Amber', dark: true, bg: '#0E0E0E', rail: '#181818', surface: '#191919', accent: '#F5A524' }
];

// Browser-local copy of the appearance, used before the user's settings are loaded.
export const APPEARANCE_STORAGE_KEY = 'mt_appearance';

export const defaultAppearance: Appearance = {
  layout: 'classic',
  theme: 'indigo',
  density: 'comfortable',
  followSystem: false,
  startPage: 'home'
};
