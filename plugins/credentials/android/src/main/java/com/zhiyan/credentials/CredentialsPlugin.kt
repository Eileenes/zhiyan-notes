package com.zhiyan.credentials

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class StoreArgs { var op:String=""; var key:String=""; var value:String="" }

@TauriPlugin
class CredentialsPlugin(private val activity:Activity):Plugin(activity) {
    private val alias="zhiyan-v1-credentials"
    @Synchronized
    private fun encryptionKey():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias,null) as? SecretKey)?.let { return it }
        val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
    @Command
    fun handle(invoke:Invoke) {
        try {
            val args=invoke.parseArgs(StoreArgs::class.java)
            require(args.key.length<=150 && (args.key.startsWith("provider.")||args.key.startsWith("sync.")))
            val prefs=activity.getSharedPreferences("zhiyan-secure",Context.MODE_PRIVATE)
            val out=JSObject()
            when(args.op) {
                "secretSet" -> {
                    require(args.value.isNotEmpty() && args.value.length<=8192)
                    val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE,encryptionKey())
                    cipher.updateAAD(args.key.toByteArray(Charsets.UTF_8))
                    val encrypted=cipher.iv+cipher.doFinal(args.value.toByteArray(Charsets.UTF_8))
                    check(prefs.edit().putString(args.key,Base64.encodeToString(encrypted,Base64.NO_WRAP)).commit())
                    out.put("value",true)
                }
                "secretGet" -> {
                    val encoded=prefs.getString(args.key,null)
                    if(encoded==null) out.put("value","") else {
                        val data=Base64.decode(encoded,Base64.NO_WRAP)
                        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                        cipher.init(Cipher.DECRYPT_MODE,encryptionKey(),GCMParameterSpec(128,data.copyOfRange(0,12)))
                        cipher.updateAAD(args.key.toByteArray(Charsets.UTF_8))
                        out.put("value",String(cipher.doFinal(data.copyOfRange(12,data.size)),Charsets.UTF_8))
                    }
                }
                "secretDelete" -> { check(prefs.edit().remove(args.key).commit());out.put("value",true) }
                else -> throw IllegalArgumentException("无效操作")
            }
            invoke.resolve(out)
        } catch(error:Exception) { invoke.reject("无法访问 Android 安全存储："+error.javaClass.simpleName) }
    }
}
