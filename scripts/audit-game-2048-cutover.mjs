import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/game-2048-cutover-preflight.md',
  'backend/internal/game2048/types.go',
  'backend/internal/game2048/engine.go',
  'backend/internal/game2048/service.go',
  'backend/internal/game2048/engine_test.go',
  'backend/internal/httpserver/game2048_handlers.go',
  'backend/internal/httpserver/game2048_handlers_integration_test.go',
  'scripts/smoke-game-2048-go-api.mjs',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

function read(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

const engine = read('backend/internal/game2048/engine.go');
const service = read('backend/internal/game2048/service.go');
const handlers = read('backend/internal/httpserver/game2048_handlers.go');
const server = read('backend/internal/httpserver/server.go');
const tests = read('backend/internal/game2048/engine_test.go');
const integrationTests = read('backend/internal/httpserver/game2048_handlers_integration_test.go');
const smoke = read('scripts/smoke-game-2048-go-api.mjs');
const doc = read('docs/game-2048-cutover-preflight.md');
const gateway = read('gateway/Caddyfile');

const requiredEngineSnippets = [
  'func CreateInitialGrid',
  'func SpawnTile',
  'func MoveGrid',
  'func Simulate',
  'func HighestTile',
  'func IsGameOver',
  'func CalculatePointReward',
  'hashToUnit',
  ':2048:spawn:',
];

const requiredTestSnippets = [
  'TestMoveGridMergesLeft',
  'TestCreateInitialGridMatchesTypeScriptSeed',
  'TestSimulateMatchesTypeScriptSeed',
  'TestCalculatePointReward',
  'fixed-seed',
];

const requiredServiceSnippets = [
  'func (service *Service) Start',
  'func (service *Service) Status',
  'func (service *Service) Checkpoint',
  'func (service *Service) Submit',
  'func (service *Service) Cancel',
  'func simulateSegment',
  'func addGamePointsWithLimit',
  'func findSettledRecord',
  'game_records',
  'point_ledger',
];

const requiredHandlerSnippets = [
  'func (handlers game2048Handlers) status',
  'func (handlers game2048Handlers) start',
  'func (handlers game2048Handlers) checkpoint',
  'func (handlers game2048Handlers) submit',
  'func (handlers game2048Handlers) cancel',
];

const requiredRouteSnippets = [
  'api.Route("/games/2048"',
  'game2048Router.Get("/status", game2048Handlers.status)',
  'game2048Router.Post("/start", game2048Handlers.start)',
  'game2048Router.Post("/checkpoint", game2048Handlers.checkpoint)',
  'game2048Router.Post("/submit", game2048Handlers.submit)',
  'game2048Router.Post("/cancel", game2048Handlers.cancel)',
];

const requiredIntegrationTestSnippets = [
  'TestGame2048HTTPCheckpointSubmitAndReplayDuplicateSettlement',
  '/api/games/2048/start',
  '/api/games/2048/checkpoint',
  '/api/games/2048/submit',
  'duplicate submit should replay settled record',
];

const requiredSmokeSnippets = [
  'assertGateway2048RulesExact',
  '/api/games/2048/status',
  '/api/games/2048/start',
  '/api/games/2048/checkpoint',
  '/api/games/2048/submit',
  '/api/games/2048/cancel',
  'game_2048',
  'duplicate submit did not replay settled record',
  '2048 cleanup verification',
];

const requiredDocSnippets = [
  'Docker 直连 Go API 冒烟',
  'Go 内部 HTTP 路由',
  '/api/games/2048/status',
  '/api/games/2048/*',
  'go test ./internal/game2048',
  'go test -tags integration ./internal/httpserver -run Game2048 -count=1',
  'node scripts/smoke-game-2048-go-api.mjs',
];

const missingEngineSnippets = requiredEngineSnippets.filter((snippet) => !engine.includes(snippet));
const missingTestSnippets = requiredTestSnippets.filter((snippet) => !tests.includes(snippet));
const missingServiceSnippets = requiredServiceSnippets.filter((snippet) => !service.includes(snippet));
const missingHandlerSnippets = requiredHandlerSnippets.filter((snippet) => !handlers.includes(snippet));
const missingRouteSnippets = requiredRouteSnippets.filter((snippet) => !server.includes(snippet));
const missingIntegrationTestSnippets = requiredIntegrationTestSnippets.filter((snippet) => !integrationTests.includes(snippet));
const missingSmokeSnippets = requiredSmokeSnippets.filter((snippet) => !smoke.includes(snippet));
const missingDocSnippets = requiredDocSnippets.filter((snippet) => !doc.includes(snippet));
const gateway2048Routes = gateway
  .split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line }))
  .map((entry) => ({ ...entry, text: entry.text.trim() }))
  .filter((entry) => entry.text !== '' && !entry.text.startsWith('#'))
  .filter((entry) => entry.text.includes('/api/games/2048'));
const expectedGateway2048Routes = [
  'handle /api/games/2048/status {',
  'handle /api/games/2048/start {',
  'handle /api/games/2048/checkpoint {',
  'handle /api/games/2048/submit {',
  'handle /api/games/2048/cancel {',
];
const missingGateway2048Routes = expectedGateway2048Routes
  .filter((line) => !gateway2048Routes.some((entry) => entry.text === line));
const unexpectedGateway2048Routes = gateway2048Routes
  .filter((entry) => !expectedGateway2048Routes.includes(entry.text));

if (
  missingFiles.length > 0 ||
  missingEngineSnippets.length > 0 ||
  missingTestSnippets.length > 0 ||
  missingServiceSnippets.length > 0 ||
  missingHandlerSnippets.length > 0 ||
  missingRouteSnippets.length > 0 ||
  missingIntegrationTestSnippets.length > 0 ||
  missingSmokeSnippets.length > 0 ||
  missingDocSnippets.length > 0 ||
  missingGateway2048Routes.length > 0 ||
  unexpectedGateway2048Routes.length > 0
) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'game-2048-cutover-audit',
    missingFiles,
    missingEngineSnippets,
    missingTestSnippets,
    missingServiceSnippets,
    missingHandlerSnippets,
    missingRouteSnippets,
    missingIntegrationTestSnippets,
    missingSmokeSnippets,
    missingDocSnippets,
    missingGateway2048Routes,
    unexpectedGateway2048Routes,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'game-2048-cutover-audit',
  status: 'docker-smoke-ready',
  checkedFiles: requiredFiles.length,
  checkedEngineSnippets: requiredEngineSnippets.length,
  checkedTestSnippets: requiredTestSnippets.length,
  checkedServiceSnippets: requiredServiceSnippets.length,
  checkedHandlerSnippets: requiredHandlerSnippets.length,
  checkedRouteSnippets: requiredRouteSnippets.length,
  checkedIntegrationTestSnippets: requiredIntegrationTestSnippets.length,
  checkedSmokeSnippets: requiredSmokeSnippets.length,
  gateway2048Routes: expectedGateway2048Routes,
}, null, 2));
