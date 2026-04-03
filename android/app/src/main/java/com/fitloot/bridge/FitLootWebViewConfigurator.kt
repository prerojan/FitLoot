package com.fitloot.bridge

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

object FitLootWebViewConfigurator {

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(
        webView: WebView,
        openExternalUrl: (Intent) -> Unit,
        onShowFileChooser: (ValueCallback<Array<Uri>>?, WebChromeClient.FileChooserParams?) -> Boolean,
        onPermissionRequest: (PermissionRequest) -> Unit,
        onGeolocationPermissionRequest: (String, GeolocationPermissions.Callback) -> Unit,
    ) {
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
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return false
                val targetUrl = targetUri.toString()
                if (FitLootWebAppConfig.isTrustedUrl(targetUrl)) {
                    return false
                }

                openExternalUrl(Intent(Intent.ACTION_VIEW, targetUri))
                return true
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
        }
    }

    fun loadHome(webView: WebView) {
        webView.loadUrl(FitLootWebAppConfig.webAppUrl)
    }
}
