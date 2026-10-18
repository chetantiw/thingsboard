// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
//
// Maps the stock ThingsBoard widget defaults (white cards, black text, the ThingsBoard blues,
// Roboto) to the colors and fonts of the active MuTech theme. Colors the user picked in the
// widget settings are left untouched. Values are resolved to concrete colors so they also work
// on canvas (charts, gauges) and with tinycolor.
import tinycolor from 'tinycolor2';
import { Observable, Subject } from 'rxjs';

// Body class set by the AppearanceService when the user chose the original widget look.
export const MT_ORIGINAL_WIDGETS_CLASS = 'mt-widgets-original';

// ThingsBoard accent blues used as defaults by the widget library.
const accentColors = ['#5469ff', '#3f52dd', '#305680', '#307fe5', '#2196f3'];

let bodyClassName: string = null;
// Theme classes of the body (mt-theme-*, mt-layout-*, mt-dark, ...); other body classes
// (dialogs, scroll blocking) do not change widget colors.
let cacheKey: string = null;
let tokens: {[name: string]: string} = {};
const colorCache = new Map<string, string>();

const body = (): HTMLElement => typeof document !== 'undefined' ? document.body : null;

const refresh = (): boolean => {
  const element = body();
  if (!element) {
    return false;
  }
  if (element.className !== bodyClassName) {
    bodyClassName = element.className;
    const themeKey = Array.from(element.classList).filter(name => name.startsWith('mt-')).join(' ');
    if (themeKey !== cacheKey) {
      cacheKey = themeKey;
      tokens = {};
      colorCache.clear();
    }
  }
  return !element.classList.contains(MT_ORIGINAL_WIDGETS_CLASS);
};

export const mtWidgetThemeEnabled = (): boolean => refresh();

// Concrete value of a --mt-* token for the current theme.
export const mtToken = (name: string): string => {
  if (!(name in tokens)) {
    const element = body();
    tokens[name] = element ? getComputedStyle(element).getPropertyValue(`--mt-${name}`).trim() : '';
  }
  return tokens[name];
};

export const mtDarkTheme = (): boolean => !!body()?.classList.contains('mt-dark') && mtWidgetThemeEnabled();

const withAlpha = (color: string, alpha: number): string => {
  const instance = tinycolor(color);
  instance.setAlpha(instance.getAlpha() * alpha);
  return alpha >= 1 ? color : instance.toRgbString();
};

// Light neutral greys of gauge tracks and bar backgrounds; light greys elsewhere (ticks and
// numbers on dark gauge plates) are left alone.
const mapSurfaceGrey = (color: string): string => {
  const instance = tinycolor(color);
  const {r, g, b, a} = instance.toRgb();
  if (instance.isValid() && r === g && g === b && r >= 0xcc && r < 0xff) {
    return withAlpha(mtToken(r >= 0xf0 ? 'surface-2' : 'border'), a);
  }
  return null;
};

const surfaceKeyPattern = /background|gaugeColor|track|plate|barColor/i;

const mapColor = (color: string): string => {
  const instance = tinycolor(color);
  if (!instance.isValid()) {
    return color;
  }
  const {r, g, b, a} = instance.toRgb();
  if (a === 0) {
    return color;
  }
  if (r === 255 && g === 255 && b === 255) {
    return withAlpha(mtToken('surface'), a);
  }
  if (r === 0 && g === 0 && b === 0) {
    // Text and lines drawn in translucent black become the theme text color.
    return a >= 0.7 ? mtToken('text') : withAlpha(mtToken('text'), Math.min(1, a / 0.87));
  }
  const hex = '#' + instance.toHex();
  if (accentColors.includes(hex)) {
    return withAlpha(mtToken('accent'), a);
  }
  return color;
};

// Theme color for a stock default color; any other color is returned as is.
export const mtColor = <T extends string>(color: T): T => {
  if (!color || typeof color !== 'string' || !refresh() || color.includes('var(')) {
    return color;
  }
  let mapped = colorCache.get(color);
  if (mapped === undefined) {
    mapped = mapColor(color) || color;
    colorCache.set(color, mapped);
  }
  return mapped as T;
};

// Theme font for the stock widget font (Roboto); custom fonts are kept.
export const mtFontFamily = (family: string): string => {
  if (refresh() && (!family || family === 'Roboto' || family === 'Roboto, sans-serif')) {
    return mtToken('font') || family;
  }
  return family;
};

// Stock dashboard backdrop colors become the theme page background.
const backdropColors = ['#eeeeee', '#eceff1', '#f5f5f5'];

export const mtBackdropColor = (color: string): string => {
  if (refresh()) {
    const instance = tinycolor(color);
    if (!color || (instance.isValid() && backdropColors.includes('#' + instance.toHex()))) {
      return mtToken('bg') || color;
    }
  }
  return color;
};

const themeChangedSubject = new Subject<void>();

// Emits when the widget colors change (theme or widget style switched), so widgets repaint.
export const mtWidgetThemeChanged$: Observable<void> = themeChangedSubject.asObservable();

export const notifyMtWidgetThemeChanged = (): void => themeChangedSubject.next();

const colorValuePattern = /^\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|white|black)\s*$/i;
const themedSettingsCache = new WeakMap<object, {key: string; value: any}>();

const cssColorPattern = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g;

// Stock colors written inside CSS text (Markdown/HTML card styles) are themed too.
export const mtThemedCss = (css: string): string =>
  css && refresh() ? css.replace(cssColorPattern, color => mtColor(color)) : css;

const themeValue = (value: any, key?: string): any => {
  if (typeof value === 'string') {
    if (key === 'family') {
      return mtFontFamily(value);
    }
    if (key && /css$/i.test(key)) {
      return mtThemedCss(value);
    }
    if (!colorValuePattern.test(value)) {
      return value;
    }
    return (key && surfaceKeyPattern.test(key) && mapSurfaceGrey(value)) || mtColor(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => themeValue(item));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {};
    for (const name of Object.keys(value)) {
      result[name] = themeValue(value[name], name);
    }
    return result;
  }
  return value;
};

// Copy of the widget settings with the stock colors and fonts replaced by the theme ones.
// The widget configuration itself is never changed, so saved dashboards keep their values.
export const mtThemedSettings = <T>(settings: T): T => {
  if (!settings || typeof settings !== 'object' || !refresh()) {
    return settings;
  }
  const cached = themedSettingsCache.get(settings);
  if (cached && cached.key === cacheKey) {
    return cached.value;
  }
  const value = themeValue(settings);
  themedSettingsCache.set(settings, {key: cacheKey, value});
  return value;
};
