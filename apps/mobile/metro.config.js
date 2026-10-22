const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && !context.originModulePath.includes('node_modules')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {}
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
