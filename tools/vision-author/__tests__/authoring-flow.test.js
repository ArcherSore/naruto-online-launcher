'use strict';

const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../../src/automation/registry');
const helpers = require('./helpers');

describe('frozen frame to preview to save identity chain', () => {
  let root;
  afterEach(function () { helpers.cleanup(root); });

  async function setup(contractValid) {
    root = helpers.createTempRoot('vision-author-flow-');
    const fixture = helpers.createScriptPackage(root, { directoryName: 'real-package', id: 'flow-script' });
    const registry = createRegistry({ rootDir: fixture.scriptsRoot });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    const { createTemplateWriter } = require('../bridge/template-writer');
    const writer = createTemplateWriter({ catalog: catalog, repoRoot: root });
    const nativeImage = helpers.createNativeImageFixture();
    const bitmap = helpers.makeBitmap(6, 5);
    const png = helpers.visionFixtures.encodePng(6, 5, bitmap);
    let available = true;
    const backend = {
      getWindowState: jest.fn(function () {
        return { available: available, contentSize: available ? { width: 1920, height: 1080 } : null };
      }),
      capture: jest.fn(async function () {
        return { png: png, imageSize: { width: 6, height: 5 }, contentSize: { width: 6, height: 5 }, capturedAt: 1 };
      })
    };
    const { createBridgeSession } = require('../bridge/session');
    const session = createBridgeSession({
      sessionId: 'session-a',
      profileStore: {
        getAll: function () { return [{ id: 'p_aaaaaaaa', name: 'A' }]; },
        get: function () { return { id: 'p_aaaaaaaa', name: 'A' }; }
      },
      backend: backend,
      catalog: catalog,
      writer: writer,
      nativeImage: nativeImage,
      frameFactory: function (value, profile, epoch) {
        const contract = { valid: contractValid !== false, failures: contractValid === false ? ['content-size-not-canonical'] : [] };
        return {
          frameId: 'frame-a', profile: profile, selectionEpoch: epoch, png: value.png,
          imageSize: value.imageSize, contentSize: value.contentSize, capturedAt: value.capturedAt,
          contract: contract,
          publicFrame: {
            frameId: 'frame-a', profile: profile, selectionEpoch: epoch,
            pngDataUrl: 'data:image/png;base64,' + value.png.toString('base64'),
            imageSize: value.imageSize, contentSize: value.contentSize, capturedAt: value.capturedAt,
            contract: contract
          }
        };
      }
    });
    session.listProfiles();
    await session.capture({ profileId: 'p_aaaaaaaa', selectionEpoch: 1 });
    const identity = { frameId: 'frame-a', profileId: 'p_aaaaaaaa', selectionEpoch: 1 };
    session.markDisplayed(identity);
    session.freezeFrame(identity);
    const preview = session.createPreview({
      frozenFrameId: 'frame-a',
      templateRect: { x: 2, y: 1, width: 3, height: 2 }
    }).preview;
    return { session: session, backend: backend, fixture: fixture, preview: preview, setAvailable: value => { available = value; } };
  }

  test('saves the current preview exact bytes with zero recapture/resize/resample', async () => {
    const context = await setup(true);
    const request = {
      frozenFrameId: 'frame-a',
      previewId: context.preview.previewId,
      scriptId: 'flow-script',
      templateId: 'exact-crop'
    };
    expect(context.session.savePreflight(request).status).toBe('ready');
    const saved = context.session.saveCommit(request);
    const filename = path.join(context.fixture.packageRoot, 'assets', 'vision', 'exact-crop.png');
    expect(saved).toEqual(expect.objectContaining({ saved: true, imageSize: { width: 3, height: 2 } }));
    expect(fs.readFileSync(filename)).toEqual(context.session.getPreview(context.preview.previewId).png);
    expect(context.backend.capture).toHaveBeenCalledTimes(1);
  });

  test('Resume/release, unavailable source and invalid contract all produce zero writes', async () => {
    const released = await setup(true);
    const request = { frozenFrameId: 'frame-a', previewId: released.preview.previewId, scriptId: 'flow-script', templateId: 'blocked' };
    released.session.releaseFrame({ frameId: 'frame-a' });
    expect(function () { released.session.savePreflight(request); }).toThrow(expect.objectContaining({ code: 'frame-stale' }));

    helpers.cleanup(root);
    const unavailable = await setup(true);
    unavailable.setAvailable(false);
    const unavailableRequest = { frozenFrameId: 'frame-a', previewId: unavailable.preview.previewId, scriptId: 'flow-script', templateId: 'blocked' };
    expect(function () { unavailable.session.savePreflight(unavailableRequest); }).toThrow(expect.objectContaining({ code: 'profile-unavailable' }));

    helpers.cleanup(root);
    const invalid = await setup(false);
    const invalidRequest = { frozenFrameId: 'frame-a', previewId: invalid.preview.previewId, scriptId: 'flow-script', templateId: 'blocked' };
    expect(function () { invalid.session.savePreflight(invalidRequest); }).toThrow(expect.objectContaining({ code: 'frame-contract-invalid' }));
    expect(fs.existsSync(path.join(invalid.fixture.packageRoot, 'assets', 'vision', 'blocked.png'))).toBe(false);
  });
});

