package com.fitloot.bridge

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebResourceError
import android.webkit.WebChromeClient
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.fitloot.BuildConfig

object FitLootWebViewConfigurator {
    private const val TAG = "FitLootWebView"

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(
        webView: WebView,
        openExternalUrl: (Intent) -> Unit,
        onShowFileChooser: (ValueCallback<Array<Uri>>?, WebChromeClient.FileChooserParams?) -> Boolean,
        onPermissionRequest: (PermissionRequest) -> Unit,
        onGeolocationPermissionRequest: (String, GeolocationPermissions.Callback) -> Unit,
        onPageStarted: (String?) -> Unit,
        onPageFinished: (String?) -> Unit,
        onPageLoadFailed: (String?, String) -> Unit,
    ) {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                onPageStarted(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                onPageFinished(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return false
                val targetUrl = targetUri.toString()
                if (FitLootWebAppConfig.isTrustedUrl(targetUrl)) {
                    return false
                }

                openExternalUrl(Intent(Intent.ACTION_VIEW, targetUri))
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                super.onReceivedError(view, request, error)
                val failingUrl = request?.url?.toString()
                val description = error?.description?.toString()?.ifBlank { null } ?: "Falha ao carregar o webapp."
                if (request?.isForMainFrame != true) {
                    Log.w(TAG, "Subresource load failed for $failingUrl: $description")
                    return
                }

                Log.e(TAG, "Main frame load failed for $failingUrl: $description")
                onPageLoadFailed(failingUrl, description)
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?,
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                val failingUrl = request?.url?.toString()
                val reason = "HTTP ${errorResponse?.statusCode ?: 0} ao carregar o webapp."
                if (request?.isForMainFrame != true) {
                    Log.w(TAG, "Subresource HTTP error for $failingUrl: $reason")
                    return
                }

                Log.e(TAG, "Main frame HTTP error for $failingUrl: $reason")
                onPageLoadFailed(failingUrl, reason)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                return onShowFileChooser(filePathCallback, fileChooserParams)
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                onPermissionRequest(request)
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                if (origin.isNullOrBlank() || callback == null) {
                    callback?.invoke(origin, false, false)
                    return
                }

                onGeolocationPermissionRequest(origin, callback)
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage == null) {
                    return super.onConsoleMessage(null)
                }

                val renderedMessage =
                    "${consoleMessage.messageLevel()} ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()} ${consoleMessage.message()}"

                when (consoleMessage.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.e(TAG, renderedMessage)
                    ConsoleMessage.MessageLevel.WARNING -> Log.w(TAG, renderedMessage)
                    else -> Log.d(TAG, renderedMessage)
                }

                return super.onConsoleMessage(consoleMessage)
            }
        }
    }

    fun loadHome(webView: WebView) {
        webView.loadUrl(FitLootWebAppConfig.webAppUrl)
    }
}
