// Local Netlify build plugin: after the functions are packaged, scan the finished bundle and the
// publish folder. A failure stops the deploy (netlify deploy --build never uploads a failed build).
import { checkBundle } from '../../scripts/bundle-check.js';

export const onPostBuild = ({ constants, utils }) => {
  const root = process.cwd();
  const result = checkBundle({ root, functionsDist: constants.FUNCTIONS_DIST, publishDir: constants.PUBLISH_DIR });
  if (result.problems.length) utils.build.failBuild('Bundle check failed:\n - ' + result.problems.join('\n - '));
  console.log(`Bundle check passed: ${result.scanned} deployed items scanned against ${result.compared} local values.`);
};
