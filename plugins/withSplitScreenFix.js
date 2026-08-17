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
        'import android.os.Bundle\nimport android.content.res.Configuration\nimport android.view.MotionEvent\nimport android.view.View\nimport android.view.ViewGroup\nimport android.widget.TextView\nimport android.view.Gravity\nimport android.graphics.Color'
      )
    }

    if (!src.includes('object DiagState')) {
      src = src.replace(
        'class MainActivity : ReactActivity() {',
        `object DiagState {
  var createCount = 0
  var configChangedCount = 0
  var focusChangeCount = 0
  var gestureLog = ""
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
      lp.gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
      lp.topMargin = (resources.displayMetrics.heightPixels * 0.32).toInt()
      tv.layoutParams = lp
    }
    diagView = tv
  }

  // Walks the real view hierarchy to find the leaf view that actually
  // resolves at the touch point, independent of what dispatchTouchEvent's
  // return value claims. consumed=true only proves *something* in the
  // hierarchy took it, not that the React root did - this answers whether
  // the touch even reaches a React view, or something else catches it first.
  private fun findHitView(view: View, rawX: Float, rawY: Float): View {
    if (view is ViewGroup) {
      for (i in view.childCount - 1 downTo 0) {
        val child = view.getChildAt(i)
        if (child.visibility != View.VISIBLE) continue
        val loc = IntArray(2)
        child.getLocationOnScreen(loc)
        if (rawX >= loc[0] && rawX < loc[0] + child.width && rawY >= loc[1] && rawY < loc[1] + child.height) {
          return findHitView(child, rawX, rawY)
        }
      }
    }
    return view
  }

  private fun describeHitView(view: View): String {
    val idPart = try {
      if (view.id != View.NO_ID) resources.getResourceEntryName(view.id) else "noid"
    } catch (e: Exception) {
      "noid"
    }
    return "%s#%s".format(view.javaClass.simpleName, idPart)
  }

  override fun dispatchTouchEvent(ev: MotionEvent?): Boolean {
    val action = ev?.actionMasked
    if (ev != null && (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL)) {
      ensureDiagOverlay()
      val hitDesc = if (action == MotionEvent.ACTION_DOWN) describeHitView(findHitView(window.decorView, ev.rawX, ev.rawY)) else ""
      val consumed = super.dispatchTouchEvent(ev)
      val actionName = when (action) {
        MotionEvent.ACTION_DOWN -> "DOWN"
        MotionEvent.ACTION_UP -> "UP"
        else -> "CANCEL"
      }
      val line = "%s x=%.0f y=%.0f rawX=%.0f dev=%d tool=%d focus=%b consumed=%b".format(
        actionName, ev.x, ev.y, ev.rawX, ev.deviceId, ev.getToolType(0), hasWindowFocus(), consumed
      )
      if (action == MotionEvent.ACTION_DOWN) {
        val loc = IntArray(2)
        window.decorView.getLocationOnScreen(loc)
        val content = window.findViewById<ViewGroup>(android.R.id.content)
        DiagState.gestureLog = "winXY=%d,%d decor %dx%d content %dx%d confCh=%d focusChanges=%d hit=%s\\n%s".format(
          loc[0], loc[1], window.decorView.width, window.decorView.height,
          content?.width ?: -1, content?.height ?: -1,
          DiagState.configChangedCount, DiagState.focusChangeCount, hitDesc, line
        )
      } else {
        DiagState.gestureLog = DiagState.gestureLog + "\\n" + line
      }
      diagView?.text = DiagState.gestureLog
      return consumed
    }
    return super.dispatchTouchEvent(ev)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    DiagState.configChangedCount++
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    DiagState.focusChangeCount++
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
