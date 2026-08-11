'use strict';

function nativeHandle(value) {
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(BigInt(value), 0);
  return handle;
}

function target() {
  return {
    contentSize: { width: 1920, height: 1080 },
    window: {
      getNativeWindowHandle: jest.fn(function () {
        return nativeHandle(1248288);
      }),
      getContentSize: jest.fn(function () {
        return [960, 540];
      }),
      getSize: jest.fn(function () {
        return [963, 566];
      })
    }
  };
}

describe('Vision Author desktop capture provider', () => {
  test('maps the native game HWND and crops the exact canonical client pixels', async () => {
    const cropped = {
      isEmpty: jest.fn(function () {
        return false;
      }),
      getSize: jest.fn(function () {
        return { width: 1920, height: 1080 };
      })
    };
    const thumbnail = {
      getSize: jest.fn(function () {
        return { width: 1926, height: 1131 };
      }),
      crop: jest.fn(function () {
        return cropped;
      })
    };
    const desktopCapturer = {
      getSources: jest.fn(async function () {
        return [
          { id: 'window:99:0', thumbnail: {} },
          { id: 'window:1248288:1', thumbnail: thumbnail }
        ];
      })
    };
    const { createDesktopCaptureProvider } = require('../bridge/desktop-capture');
    const provider = createDesktopCaptureProvider({ desktopCapturer: desktopCapturer });

    await expect(provider(target())).resolves.toBe(cropped);
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['window'],
      thumbnailSize: { width: 1926, height: 1132 },
      fetchWindowIcons: false
    });
    expect(thumbnail.crop).toHaveBeenCalledWith({
      x: 3,
      y: 48,
      width: 1920,
      height: 1080
    });
  });

  test('fails closed when the exact HWND source or canonical crop is unavailable', async () => {
    const { createDesktopCaptureProvider } = require('../bridge/desktop-capture');
    const missing = createDesktopCaptureProvider({
      desktopCapturer: {
        getSources: jest.fn(async function () {
          return [];
        })
      }
    });
    await expect(missing(target())).rejects.toMatchObject({ code: 'capture-failed' });

    const forgedHandle = createDesktopCaptureProvider({
      desktopCapturer: {
        getSources: jest.fn(async function () {
          return [{ id: 'window:12482880:1', thumbnail: {} }];
        })
      }
    });
    await expect(forgedHandle(target())).rejects.toMatchObject({ code: 'capture-failed' });

    const invalidCrop = createDesktopCaptureProvider({
      desktopCapturer: {
        getSources: jest.fn(async function () {
          return [
            {
              id: 'window:1248288:1',
              thumbnail: {
                getSize: function () {
                  return { width: 1919, height: 1080 };
                },
                crop: jest.fn()
              }
            }
          ];
        })
      }
    });
    await expect(invalidCrop(target())).rejects.toMatchObject({ code: 'capture-failed' });
  });
});
