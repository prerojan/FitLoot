package com.fitloot.media

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.io.File
import org.json.JSONObject

object NativeMediaPayloadFactory {

    fun fromCameraPath(path: String): JSONObject {
        val photoFile = File(path)
        val base64Image = if (photoFile.exists()) {
            Base64.encodeToString(photoFile.readBytes(), Base64.NO_WRAP)
        } else {
            null
        }

        return JSONObject().apply {
            put("path", path)
            if (base64Image != null) {
                put("base64", base64Image)
                put("mimeType", "image/jpeg")
            }
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
