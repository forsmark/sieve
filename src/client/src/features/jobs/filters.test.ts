import { describe, expect, it } from 'vitest';
import {
  clearFilters, hasActiveFilters, jobSearchToParams, normalizeStatus, parseJobSearch, parseSearchString, stringifySearchObject, toPostingQuery,
  type JobSearch,
} from './filters';

function roundTrip(s: JobSearch): JobSearch {
  return parseJobSearch(parseSearchString(stringifySearchObject(parseJobSearch(s as Record<string, unknown>) as Record<string, unknown>)));
}

describe('job filters in the URL', () => {
  it('round-trips every filter through the URL', () => {
    const full: JobSearch = {
      id: '123',
      status: 'saved,dismissed',
      source: 'linkedin',
      work: 'remote',
      minScore: 70,
      tag: 'TypeScript',
      maxAgeDays: 7,
      q: 'frontend developer',
      unread: true,
      showExcluded: true,
      showDuplicates: true,
      sort: 'newest',
    };
    expect(roundTrip(full)).toEqual(full);
  });

  it('keeps a numeric-looking posting id as a string', () => {
    const parsed = parseJobSearch(parseSearchString('?id=00123'));
    expect(parsed.id).toBe('00123');
  });

  it('reads the notification link `/jobs?id=<postingId>`', () => {
    expect(parseJobSearch(parseSearchString('?id=abc-def'))).toEqual({ id: 'abc-def' });
  });

  it('leaves defaults out of the URL', () => {
    expect(stringifySearchObject(parseJobSearch({ status: 'new,saved', sort: 'score', minScore: '0', unread: '0' }) as Record<string, unknown>)).toBe('');
    expect(jobSearchToParams({}).toString()).toBe('');
  });

  it('writes flags as 1 and reads both 1 and true', () => {
    expect(stringifySearchObject({ unread: true })).toBe('?unread=1');
    expect(parseJobSearch({ unread: 'true', showExcluded: '1', showDuplicates: 'no' })).toEqual({ unread: true, showExcluded: true });
  });

  it('drops invalid values', () => {
    expect(parseJobSearch({ work: 'moon', minScore: '500', maxAgeDays: '-3', sort: 'random', status: 'bogus', q: '   ' })).toEqual({});
  });

  it('normalizes the status list', () => {
    expect(normalizeStatus('dismissed,new')).toBe('new,dismissed');
    expect(normalizeStatus('saved,new')).toBeUndefined();
    expect(normalizeStatus('new,saved,applied,dismissed')).toBe('all');
    expect(normalizeStatus('all')).toBe('all');
  });

  it('builds the API query without the selection', () => {
    expect(toPostingQuery({ id: 'x', work: 'remote', minScore: 70 })).toEqual({ status: 'new,saved', sort: 'score', work: 'remote', minScore: 70 });
    expect(toPostingQuery({ unread: true, sort: 'newest' })).toEqual({ status: 'new,saved', sort: 'newest', unread: true });
  });

  it('knows when filters are active and clears them but keeps sort and selection', () => {
    expect(hasActiveFilters({ id: 'x', sort: 'newest' })).toBe(false);
    expect(hasActiveFilters({ tag: 'go' })).toBe(true);
    expect(clearFilters({ id: 'x', sort: 'newest', tag: 'go', minScore: 50 })).toEqual({ id: 'x', sort: 'newest' });
  });
});
