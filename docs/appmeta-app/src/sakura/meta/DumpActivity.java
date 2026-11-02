package sakura.meta;
import android.app.Activity;
import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
public class DumpActivity extends Activity {
  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    new Thread(() -> {
      StringBuilder sb = new StringBuilder();
      int count = 0;
      try {
        PackageManager pm = getPackageManager();
        List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.MATCH_DISABLED_COMPONENTS);
        Collections.sort(apps, new Comparator<ApplicationInfo>() {
          public int compare(ApplicationInfo a, ApplicationInfo b) { return a.packageName.compareTo(b.packageName); }
        });
        for (ApplicationInfo ai : apps) {
          try {
            CharSequence label = pm.getApplicationLabel(ai);
            Drawable d = pm.getApplicationIcon(ai);
            int size = 96;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(canvas);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
            String icon = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            String text = String.valueOf(label).replace("\t", " ").replace("\n", " ").replace("\r", " ");
            sb.append(ai.packageName).append("\t").append(text).append("\t").append(icon).append("\n");
            count++;
          } catch (Throwable t) {
            sb.append(ai.packageName).append("\t\t\n");
          }
        }
      } catch (Throwable t) { sb.append("FATAL\t").append(String.valueOf(t)).append("\n"); }
      sb.append("END\t").append(count).append("\n");
      try {
        File dir = getExternalFilesDir(null);
        File tmp = new File(dir, "icons.tmp");
        File out = new File(dir, "icons.txt");
        FileOutputStream fos = new FileOutputStream(tmp);
        OutputStreamWriter w = new OutputStreamWriter(fos, "UTF-8");
        w.write(sb.toString());
        w.close(); fos.close();
        if (out.exists()) out.delete();
        tmp.renameTo(out);
      } catch (Throwable t) {}
      runOnUiThread(() -> finish());
    }).start();
  }
}
