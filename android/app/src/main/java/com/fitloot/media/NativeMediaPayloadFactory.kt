package com.fitloot.media

import android.content.Context
import android.net.Uri
import android.util.Base64
import org.json.JSONObject

object NativeMediaPayloadFactory {

    fun fromCameraPath(path: String): JSONObject {
        return JSONObject().apply {
            put("path", path)
        }
    }

    fun fromGalleryUri(context: Context, imageUri: Uri): JSONObject {
        val mimeType = context.contentResolver.getType(imageUri) ?: "image/jpeg"
        val base64Image = context.contentResolver.openInputStream(imageUri)?.use { inputStream ->
            Base64.encodeToString(inputStream.readBytes(), Base64.NO_WRAP)
        }

        return JSONObject().apply {
            if (base64Image != null) {
                put("base64", base64Image)
                put("mimeType", mimeType)
            }
            put("uri", imageUri.toString())
        }
    }
}
