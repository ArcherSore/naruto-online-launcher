'use strict';

const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../../src/automation/registry');
const helpers = require('./helpers');

describe('Vision Author multi-Profile isolation', () => {
  let root;
  afterEach(function () { helpers.cleanup(root); });

  test('keeps 50 frame→metadata→preview→save chains bound to their source Profile', async () => {
    root = helpers.createTempRoot('vision-author-profiles-');
    const fixture = helpers.createScriptPackage(root, { id: 'isolation-script' });
    const registry = createRegistry({ rootDir: fixture.scriptsRoot });
    registry.scan();
    const { createAuthorCatalog } = require('../bridge/catalog');
    const catalog = createAuthorCatalog({ registry: registry, repoRoot: root });
    const { createTemplateWriter } = require('../bridge/template-writer');
    const writer = createTemplateWriter({ catalog: catalog, repoRoot: root });
    const nativeImage = helpers.createNativeImageFixture();
    const profiles = [
      { id: 'p_aaaaaaaa', name: 'A' },
      { id: 'p_bbbbbbbb', name: 'B' }
    ];
    const colors = {
      p_aaaaaaaa: [200, 10, 20, 255],
      p_bbbbbbbb: [10, 20, 200, 255]
    };
    let sequence = 0;
    const backend = {
      getWindowState: jest.fn(function () {
        return { available: true, gameReady: false, contentSize: { width: 1920, height: 1080 } };
      }),
      capture: jest.fn(async function (profileId) {
        const bitmap = helpers.visionFixtures.rgba(4, 4, colors[profileId]);
        return {
          png: helpers.visionFixtures.encodePng(4, 4, bitmap),
          imageSize: { width: 4, height: 4 },
          contentSize: { width: 4, height: 4 },
          capturedAt: ++sequence
        };
      })
    };
    const { createBridgeSession } = require('../bridge/session');
    const session = createBridgeSession({
      sessionId: 'multi-session',
      profileStore: {
        getAll: function () { return profiles.slice(); },
        get: function (id) { return profiles.find(profile => profile.id === id) || null; }
      },
      backend: backend,
      catalog: catalog,
      writer: writer,
      nativeImage: nativeImage,
      frameFactory: function (value, profile, epoch) {
        const frameId = profile.id + '-frame-' + value.capturedAt;
        const contract = { valid: true, failures: [] };
        return {
          frameId: frameId, profile: { id: profile.id, name: profile.name }, selectionEpoch: epoch,
          png: value.png, imageSize: value.imageSize, contentSize: value.contentSize,
          capturedAt: value.capturedAt, contract: contract,
          publicFrame: {
            frameId: frameId, profile: { id: profile.id, name: profile.name }, selectionEpoch: epoch,
            pngDataUrl: 'data:image/png;base64,' + value.png.toString('base64'),
            imageSize: value.imageSize, contentSize: value.contentSize,
            capturedAt: value.capturedAt, contract: contract
          }
        };
      }
    });
    session.listProfiles();

    for (let index = 0; index < 50; index++) {
      const profile = profiles[index % profiles.length];
      const captured = await session.capture({ profileId: profile.id, selectionEpoch: index + 1 });
      expect(captured.frame.profile).toEqual(profile);
      const wrongProfile = profiles[(index + 1) % profiles.length];
      expect(function () {
        session.markDisplayed({
          frameId: captured.frame.frameId,
          profileId: wrongProfile.id,
          selectionEpoch: index + 1
        });
      }).toThrow(expect.objectContaining({ code: 'frame-stale' }));
      const identity = {
        frameId: captured.frame.frameId,
        profileId: profile.id,
        selectionEpoch: index + 1
      };
      session.markDisplayed(identity);
      session.freezeFrame(identity);
      const preview = session.createPreview({
        frozenFrameId: captured.frame.frameId,
        templateRect: { x: 1, y: 1, width: 1, height: 1 }
      }).preview;
      const save = {
        frozenFrameId: captured.frame.frameId,
        previewId: preview.previewId,
        scriptId: 'isolation-script',
        templateId: 'profile-crop-' + index
      };
      session.savePreflight(save);
      session.saveCommit(save);
      const saved = fs.readFileSync(path.join(fixture.packageRoot, 'assets', 'vision', save.templateId + '.png'));
      expect(Array.from(helpers.decodeFixturePng(saved).bitmap.slice(0, 4))).toEqual(colors[profile.id]);
      session.releaseFrame({ frameId: captured.frame.frameId });
    }

    expect(backend.capture).toHaveBeenCalledTimes(50);
    expect(backend.capture.mock.calls.every(call => call.length === 1 && /^p_[ab]{8}$/.test(call[0]))).toBe(true);
    expect(JSON.stringify(session.snapshot())).not.toMatch(/session|partition|cookie|url/i);
  });
});

