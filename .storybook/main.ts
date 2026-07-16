import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {}
  },
  viteFinal: async (config) => {
    config.assetsInclude = [
      ...(Array.isArray(config.assetsInclude)
        ? config.assetsInclude
        : config.assetsInclude
          ? [config.assetsInclude]
          : []),
      '**/*.glb'
    ];
    return config;
  }
};

export default config;
