import type { Choice } from './contracts';
export const beamMaps: Choice[] = [
  ['gridmap_v2', 'Gridmap V2'],
  ['johnson_valley', 'Johnson Valley'],
  ['automation_test_track', 'Automation Test Track'],
  ['east_coast_usa', 'East Coast USA'],
  ['hirochi_raceway', 'Hirochi Raceway'],
  ['italy', 'Italy'],
  ['jungle_rock_island', 'Jungle Rock Island'],
  ['industrial', 'Industrial Site'],
  ['small_island', 'Small Island'],
  ['smallgrid', 'Small Grid'],
  ['utah', 'Utah'],
  ['west_coast_usa', 'West Coast USA'],
  ['driver_training', 'Driver Training'],
  ['derby', 'Derby Arenas'],
].map(([id, label]) => ({ value: `/levels/${id}/info.json`, label }));
export const accTracks: Choice[] = [
  'monza',
  'zolder',
  'brands_hatch',
  'silverstone',
  'paul_ricard',
  'misano',
  'spa',
  'nurburgring',
  'barcelona',
  'hungaroring',
  'zandvoort',
  'kyalami',
  'mount_panorama',
  'suzuka',
  'laguna_seca',
  'imola',
  'oulton_park',
  'donington',
  'snetterton',
  'cota',
  'indianapolis',
  'watkins_glen',
  'valencia',
  'nurburgring_24h',
].map((id) => ({
  value: id,
  label: id
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' '),
}));
