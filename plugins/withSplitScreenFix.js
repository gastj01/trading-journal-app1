const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins')

function withConfigChangesFix(config) {
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

function withTouchOffsetFix(config) {
  return withMainActivity(config, (mod) => {
    let src = mod.modResults.contents

    // Add import if not already there
    if (!src.includes('import android.view.MotionEvent')) {
      src = src.replace(
        'import android.os.Build',
        'import android.os.Build\nimport android.view.MotionEvent'
      )
    }

    // Add dispatchTouchEvent override before the last closing brace
    const override = `
  override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
    if (ev != null) {
      val loc = IntArray(2)
      window.decorView.getLocationOnScreen(loc)
      val windowY = loc[1]
      if (windowY > 0) {
        ev.offsetLocation(0f, -windowY.toFloat())
      }
    }
    return super.dispatchTouchEvent(ev)
  }
`
    if (!src.includes('dispatchTouchEvent')) {
      // Insert before the final closing brace of the class
      const lastBrace = src.lastIndexOf('}')
      src = src.slice(0, lastBrace) + override + src.slice(lastBrace)
    }

    mod.modResults.contents = src
    return mod
  })
}

module.exports = function withSplitScreenFix(config) {
  config = withConfigChangesFix(config)
  config = withTouchOffsetFix(config)
  return config
}
