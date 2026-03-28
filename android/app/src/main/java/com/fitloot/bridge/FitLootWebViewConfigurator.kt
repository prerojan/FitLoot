package com.fitloot.bridge

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

object FitLootWebViewConfigurator {

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(
        webView: WebView,
        openExternalUrl: (Intent) -> Unit,
        onShowFileChooser: (ValueCallback<Array<Uri>>?, WebChromeClient.FileChooserParams?) -> Boolean,
        onPermissionRequest: (PermissionRequest) -> Unit,
    ) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url.toString()
                if (FitLootWebAppConfig.isTrustedUrl(url)) {
                    return false
                }

                openExternalUrl(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
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
        }
    }

    fun loadHome(webView: WebView) {
        webView.loadUrl(FitLootWebAppConfig.WEB_APP_URL)
    }
}
