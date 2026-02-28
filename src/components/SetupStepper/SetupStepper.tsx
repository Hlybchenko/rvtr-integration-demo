import type { ReactNode } from 'react';
import styles from './SetupStepper.module.css';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StepConfig {
  /** Step label shown next to the circle */
  label: string;
  /** One-liner displayed when step is complete (e.g. resolved path) */
  summary?: string;
  /** Whether this step is fully configured */
  isComplete: boolean;
  /** Whether this step should be disabled (previous step not done) */
  isLocked: boolean;
  /** Form content rendered when this step is active */
  content: ReactNode;
}

interface SetupStepperProps {
  steps: StepConfig[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SetupStepper({ steps }: SetupStepperProps) {
  // Active step = first non-complete, non-locked step.
  // No useMemo — steps array is recreated every render (inline JSX content).
  const activeIdx = steps.findIndex((s) => !s.isComplete && !s.isLocked);
  const activeIndex = activeIdx === -1 ? steps.length : activeIdx;

  return (
    <div className={styles.stepper}>
      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isComplete = step.isComplete;
        const isLocked = step.isLocked;
        const showContent = isActive || (isComplete && !step.summary);

        // Circle state class
        const circleClass = [
          styles.circle,
          isComplete && styles.circleComplete,
          isActive && styles.circleActive,
          isLocked && styles.circleLocked,
        ]
          .filter(Boolean)
          .join(' ');

        // Connector class
        const connectorClass = [
          styles.connector,
          isComplete && styles.connectorComplete,
        ]
          .filter(Boolean)
          .join(' ');

        // Title class
        const titleClass = [
          styles.title,
          isLocked && styles.titleLocked,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={i} className={styles.step}>
            {/* Left rail */}
            <div className={styles.rail}>
              <div className={circleClass}>
                {isComplete ? '\u2713' : i + 1}
              </div>
              <div className={connectorClass} />
            </div>

            {/* Right body */}
            <div className={styles.body}>
              <div className={styles.header}>
                <span className={titleClass}>{step.label}</span>
                {isComplete && step.summary && (
                  <span className={styles.summary}>{step.summary}</span>
                )}
              </div>

              {showContent && !isLocked && (
                <div className={styles.content}>{step.content}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
