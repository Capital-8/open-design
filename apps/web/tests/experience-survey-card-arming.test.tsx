// @vitest-environment jsdom

// The card's arming rule is the whole product decision of this survey: ask
// once per user, after a delivered artifact. None of that is visible in the
// trigger module — the delay, the consent gate and the retire-on-shown rule
// all live in the component — so they are pinned here.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/i18n', () => ({
  useT: () => (key: string) => key,
}));

import { ExperienceSurvey } from '../src/components/ExperienceSurvey';
import {
  SURVEY_DELAY_MS,
  notifyArtifactDelivered,
} from '../src/components/experience-survey-trigger';

function deliverArtifact() {
  act(() => {
    notifyArtifactDelivered();
  });
}

function passTheDelay() {
  act(() => {
    vi.advanceTimersByTime(SURVEY_DELAY_MS + 50);
  });
}

const card = () => screen.queryByText('experienceSurvey.recommendation');

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.body.removeAttribute('data-web-modal-scroll-lock');
  vi.useRealTimers();
});

describe('experience survey card arming', () => {
  it.each(['style', 'attribute'] as const)(
    'waits for a %s modal lock to be released before showing the card',
    async (lock) => {
      const onExposure = vi.fn();
      render(<ExperienceSurvey metricsConsent onExposure={onExposure} />);
      deliverArtifact();
      if (lock === 'style') document.body.style.overflow = 'hidden';
      else document.body.setAttribute('data-web-modal-scroll-lock', '');

      passTheDelay();
      expect(card()).toBeNull();
      expect(onExposure).not.toHaveBeenCalled();

      await act(async () => {
        if (lock === 'style') document.body.style.overflow = '';
        else document.body.removeAttribute('data-web-modal-scroll-lock');
      });
      expect(card()).not.toBeNull();
      expect(onExposure).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps observing attribute changes until both modal locks are released', async () => {
    document.body.style.overflow = 'hidden';
    render(<ExperienceSurvey metricsConsent />);
    deliverArtifact();
    passTheDelay();

    await act(async () => {
      document.body.setAttribute('data-web-modal-scroll-lock', '');
      document.body.style.overflow = '';
    });
    expect(card()).toBeNull();

    await act(async () => {
      document.body.setAttribute('data-web-modal-scroll-lock', 'active');
    });
    expect(card()).toBeNull();

    await act(async () => {
      document.body.removeAttribute('data-web-modal-scroll-lock');
    });
    expect(card()).not.toBeNull();
  });

  it('shows the card once a delivery survives the delay', () => {
    render(<ExperienceSurvey metricsConsent />);

    deliverArtifact();
    // Still nothing: the delay exists so the user gets a beat with the
    // artifact before the card asks for attention.
    expect(card()).toBeNull();

    passTheDelay();
    expect(card()).not.toBeNull();
  });

  it('still shows the card when the user types straight through the delay', () => {
    render(<ExperienceSurvey metricsConsent />);

    deliverArtifact();
    act(() => {
      document.body.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    });
    passTheDelay();

    // An earlier revision called the arm off here. It was removed: a survey
    // asked once per user cannot afford to skip the one moment it has, and the
    // users who type immediately after a delivery are the engaged ones.
    expect(card()).not.toBeNull();
  });

  it('never shows a second time, even if the user just ignored it', () => {
    render(<ExperienceSurvey metricsConsent />);
    deliverArtifact();
    passTheDelay();
    expect(card()).not.toBeNull();

    // Walking away without answering or closing is how most people decline a
    // prompt. It still has to spend the one ask, or the survey becomes a
    // recurring interruption for exactly the users least interested in it.
    cleanup();
    render(<ExperienceSurvey metricsConsent />);
    deliverArtifact();
    passTheDelay();

    expect(card()).toBeNull();
  });

  it('never arms without metrics consent', () => {
    render(<ExperienceSurvey metricsConsent={false} />);

    deliverArtifact();
    passTheDelay();

    expect(card()).toBeNull();
  });
});
