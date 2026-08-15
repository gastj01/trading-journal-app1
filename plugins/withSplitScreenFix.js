const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withSplitScreenFix(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults
    const app = manifest.manifest.application[0]
    const activities = app.activity || []

    for (const activity of activities) {
      if (activity.$['android:name'] === '.MainActivity') {
        const current = activity.$['android:configChanges'] || ''
        // Remove screenSize and screenLayout so Android recreates Activity on split screen
        const fixed = current
          .split('|')
          .filter(c => c !== 'screenSize' && c !== 'screenLayout')
          .join('|')
        activity.$['android:configChanges'] = fixed
      }
    }

    return mod
  })
}
