import { useState } from 'react';
import { IconReportMoney, IconX } from '@tabler/icons-react';
import { QuantitiesSection } from './panels';

/**
 * Mobile-only companion to the drafter bubble: the side panels are hidden on
 * phones, so the live takeoff + BOQ opens as a floating sheet instead. Same
 * per-commit recompute as the desktop panel — it updates while the agent draws.
 */
export function EstimateSheet() {
  const [open, setOpen] = useState(false);

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
