import { useState } from 'react';
import { IconReportMoney, IconSparkles, IconX } from '@tabler/icons-react';
import { useRuntime } from '../runtime';
import { QuantitiesSection } from './panels';

/**
 * Mobile-only companion to the drafter bubble: the side panels are hidden on
 * phones, so the live takeoff + BOQ opens as a floating sheet instead. Same
 * per-commit recompute as the desktop panel — it updates while the agent draws.
 */
export function EstimateSheet() {
  const { ui } = useRuntime();
  const [open, setOpen] = useState(false);

  /** hand off to the agent: estimation mode, marks visible, chat on top */
  const askAgent = () => {
    setOpen(false);
    ui.agentMode.set('estimator');
    ui.showMarks.set(true);
    ui.agentChatOpen.set(true);
    if (ui.agentChat.get().length === 0) {
      ui.appendChat(
        'Estimation mode — the agent proposes build-ups and applies nothing until you confirm.',
        'progress',
      );
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="chat-bubble estimate-bubble"
        title="Estimate"
        onClick={() => setOpen(true)}
      >
        <IconReportMoney size={22} stroke={1.75} />
      </button>
    );
  }

  return (
    <div className="estimate-panel">
      <header className="chat-header">
        <IconReportMoney size={16} stroke={1.75} className="estimate-icon" />
        <span className="chat-title">Estimate</span>
        <button
          type="button"
          title="Estimate with the agent — it proposes, you confirm"
          onClick={askAgent}
        >
          <IconSparkles size={15} stroke={1.75} />
        </button>
        <button type="button" title="Close" onClick={() => setOpen(false)}>
          <IconX size={15} stroke={1.75} />
        </button>
      </header>
      <div className="estimate-body">
        <QuantitiesSection />
      </div>
    </div>
  );
}
