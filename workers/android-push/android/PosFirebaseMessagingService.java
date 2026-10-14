package com.luckycharms.pos;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/** Data-only FCM alerts are checked locally even when JavaScript is not running. */
public class PosFirebaseMessagingService extends MessagingService {
  @Override public void onMessageReceived(RemoteMessage message) {
    Map<String,String> data = message.getData();
    String event = data.get("eventId");
    if (event == null || !event.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) return;
    try {
      String raw = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("pos.push.state", "");
      JSONObject owner = new JSONObject(raw);
      if (!owner.optBoolean("enabled") || owner.optLong("expiresAt") <= System.currentTimeMillis()
          || !owner.optString("userId").equals(data.get("userId"))
          || !owner.optString("tenantId").equals(data.get("tenantId"))) return;
    } catch (Exception ignored) { return; }
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
    NotificationManager manager = (NotificationManager)getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager == null || (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled())) return;
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel channel = new NotificationChannel("pos_alerts", "POS alerts", NotificationManager.IMPORTANCE_HIGH);
      channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
      manager.createNotificationChannel(channel);
    }
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch == null) return;
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    launch.putExtra("google.message_id", event);
    for (Map.Entry<String,String> entry : data.entrySet()) launch.putExtra(entry.getKey(), entry.getValue());
    PendingIntent action = PendingIntent.getActivity(this, event.hashCode(), launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    manager.notify(event, event.hashCode(), new NotificationCompat.Builder(this, "pos_alerts")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Retail POS")
      .setContentText("A new POS alert is available. Sign in to view details.")
      .setContentIntent(action).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPriority(NotificationCompat.PRIORITY_HIGH).build());
    super.onMessageReceived(message);
  }
}
