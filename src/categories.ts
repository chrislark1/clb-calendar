import type { CalendarEvent } from './types.ts';

export const CATEGORIES = {
  'Bank Holiday': { color: '#E74C3C', text: '#111111' },
  Social: { color: '#16A6A6', text: '#111111' },
  Holiday: { color: '#9B59B6', text: '#FFFFFF' },
  Sport: { color: '#E91E63', text: '#000000' },
  Wedding: { color: '#F4D03F', text: '#111111' },
  'Work / Jobs': { color: '#E67E22', text: '#111111' },
  Garden: { color: '#27AE60', text: '#111111' },
  Other: { color: '#424242', text: '#FFFFFF' },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_PROPERTY = 'clbCalendarCategory';
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && Object.hasOwn(CATEGORIES, value);
}

// Configure defaults here using IDs discovered in Google Calendar. Calendar
// ownership and category are independent; never infer categories from owners.
export const CALENDAR_CATEGORIES: Readonly<Record<string, Category>> = {};
export function categoryFor(event: CalendarEvent, mapping = CALENDAR_CATEGORIES): Category {
  const explicit = event.sharedProperties?.[CATEGORY_PROPERTY];
  if (isCategory(explicit)) return explicit;
  const fallback = Object.hasOwn(mapping, event.calendarId) ? mapping[event.calendarId] : undefined;
  return isCategory(fallback) ? fallback : 'Other';
}

export function calendarColor(color?: string): string {
  return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : '#888888';
}
