const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withSplitScreenFix(config) {
  return withAndroidManifest(config, (mod) => {
    const activities = mod.modResults.manifest.application[0].activity || []
    for (const activity of activities) {
      if (activity.$['android:name'] === '.MainActivity') {
        const current = activity.$['android:configChanges'] || ''
        activity.$['android:configChanges'] = current
          .split('|')
          .filter(c => c !== 'screenSize' && c !== 'screenLayout')
          .join('|')
      }
    }
    return mod
  })
}
