module.exports = {
  stories: ['../src/**/*.stories.mdx', '../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-links', '@storybook/addon-essentials'],

  webpackFinal: async (config) => {
    config.module.rules.push({
      test: /\.glb$/,
      use: ['file-loader']
    });

    return config;
  }
};
