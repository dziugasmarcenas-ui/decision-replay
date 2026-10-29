// Runtime publication is an allowlist. Documentation, tests and Git metadata cannot enter the site.
export const PUBLIC_FILES = Object.freeze([
  'index.html', 'styles.css', 'favicon.svg',
  'src/app.js', 'src/engine.js',
  'data/coating_export.csv', 'data/spectral_export.csv', 'data/reference.json'
]);
