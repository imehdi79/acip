import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from '@/app/app';
import { hydrateManualRates } from '@/data/rates';
import { hydrateLayerDefaults } from '@/data/layer-defaults';

// Before the first render, not in an effect: the estimator prices against these
// the moment it opens, and a rate that arrived one render late would show a
// layer as "no rate yet" that this device has already been told the price of.
hydrateManualRates(window.localStorage);
hydrateLayerDefaults(window.localStorage);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
