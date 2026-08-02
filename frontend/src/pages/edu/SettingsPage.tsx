// frontend/src/pages/edu/SettingsPage.tsx
//
// 设置 — system-level settings an operator might need to change without
// touching a server file or restarting anything. Starts with just the
// asset storage URL (backend/src/utils/assetStorage.ts's ASSET_BASE_URL),
// which used to live only in backend/.env — editable here now instead,
// takes effect on the very next upload (backend caches it for ~10s, see
// utils/systemSettings.ts), no restart needed.

import { useState, useEffect } from "react";
import { settingsApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/index";
import FontSettingsCard from "@/components/settings/FontSettingsCard";
import toast from "react-hot-toast";

export default function SettingsPage() {
  const [assetBaseUrl, setAssetBaseUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsApi.get().then((r) => { setAssetBaseUrl(r.asset_base_url); setSavedUrl(r.asset_base_url); }).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!assetBaseUrl.trim()) { toast.error("网址不能空着"); return; }
    setSaving(true);
    try {
      const r = await settingsApi.update({ asset_base_url: assetBaseUrl.trim() });
      setAssetBaseUrl(r.asset_base_url); setSavedUrl(r.asset_base_url);
      toast.success("已保存——之后新上传的素材都会用这个网址，不用重启服务器");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "保存失败";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const dirty = assetBaseUrl.trim() !== savedUrl;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">系统层面的设置，改完马上生效，不用重启服务器。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>素材储存网址</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            素材库上传的图片（背景图、物件图案）实际是存在服务器磁盘上的文件，数据库里只存网址。这个网址决定了那些文件对外的访问路径前缀——本机开发环境用 <code className="text-xs bg-muted px-1 py-0.5 rounded">http://localhost:4000</code> 就好；正式上线之后，改成真正对外的域名，比如 <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.yourschool.com</code>；以后如果换成真正的远端储存服务（比如云端储存），这里改成那个服务的公开网址就行，不用改任何程序代码。
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : (
            <>
              <div>
                <Label>网址</Label>
                <Input
                  value={assetBaseUrl} onChange={(e) => setAssetBaseUrl(e.target.value)}
                  placeholder="http://localhost:4000"
                />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ 只影响之后新上传的素材——已经上传过的素材，网址是当时存下来的，不会因为改了这个设置就跟着变。如果要让旧素材也换成新网址，得重新上传。
              </p>
              <Button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <FontSettingsCard />
    </div>
  );
}
