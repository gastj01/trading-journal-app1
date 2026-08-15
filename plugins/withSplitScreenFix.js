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

    if (!src.includes('import android.view.MotionEvent')) {
      src = src.replace(
        'import android.os.Build',
        'import android.os.Build\nimport android.view.MotionEvent\nimport android.widget.Toast'
      )
    }

    // Diagnostic: show raw touch coordinates via Toast so we know the actual values
    const override = `
  override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
    if (ev != null && ev.action == MotionEvent.ACTION_DOWN) {
      val loc = IntArray(2)
      window.decorView.getLocationOnScreen(loc)
      Toast.makeText(this,
        "ev.y=\${ev.y.toInt()} rawY=\${ev.rawY.toInt()} winY=\${loc[1]}",
        Toast.LENGTH_SHORT).show()
    }
    return super.dispatchTouchEvent(ev)
  }
`
    if (!src.includes('dispatchTouchEvent')) {
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
