package com.luckycharms.pos;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** Android owns the transfer, including network retries and screen-off execution. */
@CapacitorPlugin(name = "PosUpdateDownload")
public class PosUpdateDownloadPlugin extends Plugin {
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("pos-update-download", Context.MODE_PRIVATE);
    }

    private DownloadManager manager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private JSObject snapshot() throws Exception {
        SharedPreferences prefs = preferences();
        JSObject result = new JSObject();
        result.put("status", "idle");
        long id = prefs.getLong("id", -1);
        if (id == -1) return result;
        result.put("url", prefs.getString("url", ""));
        result.put("file", prefs.getString("file", ""));
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return result;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            result.put("bytes", bytes);
            result.put("total", total);
            result.put("status", status == DownloadManager.STATUS_SUCCESSFUL ? "complete" :
                status == DownloadManager.STATUS_FAILED ? "failed" :
                status == DownloadManager.STATUS_PAUSED ? "paused" : "downloading");
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                File file = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), prefs.getString("file", ""));
                if (!file.isFile() || file.length() == 0 || (total > 0 && file.length() != total)) {
                    result.put("status", "failed");
                    result.put("error", "The downloaded update is incomplete. Tap Download to retry.");
                } else {
                    result.put("uri", Uri.fromFile(file).toString());
                }
            } else if (status == DownloadManager.STATUS_FAILED) {
                result.put("error", "Android could not download the update (" +
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)) + "). Tap Download to retry.");
            }
        }
        return result;
    }

    @PluginMethod
    public synchronized void status(PluginCall call) {
        try { call.resolve(snapshot()); }
        catch (Exception error) { call.reject("Cannot read update download progress.", error); }
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        try {
            String url = call.getString("url", "");
            String name = call.getString("file", "");
            Uri uri = Uri.parse(url);
            boolean beta = getContext().getPackageName().endsWith(".beta");
            // Only the app's public release origin and its own channel may enqueue an APK.
            if (!"https".equals(uri.getScheme()) || !"updatecms.luckycharmsdnbhd.com".equals(uri.getHost()) ||
                uri.getPort() != -1 || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                !uri.getPath().startsWith("/pos-app/") || uri.getPath().contains("..") ||
                beta != uri.getPath().startsWith("/pos-app/beta/") ||
                !name.matches("Retail-[0-9]+\\.[0-9]+\\.[0-9]+(?:-beta\\.[1-9][0-9]*)?\\.apk") ||
                beta != name.contains("-beta.") || !name.equals(uri.getLastPathSegment())) {
                call.reject("Invalid update download address.");
                return;
            }
            SharedPreferences prefs = preferences();
            JSObject current = snapshot();
            String state = current.getString("status", "idle");
            if (url.equals(prefs.getString("url", "")) && name.equals(prefs.getString("file", "")) &&
                !"idle".equals(state) && !"failed".equals(state)) {
                call.resolve(current); // Reattach; never enqueue a duplicate or discard partial bytes.
                return;
            }
            long oldId = prefs.getLong("id", -1);
            if (oldId != -1) manager().remove(oldId);
            File target = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
            if (target.exists() && !target.delete()) throw new Exception("Cannot replace the previous update file.");
            DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle("Retail update")
                .setDescription("Downloading " + name)
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            request.addRequestHeader("Accept-Encoding", "identity");
            long id = manager().enqueue(request);
            if (!prefs.edit().putLong("id", id).putString("url", url).putString("file", name).commit()) {
                manager().remove(id);
                throw new Exception("Cannot save update download progress.");
            }
            call.resolve(snapshot());
        } catch (Exception error) { call.reject("Cannot start update download: " + error.getMessage(), error); }
    }
}
