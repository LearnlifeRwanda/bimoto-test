// R3-DRIVER-SCREENER — in-app driver eligibility screener. Renders the
// 8 questions from the shared catalogue (no duplication), submits to
// POST /api/drivers/me/screener, surfaces the eligibility result
// inline. On eligible → /driver/verification. On needs_follow_up →
// callout + continue. On ineligible → callout (no auto-redirect; the
// driver chooses what to do).

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  SCREENER_QUESTIONS,
  evaluateEligibility,
  type ScreenerQuestion,
  type ScreenerAnswers,
  type ScreenerEligibilityResult,
} from '@bimoto/shared';
import { Button } from '../../components/ui/Button';
import { RadioGroup } from '../../components/ui/RadioGroup';
import { HelpDisclosure } from '../../components/ui/HelpDisclosure';
import { apiFetch } from '../../lib/api';

type AnswerValue = boolean | string | number | null;
type AnswersDraft = Record<string, AnswerValue>;

function getInitialAnswers(): AnswersDraft {
  const draft: AnswersDraft = {};
  for (const q of SCREENER_QUESTIONS) {
    draft[q.id] = null;
    if (q.kind === 'boolean-with-optional-int') {
      draft[`${q.id}_months`] = null;
    }
    if (q.kind === 'optional-fk') {
      draft[`${q.id}_name`] = null;
    }
  }
  return draft;
}

function isAnswered(q: ScreenerQuestion, draft: AnswersDraft): boolean {
  if (!q.required) return true;
  const v = draft[q.id];
  if (v === null || v === undefined) return false;
  if (q.kind === 'integer' && typeof v !== 'number') return false;
  return true;
}

function buildSubmission(draft: AnswersDraft): ScreenerAnswers {
  return {
    is18OrOlder: draft['is_18_or_older'] as boolean,
    holdsDriversLicence: draft[
      'holds_drivers_licence'
    ] as ScreenerAnswers['holdsDriversLicence'],
    hasRuraAuthorisation: draft[
      'has_rura_authorisation'
    ] as ScreenerAnswers['hasRuraAuthorisation'],
    primaryVehicleType: draft[
      'primary_vehicle_type'
    ] as ScreenerAnswers['primaryVehicleType'],
    cooperativeId: (draft['cooperative_affiliation'] as string | null) ?? null,
    cooperativeNameProvided:
      (draft['cooperative_affiliation_name'] as string | null) ?? null,
    primaryCityBand: draft[
      'primary_city_band'
    ] as ScreenerAnswers['primaryCityBand'],
    weeklyAvailabilityHours: draft[
      'weekly_availability_hours'
    ] as number,
    priorPlatformExperience: draft[
      'prior_platform_experience'
    ] as boolean,
    priorPlatformMonths:
      (draft['prior_platform_experience_months'] as number | null) ?? null,
  };
}

interface SubmissionResponse {
  screenerId: string;
  eligibilityResult: ScreenerEligibilityResult['result'];
  ineligibilityReason: ScreenerEligibilityResult['reason'] | null;
}

