import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from '@/app/app';
import { hydrateManualRates } from '@/data/rates';
import { hydrateLayerDefaults } from '@/data/layer-defaults';
import { startSync } from '@/data/sync';

// Before the first render, not in an effect: the estimator prices against these
// the moment it opens, and a rate that arrived one render late would show a
// layer as "no rate yet" that this device has already been told the price of.
hydrateManualRates(window.localStorage);
hydrateLayerDefaults(window.localStorage);

// Then catch up with editor-server: flush whatever this device still owes it,
// and take its copy as the truth. Deliberately NOT awaited — the editor opens
// on its cache and reconciles behind the first paint, because a plan list that
// waits on a network is a plan list that is blank on a train.
startSync(window.localStorage);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
