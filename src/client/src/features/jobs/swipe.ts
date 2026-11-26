import type { TriageAction } from '../../../../shared/api';
import type { TriageStatus } from '../../../../shared/schemas';
import type { SwipeDirection } from './useSwipe';

/** A swipe takes a triage action, or asks to remove the application of an applied posting. */
export type SwipeAction = TriageAction | 'remove-application';

/**
 * The statuses form one line: dismissed, new, saved, applied. A swipe to the right moves a posting one
 * step toward applied, a swipe to the left one step toward dismissed. "restore" is the step back to new.
 */
export const SWIPE_ACTIONS: Record<TriageStatus, Record<SwipeDirection, SwipeAction | null>> = {
  dismissed: { left: null, right: 'restore' },
  new: { left: 'dismiss', right: 'save' },
  saved: { left: 'restore', right: 'apply' },
  applied: { left: 'remove-application', right: null },
};

/** The words in the space that a moving card uncovers. */
export const SWIPE_LABEL: Record<SwipeAction, string> = {
  dismiss: 'Dismiss',
  save: 'Save',
  apply: 'Mark applied',
  restore: 'Back to new',
  'remove-application': 'Remove application',
};
