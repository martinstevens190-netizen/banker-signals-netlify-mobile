import { localNow } from './utils.js';

function bankerItems() {
  return [
    'Lanús vs Banfield — Under 4.5 cards banker',
    'Platense vs Gimnasia Mendoza — Under 2.5 goals',
    'Pumas UNAM vs Mazatlán — Pumas win',
  ];
}

export async function buildScanOutput({ promptName, promptBody, settings = {} }) {
  const local = localNow();
  const bands = settings.bands || {
    shots_total: { upper: '28+', lower: '19+', recommended: '22+' },
    shots_on_target: { upper: '11+', lower: '7+', recommended: '8+' },
  };
  const banker = bankerItems();
  return {
    title: '✅ Banker games ready',
    createdAt: local.toISO(),
    source: 'scheduled-sample',
    promptName,
    promptBody,
    banker,
    bands,
    notificationTitle: '✅ Banker games ready',
    notificationBody: `${promptName}: ${banker[0]} | Shots ${bands.shots_total?.recommended || ''}`,
  };
}
