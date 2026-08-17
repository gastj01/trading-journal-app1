const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins')

// Prevents Android from destroying/recreating MainActivity when entering or
// resizing split-screen / multi-window mode, or on Fold/unfold transitions.
// Without these flags in configChanges, Android tears down and rebuilds the
// whole Activity on every resize, which was observed as `creates` jumping
// from 1 (fullscreen) to 12 (after a single split-screen entry) in the
// on-screen touch diagnostic — a plausible cause of the split-screen touch bug.
const REQUIRED_CONFIG_CHANGES = ['screenSize', 'screenLayout', 'smallestScreenSize', 'density']

function withConfigChangesFix(config) {
  return withAndroidManifest(config, (mod) => {
    const activities = mod.modResults.manifest.application[0].activity || []
    for (const activity of activities) {
      if (activity.$['android:name'] === '.MainActivity') {
        const current = (activity.$['android:configChanges'] || '').split('|').filter(Boolean)
        for (const flag of REQUIRED_CONFIG_CHANGES) {
          if (!current.includes(flag)) current.push(flag)
        }
        activity.$['android:configChanges'] = current.join('|')
      }
    }
    return mod
  })
}

// Diagnostic only: shows native touch coordinates (y, rawY, decorView windowY,
// Activity recreate count) in an on-screen overlay so we can compare them
// against the JS-side numbers in the same screenshot, in one device test round.
// Does not modify touch events.
function withTouchDiagOverlay(config) {
  return withMainActivity(config, (mod) => {
    let src = mod.modResults.contents

    if (!src.includes('import android.view.MotionEvent')) {
      src = src.replace(
        'import android.os.Bundle',
        'import android.os.Bundle\nimport android.view.MotionEvent\nimport android.view.ViewGroup\nimport android.widget.TextView\nimport android.view.Gravity\nimport android.graphics.Color'
      )
    }

    if (!src.includes('object DiagState')) {
      src = src.replace(
        'class MainActivity : ReactActivity() {',
        `object DiagState {
  var createCount = 0
}

class MainActivity : ReactActivity() {
  private var diagView: TextView? = null

  private fun ensureDiagOverlay() {
    if (diagView != null) return
    val tv = TextView(this)
    tv.setTextColor(Color.GREEN)
    tv.textSize = 9f
    tv.setBackgroundColor(Color.parseColor("#cc000000"))
    tv.setPadding(8, 8, 8, 8)
    tv.text = "diag: waiting for touch"
    val params = ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    (window.decorView as ViewGroup).addView(tv, params)
    val lp = tv.layoutParams
    if (lp is android.widget.FrameLayout.LayoutParams) {
      lp.gravity = Gravity.TOP or Gravity.START
      tv.layoutParams = lp
    }
    diagView = tv
  }

  override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
    if (ev != null && ev.action == MotionEvent.ACTION_DOWN) {
      ensureDiagOverlay()
      val loc = IntArray(2)
      window.decorView.getLocationOnScreen(loc)
      diagView?.text = "native y=%.0f rawY=%.0f winY=%d creates=%d".format(ev.y, ev.rawY, loc[1], DiagState.createCount)
    }
    return super.dispatchTouchEvent(ev)
  }
`
      )
    }

    if (!src.includes('DiagState.createCount++')) {
      src = src.replace(
        'super.onCreate(null)',
        'super.onCreate(null)\n    DiagState.createCount++\n    android.os.Handler(mainLooper).postDelayed({ ensureDiagOverlay() }, 500)'
      )
    }

    mod.modResults.contents = src
    return mod
  })
}

module.exports = function withSplitScreenFix(config) {
  config = withConfigChangesFix(config)
  config = withTouchDiagOverlay(config)
  return config
}
