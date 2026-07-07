const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// pnpm hoists workspace packages as symlinks one level up — Metro needs to
// watch the whole workspace and resolve node_modules from both roots.
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
]
// pnpm keeps each package's own deps nested in its .pnpm store entry, reached
// by walking up from the requiring file — disabling hierarchical lookup (the
// hoisted-node_modules trick for npm/yarn monorepos) breaks that resolution.
config.resolver.unstable_enableSymlinks = true

module.exports = config
