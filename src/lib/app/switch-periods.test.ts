import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEST_SECONDS,
  DEFAULT_INACTIVITY_SECONDS,
  describePeriods,
  formatMoment,
  formatPeriod,
  isPeriodAllowed,
  nearestAllowedPeriod,
  PERIOD_OPTIONS,
  periodFloorHint,
  periodsChanged,
  selectablePeriods,
} from './switch-periods';

const DEPLOYED_MIN_INACTIVITY = 300;
const DEPLOYED_MIN_CONTEST = 120;

describe('the period options', () => {
  it('offers the six testing durations, ascending', () => {
    expect(PERIOD_OPTIONS.map((option) => option.seconds)).toEqual([
      60, 180, 300, 600, 1_800, 86_400,
    ]);
  });

  it('labels each one the way the select reads it', () => {
    expect(PERIOD_OPTIONS.map((option) => option.label)).toEqual([
      '1 minute',
      '3 minutes',
      '5 minutes',
      '10 minutes',
      '30 minutes',
      '24 hours',
    ]);
  });

  it('defaults to the periods the switch was shipped with', () => {
    expect(DEFAULT_INACTIVITY_SECONDS).toBe(600);
    expect(DEFAULT_CONTEST_SECONDS).toBe(300);
  });
});

describe('what the deployed contract will accept', () => {
  it('greys out 1 and 3 minutes for inactivity, which the live floor of 5 refuses', () => {
    const allowed = selectablePeriods(DEPLOYED_MIN_INACTIVITY)
      .filter((option) => option.allowed)
      .map((option) => option.seconds);

    expect(allowed).toEqual([300, 600, 1_800, 86_400]);
  });

  it('greys out only 1 minute for the contest period, whose live floor is 2', () => {
    const allowed = selectablePeriods(DEPLOYED_MIN_CONTEST)
      .filter((option) => option.allowed)
      .map((option) => option.seconds);

    expect(allowed).toEqual([180, 300, 600, 1_800, 86_400]);
  });

  it('opens every option once a deployment sets the floor at or below a minute', () => {
    expect(selectablePeriods(60).every((option) => option.allowed)).toBe(true);
    expect(selectablePeriods(1).every((option) => option.allowed)).toBe(true);
  });

  it('answers the floor question directly', () => {
    expect(isPeriodAllowed(60, DEPLOYED_MIN_INACTIVITY)).toBe(false);
    expect(isPeriodAllowed(300, DEPLOYED_MIN_INACTIVITY)).toBe(true);
  });
});

describe('picking a period the chain will not reject', () => {
  it('keeps a choice that already clears the floor', () => {
    expect(nearestAllowedPeriod(600, DEPLOYED_MIN_INACTIVITY)).toBe(600);
  });

  it('raises a choice below the floor to the smallest option above it', () => {
    expect(nearestAllowedPeriod(60, DEPLOYED_MIN_INACTIVITY)).toBe(300);
    expect(nearestAllowedPeriod(60, DEPLOYED_MIN_CONTEST)).toBe(180);
  });

  it('falls back to the floor itself when no option clears it', () => {
    expect(nearestAllowedPeriod(60, 172_800)).toBe(172_800);
  });
});

describe('the floor hint', () => {
  it('says nothing when every option is available', () => {
    expect(periodFloorHint(60)).toBeUndefined();
    expect(periodFloorHint(0)).toBeUndefined();
  });

  it('names the floor when options are greyed out', () => {
    expect(periodFloorHint(DEPLOYED_MIN_INACTIVITY)).toContain('5 minutes');
    expect(periodFloorHint(DEPLOYED_MIN_CONTEST)).toContain('2 minutes');
  });
});

describe('formatting a duration', () => {
  it('reuses the option label when the value is one of them', () => {
    expect(formatPeriod(60)).toBe('1 minute');
    expect(formatPeriod(86_400)).toBe('24 hours');
  });

  it('falls back to the largest whole unit for values off the list', () => {
    expect(formatPeriod(120)).toBe('2 minutes');
    expect(formatPeriod(7_200)).toBe('2 hours');
    expect(formatPeriod(172_800)).toBe('2 days');
    expect(formatPeriod(90)).toBe('90 seconds');
    expect(formatPeriod(1)).toBe('1 second');
  });
});

describe('the sentence under the selects', () => {
  it('states both halves of the switch in the user\'s own terms', () => {
    expect(describePeriods(300, 120)).toBe(
      'Your heirs can start a release after 5 minutes of silence, and you then have ' +
        '2 minutes to stop it.',
    );
  });
});

describe('knowing when the periods need saving', () => {
  const chain = { inactivityPeriodSeconds: 600, contestPeriodSeconds: 300 };

  it('is false while the selects match the chain', () => {
    expect(periodsChanged({ inactivitySeconds: 600, contestSeconds: 300 }, chain)).toBe(false);
  });

  it('is true when either half was changed', () => {
    expect(periodsChanged({ inactivitySeconds: 300, contestSeconds: 300 }, chain)).toBe(true);
    expect(periodsChanged({ inactivitySeconds: 600, contestSeconds: 180 }, chain)).toBe(true);
  });

  it('is false before the chain has been read, so nothing is offered to save', () => {
    expect(periodsChanged({ inactivitySeconds: 60, contestSeconds: 60 }, undefined)).toBe(false);
  });
});

describe('timestamps at testing granularity', () => {
  it('carries the time, not just the date — minute-scale periods need it', () => {
    const rendered = formatMoment(new Date('2026-08-24T15:04:00Z'));
    expect(rendered).toMatch(/\d/);
    expect(rendered.length).toBeGreaterThan('Aug 24, 2026'.length);
  });
});
