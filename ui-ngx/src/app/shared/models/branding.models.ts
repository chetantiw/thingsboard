// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0

// White labeling brand, as stored by /api/mutech/branding/settings. Every field is optional:
// an empty field inherits the value of the level above (platform -> tenant -> customer).
export interface Branding {
  appTitle?: string;
  logoUrl?: string;
  emblemUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  loginLogoUrl?: string;
  loginBackgroundUrl?: string;
  loginHeadline?: string;
  loginSubtitle?: string;
  footerText?: string;
  poweredByText?: string;
  hidePoweredBy?: boolean;
  hideHelpLinks?: boolean;
  domains?: string[];
}

export type BrandingLevel = 'system' | 'tenant' | 'customer';

export interface BrandingSettings {
  branding: Branding;
  inherited: Branding;
}

// Browser-local copy of the last brand, used by the start-up screen before the app loads.
export const BRANDING_STORAGE_KEY = 'mt_branding';

export const DEFAULT_APP_TITLE = 'MuTech-IoT';

export const BRANDING_IMAGE_MAX_BYTES = 1536 * 1024;
