// Starting points offered on the first-launch setup screen.
// Everything a preset fills in (name, start date, checklist) can be edited
// before starting and later in Settings, so anyone can make the app their own.
// Opening the app with #<id> in the URL (e.g. index.html#sample) preselects that preset.
window.PRESETS = [
  {
    id: 'blank',
    label: '自分で作る',
    routines: [],
  },
  {
    id: 'sample',
    label: 'サンプル',
    routines: ['7時までに起きる', '30分運動する', '寝る前に1日を振り返る'],
  },
];
