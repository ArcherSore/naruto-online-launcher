'use strict';

describe('main/flags DPI boundary', () => {
  test('does not override OS DPI scaling process-wide', () => {
    jest.resetModules();
    const electron = require('electron');
    electron.app.commandLine.appendSwitch.mockClear();
    const flags = require('../flags');

    flags.applyAll({});

    expect(electron.app.commandLine.appendSwitch).not.toHaveBeenCalledWith(
      'force-device-scale-factor',
      expect.anything()
    );
    expect(flags.getAppliedSnapshot()).toEqual(expect.objectContaining({ applied: true }));
    expect(flags.getAppliedSnapshot()).not.toHaveProperty('deviceScaleFactor');
  });
});