export const DriverScreenerPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<AnswersDraft>(getInitialAnswers);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResponse | null>(null);

  const allRequiredAnswered = useMemo(
    () => SCREENER_QUESTIONS.every((q) => isAnswered(q, draft)),
    [draft],
  );
  const answeredCount = useMemo(
    () =>
      SCREENER_QUESTIONS.filter((q) => {
        const v = draft[q.id];
        return v !== null && v !== undefined;
      }).length,
    [draft],
  );

  function setAnswer(id: string, v: AnswerValue) {
    setDraft((d) => ({ ...d, [id]: v }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submission = buildSubmission(draft);
      const res = await apiFetch(`/api/drivers/me/screener`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(submission),
      });
      if (!res.ok) {
        setSubmitError(t('screener.errors.submitFailed'));
        return;
      }
      const data = (await res.json()) as SubmissionResponse;
      setResult(data);
      if (data.eligibilityResult === 'eligible') {
        navigate('/driver/verification', { replace: true });
      }
    } catch {
      setSubmitError(t('screener.errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (result && result.eligibilityResult !== 'eligible') {
    return <ResultCallout result={result} onContinue={() => navigate('/driver/verification', { replace: true })} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="px-6 pt-8 pb-4 max-w-md w-full mx-auto">
        <h1 className="text-2xl font-bold text-[#1B4F72]">
          {t('screener.title')}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('screener.subtitle')}
        </p>
        <p className="text-xs text-gray-500 mt-3" aria-live="polite">
          {t('screener.progress', {
            answered: answeredCount,
            total: SCREENER_QUESTIONS.length,
            minutes: Math.max(
              1,
              Math.ceil(((SCREENER_QUESTIONS.length - answeredCount) * 15) / 60),
            ),
          })}
        </p>
      </header>

      <main className="flex-1 px-6 pb-24 max-w-md w-full mx-auto space-y-6">
        {SCREENER_QUESTIONS.map((q) => (
          <QuestionRenderer
            key={q.id}
            question={q}
            draft={draft}
            setAnswer={setAnswer}
          />
        ))}
        {submitError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800"
          >
            {submitError}
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 px-6 pb-6 pt-3 bg-white border-t border-gray-200">
        <div className="max-w-md w-full mx-auto">
          <Button
            fullWidth
            size="lg"
            variant="primary"
            disabled={!allRequiredAnswered || submitting}
            loading={submitting}
            onClick={handleSubmit}
          >
            {t('screener.continue')}
          </Button>
        </div>
      </footer>
    </div>
  );
};

interface QuestionRendererProps {
  question: ScreenerQuestion;
  draft: AnswersDraft;
  setAnswer: (id: string, v: AnswerValue) => void;
}

const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  draft,
  setAnswer,
}) => {
  const { t } = useTranslation();
  const prompt = t(question.i18nKey);
  const currentValue = draft[question.id];

  let control: React.ReactNode = null;

  if (question.kind === 'boolean') {
    control = (
      <RadioGroup
        name={question.id}
        value={currentValue === null ? null : String(currentValue)}
        onChange={(v) => setAnswer(question.id, v === 'true')}
        options={[
          { value: 'true', label: t('screener.boolean.yes') },
          { value: 'false', label: t('screener.boolean.no') },
        ]}
        ariaLabel={prompt}
      />
    );
  } else if (question.kind === 'enum') {
    const options = question.options.map((opt) => ({
      value: opt,
      label: t(`${question.i18nOptionKeyPrefix}.${opt}`),
      description: question.optionDescriptionKeyPrefix
        ? t(`${question.optionDescriptionKeyPrefix}.${opt}_description`, {
            defaultValue: '',
          })
        : undefined,
    }));
    control = (
      <RadioGroup
        name={question.id}
        value={currentValue as string | null}
        onChange={(v) => setAnswer(question.id, v)}
        options={options}
        ariaLabel={prompt}
      />
    );
  } else if (question.kind === 'integer') {
    control = (
      <input
        type="number"
        inputMode="numeric"
        min={question.min}
        max={question.max}
        value={currentValue == null ? '' : String(currentValue)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            setAnswer(question.id, null);
            return;
          }
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          setAnswer(question.id, n);
        }}
        className="w-full min-h-[44px] px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72]"
        aria-label={prompt}
      />
    );
  } else if (question.kind === 'optional-fk') {
    const nameKey = `${question.id}_name`;
    control = (
      <input
        type="text"
        value={(draft[nameKey] as string | null) ?? ''}
        onChange={(e) =>
          setAnswer(nameKey, e.target.value === '' ? null : e.target.value)
        }
        placeholder={t(question.freeTextI18nKey)}
        className="w-full min-h-[44px] px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72]"
        aria-label={prompt}
      />
    );
  } else if (question.kind === 'boolean-with-optional-int') {
    const monthsKey = `${question.id}_months`;
    const monthsValue = draft[monthsKey];
    control = (
      <>
        <RadioGroup
          name={question.id}
          value={currentValue === null ? null : String(currentValue)}
          onChange={(v) => {
            setAnswer(question.id, v === 'true');
            if (v === 'false') setAnswer(monthsKey, null);
          }}
          options={[
            { value: 'true', label: t('screener.boolean.yes') },
            { value: 'false', label: t('screener.boolean.no') },
          ]}
          ariaLabel={prompt}
        />
        {currentValue === true && (
          <input
            type="number"
            inputMode="numeric"
            min={question.min}
            max={question.max}
            value={monthsValue == null ? '' : String(monthsValue)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                setAnswer(monthsKey, null);
                return;
              }
              const n = Number(raw);
              if (Number.isNaN(n)) return;
              setAnswer(monthsKey, n);
            }}
            placeholder={t(question.optionalIntI18nKey)}
            className="w-full min-h-[44px] px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4F72] mt-2"
            aria-label={t(question.optionalIntI18nKey)}
          />
        )}
      </>
    );
  } else {
    return null;
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-medium text-gray-900">{prompt}</h2>
      {question.helpKey && (
        <HelpDisclosure
          id={`help-${question.id}`}
          triggerLabel={t('screener.help.toggle')}
        >
          {t(question.helpKey)}
        </HelpDisclosure>
      )}
      {control}
    </section>
  );
};

const ResultCallout: React.FC<{
  result: SubmissionResponse;
  onContinue: () => void;
}> = ({ result, onContinue }) => {
  const { t } = useTranslation();
  const isFollowUp = result.eligibilityResult === 'needs_follow_up';
  const reasonKey = result.ineligibilityReason ?? 'under_18';

  const titleKey = isFollowUp
    ? `screener.results.needs_follow_up.${reasonKey}.title`
    : `screener.results.ineligible.${reasonKey}.title`;
  const bodyKey = isFollowUp
    ? `screener.results.needs_follow_up.${reasonKey}.body`
    : `screener.results.ineligible.${reasonKey}.body`;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <main className="flex-1 px-6 pt-12 pb-24 max-w-md w-full mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-[#1B4F72]">{t(titleKey)}</h1>
        <div
          className={`p-4 rounded-lg ${
            isFollowUp
              ? 'bg-yellow-50 border border-yellow-200'
              : 'bg-orange-50 border border-orange-200'
          }`}
        >
          <p className="text-sm text-gray-800 leading-relaxed">{t(bodyKey)}</p>
        </div>
      </main>
      <footer className="fixed bottom-0 left-0 right-0 px-6 pb-6 pt-3 bg-white border-t border-gray-200">
        <div className="max-w-md w-full mx-auto">
          {isFollowUp ? (
            <Button
              fullWidth
              size="lg"
              variant="primary"
              onClick={onContinue}
            >
              {t('screener.actions.continueAnyway')}
            </Button>
          ) : (
            <p className="text-xs text-gray-600 text-center">
              {t('screener.results.ineligibleFooter')}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
};

export default DriverScreenerPage;
